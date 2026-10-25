import {
  type CatalogProcessor,
  type CatalogResolution,
  type EntityResolver,
  ErrorCode,
  ResolutionError,
  type ResolveRequest,
  type ResolvedSource,
  type URIResolver,
} from '@exemplarjs/xml';
import { hasScheme, resolveURI, unmatchedByCatalog } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { type CatalogFile, type Delegate, type Rewrite, type Suffix, readCatalogFile } from './file.ts';
import { normalizePublicId, normalizeURI, unwrapURN } from './normalize.ts';

/** Reads a catalog file, or a resource a catalog maps to; undefined when it cannot. */
export type CatalogReader = (uri: string) => ResolvedSource | undefined;

/** A resolver's settings, with every default filled in; see `CatalogOptions`. */
export interface CatalogSettings {
  readonly files: readonly string[];
  /** Whether public entries count beside a system identifier, as `prefer="public"` says. */
  readonly preferPublic: boolean;
  readonly defer: boolean;
  readonly resolution: CatalogResolution;
  readonly read: CatalogReader;
}

/** A catalog file to search, and the link to the file whose nextCatalog or delegate entry led to it. */
interface CatalogLink {
  readonly uri: string;
  /** Undefined for one of the files the resolver was given. */
  readonly reachedFrom: CatalogLink | undefined;
}

/** What searching one catalog file gives: a match, a delegation to resolve instead, or nothing. */
type FileSearchResult = string | (() => string | undefined) | undefined;

/** How many answers a resolver remembers before it starts again. */
const CACHE_LIMIT = 10_000;

/** A relative identifier made absolute against the base URI; undefined for one that is absolute or cannot be. */
function resolvedIfRelative(id: string | undefined, baseURI: string | undefined): string | undefined {
  if (id === undefined || baseURI === undefined || hasScheme(id)) return undefined;
  return resolveURI(id, baseURI);
}

/** Looks an identifier up as written, then, when it is relative, made absolute against the base URI (§7.1.1, §7.2.1). */
function lookUpAsWrittenThenAbsolute(
  id: string | undefined,
  baseURI: string | undefined,
  lookup: (id: string | undefined) => string | undefined
): string | undefined {
  const found = lookup(id);
  if (found !== undefined) return found;
  const absolute = resolvedIfRelative(id, baseURI);
  return absolute === undefined ? undefined : lookup(absolute);
}

/** A URI reference as matching sees it: normalized, without its fragment (§4.3, §6.3). */
function matchableURI(uri: string): string {
  const hash = uri.indexOf('#');
  return normalizeURI(hash === -1 ? uri : uri.slice(0, hash));
}

/** The longest rewrite entry matching an identifier, applied; undefined when none matches. */
function applyLongestRewrite(entries: readonly Rewrite[], id: string): string | undefined {
  let best: Rewrite | undefined;
  for (const entry of entries) {
    const { startString } = entry;
    if (id.startsWith(startString) && (best === undefined || startString.length > best.startString.length))
      best = entry;
  }
  return best === undefined ? undefined : best.rewritePrefix + id.slice(best.startString.length);
}

/** The URI of the longest suffix entry matching an identifier. */
function longestSuffixMatch(entries: readonly Suffix[], id: string): string | undefined {
  let best: Suffix | undefined;
  for (const entry of entries) {
    if (id.endsWith(entry.suffix) && (best === undefined || entry.suffix.length > best.suffix.length)) best = entry;
  }
  return best?.uri;
}

/** The catalogs of the delegate entries matching an identifier, longest match first. */
function delegateCatalogs(entries: readonly Delegate[], id: string, reachedFrom: CatalogLink): CatalogLink[] {
  return entries
    .filter((entry) => id.startsWith(entry.startString))
    .toSorted((a, b) => b.startString.length - a.startString.length)
    .map((entry) => ({ uri: entry.catalog, reachedFrom }));
}

/** Whether a catalog file was reached through a chain of nextCatalog and delegate entries that started at it. */
function leadsBackToItself(link: CatalogLink): boolean {
  for (let from = link.reachedFrom; from !== undefined; from = from.reachedFrom) if (from.uri === link.uri) return true;
  return false;
}

/**
 * OASIS XML Catalogs 1.1: maps external identifiers and URI references through a list of catalog
 * files, so that a document can name `http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd` and be
 * given a local copy instead of fetching it.
 *
 * Each catalog file lists entries such as `<system systemId="http://…/a.dtd" uri="local/a.dtd"/>`.
 * A lookup searches the files in order, each one's nextCatalog files straight after it; the first
 * match wins, and a delegate entry hands the lookup over to other catalog files. Files are read once,
 * when first needed unless `defer` is off, and answers are remembered.
 */
export class CatalogResolver implements CatalogProcessor, EntityResolver, URIResolver {
  /** What happens when nothing matches: `strict` fails, `continue` and `ignore` leave it to other resolvers. */
  readonly resolution: CatalogResolution;
  readonly #settings: CatalogSettings;
  /** The catalog files read so far, null for one that could not be read or is no catalog. */
  readonly #files = new Map<string, CatalogFile | null>();
  /** The answers worked out so far, by lookup. */
  readonly #answers = new Map<string, string | undefined>();

  /** @internal */
  constructor(settings: CatalogSettings) {
    this.#settings = settings;
    this.resolution = settings.resolution;
    if (!settings.defer) {
      const expanded = new Set<string>();
      for (const uri of settings.files) this.#readAllFiles({ uri, reachedFrom: undefined }, expanded);
    }
  }

  /** The URI an external identifier maps to (§7.1); failing that, as the JDK does, the uri entries' match for its system id. */
  matchEntity(publicId: string | undefined, systemId: string | undefined, baseURI?: string): string | undefined {
    return this.#remembered(JSON.stringify(['entity', publicId, systemId, baseURI]), () => {
      // A relative system identifier is tried as written against system entries alone, so that none loses to a public one.
      const absolute = resolvedIfRelative(systemId, baseURI);
      const found =
        absolute === undefined
          ? this.#resolveExternalId(publicId, systemId)
          : (this.#resolveExternalId(undefined, systemId) ?? this.#resolveExternalId(publicId, absolute));
      if (found !== undefined || systemId === undefined) return found;
      return lookUpAsWrittenThenAbsolute(systemId, baseURI, (id) =>
        this.#resolveURIIn(this.#startingFiles(), matchableURI(id as string))
      );
    });
  }

  /** The URI a URI reference maps to (§7.2); failing that, as the JDK does, the system entries' match for it. */
  matchURI(uri: string, baseURI?: string): string | undefined {
    return this.#remembered(JSON.stringify(['uri', uri, baseURI]), () => {
      const found = lookUpAsWrittenThenAbsolute(uri, baseURI, (id) => this.#resolveURIReference(id as string));
      if (found !== undefined) return found;
      return lookUpAsWrittenThenAbsolute(uri, baseURI, (id) =>
        this.#resolveExternalIdIn(this.#startingFiles(), undefined, matchableURI(id as string))
      );
    });
  }

  /** Reads a resource the catalog maps to; undefined when it cannot be read. */
  read(uri: string): ResolvedSource | undefined {
    try {
      return this.#settings.read(uri);
    } catch {
      return undefined;
    }
  }

  /** Supplies what an entity maps to, as an entity resolver; what nothing matches follows `resolve`. */
  resolveEntity(request: ResolveRequest): ResolvedSource | undefined {
    const { publicId, systemId, baseURI } = request;
    const mapped = this.matchEntity(publicId, systemId, baseURI);
    if (mapped !== undefined) return this.read(mapped);
    return unmatchedByCatalog(this, publicId, resolveURI(systemId, baseURI) ?? systemId);
  }

  /** Supplies what a URI maps to, as a URI resolver; under `ignore` and `continue` an unmatched URI is left to others. */
  resolve(href: string, base: string | undefined): ResolvedSource | undefined {
    const mapped = this.matchURI(href, base);
    if (mapped !== undefined) return this.read(mapped);
    if (this.resolution === 'strict') unmatchedByCatalog(this, undefined, resolveURI(href, base) ?? href);
    return undefined;
  }

  /** Normalizes an external identifier (§7.1.1) and resolves it through the catalog files. */
  #resolveExternalId(publicId: string | undefined, systemId: string | undefined): string | undefined {
    let normalizedPublicId = publicId === undefined ? undefined : (unwrapURN(publicId) ?? normalizePublicId(publicId));
    let normalizedSystemId = systemId === undefined ? undefined : normalizeURI(systemId);
    const unwrapped = normalizedSystemId === undefined ? undefined : unwrapURN(normalizedSystemId);
    if (unwrapped !== undefined) {
      // A system identifier in the publicid namespace stands in for a public one, unless a different one is given.
      normalizedPublicId ??= unwrapped;
      normalizedSystemId = undefined;
    }
    if (normalizedPublicId === undefined && normalizedSystemId === undefined) return undefined;
    return this.#resolveExternalIdIn(this.#startingFiles(), normalizedPublicId, normalizedSystemId);
  }

  /** Resolves a URI reference without its fragment (§4.3); one in the publicid namespace as the public identifier it is. */
  #resolveURIReference(uri: string): string | undefined {
    const normalized = matchableURI(uri);
    const publicId = unwrapURN(normalized);
    if (publicId !== undefined) return this.#resolveExternalIdIn(this.#startingFiles(), publicId, undefined);
    return this.#resolveURIIn(this.#startingFiles(), normalized);
  }

  /** The catalog files the resolver was given, where every search starts. */
  #startingFiles(): CatalogLink[] {
    return this.#settings.files.map((uri) => ({ uri, reachedFrom: undefined }));
  }

  /** Resolves an external identifier in a list of catalog files (§7.1.2). */
  #resolveExternalIdIn(
    files: CatalogLink[],
    publicId: string | undefined,
    systemId: string | undefined
  ): string | undefined {
    return this.#searchFiles(files, (file, link): FileSearchResult => {
      const bySystem = systemId === undefined ? undefined : this.#searchSystemEntries(file, link, systemId);
      if (bySystem !== undefined || publicId === undefined) return bySystem;
      return this.#searchPublicEntries(file, link, publicId, systemId === undefined ? 'alone' : 'beside system id');
    });
  }

  /** Searches one catalog file's system, rewriteSystem, systemSuffix and delegateSystem entries, in that order. */
  #searchSystemEntries(file: CatalogFile, link: CatalogLink, systemId: string): FileSearchResult {
    const found =
      file.system.get(systemId) ??
      applyLongestRewrite(file.rewriteSystem, systemId) ??
      longestSuffixMatch(file.systemSuffix, systemId);
    if (found !== undefined) return found;
    const delegated = delegateCatalogs(file.delegateSystem, systemId, link);
    return delegated.length > 0 ? () => this.#resolveExternalIdIn(delegated, undefined, systemId) : undefined;
  }

  /** Searches one catalog file's public and delegatePublic entries; beside a system identifier, only preferred ones. */
  #searchPublicEntries(
    file: CatalogFile,
    link: CatalogLink,
    publicId: string,
    given: 'alone' | 'beside system id'
  ): FileSearchResult {
    const withSystemId = given === 'beside system id';
    const found = (withSystemId ? file.publicPreferred : file.publicAny).get(publicId);
    if (found !== undefined) return found;
    const eligible = file.delegatePublic.filter((entry) => !withSystemId || entry.preferPublic);
    const delegated = delegateCatalogs(eligible, publicId, link);
    return delegated.length > 0 ? () => this.#resolveExternalIdIn(delegated, publicId, undefined) : undefined;
  }

  /** Resolves a URI reference in a list of catalog files (§7.2.2). */
  #resolveURIIn(files: CatalogLink[], uri: string): string | undefined {
    return this.#searchFiles(files, (file, link): FileSearchResult => {
      const found =
        file.uri.get(uri) ?? applyLongestRewrite(file.rewriteURI, uri) ?? longestSuffixMatch(file.uriSuffix, uri);
      if (found !== undefined) return found;
      const delegated = delegateCatalogs(file.delegateURI, uri, link);
      return delegated.length > 0 ? () => this.#resolveURIIn(delegated, uri) : undefined;
    });
  }

  /** Searches catalog files in order, each one's nextCatalog files straight after it; a delegation ends the search. */
  #searchFiles(
    files: CatalogLink[],
    searchFile: (file: CatalogFile, link: CatalogLink) => FileSearchResult
  ): string | undefined {
    const queue = [...files];
    const searched = new Set<string>();
    for (let link = queue.shift(); link !== undefined; link = queue.shift()) {
      const file = this.#catalogFile(link);
      if (file === undefined || searched.has(link.uri)) continue;
      searched.add(link.uri);
      const result = searchFile(file, link);
      if (typeof result === 'string') return result;
      if (result !== undefined) return result();
      queue.unshift(...file.nextCatalogs.map((uri) => ({ uri, reachedFrom: link })));
    }
    return undefined;
  }

  /** A catalog file, read once; undefined when it cannot be read or is no catalog (§8). One leading back to itself fails. */
  #catalogFile(link: CatalogLink): CatalogFile | undefined {
    if (leadsBackToItself(link)) {
      throw ErrorFactory.create(
        ResolutionError,
        ErrorCode.CATALOG_CIRCULAR,
        `The catalog ${link.uri} leads back to itself`
      );
    }
    let file = this.#files.get(link.uri);
    if (file === undefined) {
      file = this.#readFile(link.uri) ?? null;
      this.#files.set(link.uri, file);
    }
    return file ?? undefined;
  }

  /** Reads and parses a catalog file; undefined when it cannot be read or is no catalog. */
  #readFile(uri: string): CatalogFile | undefined {
    const source = this.read(uri);
    return source === undefined ? undefined : readCatalogFile(source, uri, this.#settings.preferPublic);
  }

  /** Reads a catalog file and every one it leads to, for `defer: false`. */
  #readAllFiles(link: CatalogLink, expanded: Set<string>): void {
    const file = this.#catalogFile(link);
    if (file === undefined || expanded.has(link.uri)) return;
    const delegated = [...file.delegatePublic, ...file.delegateSystem, ...file.delegateURI].map(
      (entry) => entry.catalog
    );
    for (const uri of [...file.nextCatalogs, ...delegated]) this.#readAllFiles({ uri, reachedFrom: link }, expanded);
    expanded.add(link.uri);
  }

  /** An answer worked out once and remembered, as catalog files do not change. */
  #remembered(key: string, work: () => string | undefined): string | undefined {
    if (this.#answers.has(key)) return this.#answers.get(key);
    const answer = work();
    if (this.#answers.size >= CACHE_LIMIT) this.#answers.clear();
    this.#answers.set(key, answer);
    return answer;
  }
}
