import { EventType, type ResolvedSource, type StreamReader, XMLInputFactory } from '@exemplarjs/xml';
import { XML_NAMESPACE, escapeAndResolveURI } from '@exemplarjs/xml/internal';
import { CATALOG_NAMESPACE, normalizePublicId, normalizeURI } from './normalize.ts';

/** A rewrite entry: identifiers starting with `startString` start with `rewritePrefix` instead. */
export interface Rewrite {
  readonly startString: string;
  readonly rewritePrefix: string;
}

/** A suffix entry: identifiers ending with `suffix` map to `uri`. */
export interface Suffix {
  readonly suffix: string;
  readonly uri: string;
}

/** A delegate entry: identifiers starting with `startString` are resolved by the catalog file `catalog` alone. */
export interface Delegate {
  readonly startString: string;
  readonly catalog: string;
  /** The prefer setting in force where the entry sits; a delegatePublic entry is skipped beside a system id unless true. */
  readonly preferPublic: boolean;
}

/**
 * One catalog entry file, its entries sorted by kind, each kind in document order. The maps are keyed
 * by the normalized identifier; for example `<system systemId="http://x/a.dtd" uri="a.dtd"/>` in
 * `file:///c/catalog.xml` maps `http://x/a.dtd` to `file:///c/a.dtd` in `system`.
 */
export interface CatalogFile {
  readonly system: Map<string, string>;
  readonly rewriteSystem: Rewrite[];
  readonly systemSuffix: Suffix[];
  readonly delegateSystem: Delegate[];
  /** The first public entry for each identifier, used when no system identifier is given. */
  readonly publicAny: Map<string, string>;
  /** The first public entry for each identifier where `prefer` is public, used beside a system identifier. */
  readonly publicPreferred: Map<string, string>;
  readonly delegatePublic: Delegate[];
  readonly uri: Map<string, string>;
  readonly rewriteURI: Rewrite[];
  readonly uriSuffix: Suffix[];
  readonly delegateURI: Delegate[];
  /** The nextCatalog files, searched after this one. */
  readonly nextCatalogs: string[];
}

/** The base URI and prefer setting in force inside an element; null inside an element that is ignored. */
type Scope = { readonly base: string; readonly preferPublic: boolean } | null;

/** Reads an entry's attribute, in no namespace, by name. */
type AttributeReader = (name: string) => string | undefined;

/** Records one kind of entry, given its attributes and the scope it sits in. */
type EntryReader = (file: CatalogFile, attribute: AttributeReader, base: string, preferPublic: boolean) => void;

// Catalog files are read with external access off and validity errors ignored.
const FACTORY = new XMLInputFactory({ errorHandler: { warning: () => {}, error: () => {} } });

/** A URI attribute, made absolute against the base URI in force. */
function absoluteURI(value: string | undefined, base: string): string | undefined {
  return value === undefined ? undefined : escapeAndResolveURI(value, base);
}

/** Adds a mapping unless an earlier entry has the key. */
function addFirst(map: Map<string, string>, key: string | undefined, uri: string | undefined): void {
  if (key !== undefined && uri !== undefined && !map.has(key)) map.set(key, uri);
}

/** Records a rewrite entry. */
function addRewrite(entries: Rewrite[], startString: string | undefined, rewritePrefix: string | undefined): void {
  if (startString !== undefined && rewritePrefix !== undefined) {
    entries.push({ startString: normalizeURI(startString), rewritePrefix });
  }
}

/** Records a suffix entry. */
function addSuffix(entries: Suffix[], value: string | undefined, uri: string | undefined): void {
  if (value !== undefined && uri !== undefined) entries.push({ suffix: normalizeURI(value), uri });
}

/** Records a delegate entry. */
function addDelegate(
  entries: Delegate[],
  startString: string | undefined,
  catalog: string | undefined,
  preferPublic: boolean
): void {
  if (startString !== undefined && catalog !== undefined) entries.push({ startString, catalog, preferPublic });
}

/** A public identifier as a key, once normalized. */
function publicKey(id: string | undefined): string | undefined {
  return id === undefined ? undefined : normalizePublicId(id);
}

/** A system identifier or URI as a key, once normalized. */
function uriKey(uri: string | undefined): string | undefined {
  return uri === undefined ? undefined : normalizeURI(uri);
}

/** How each entry type is recorded (§6.5). */
const ENTRY_READERS: Readonly<Record<string, EntryReader>> = {
  public(file, attribute, base, preferPublic) {
    const key = publicKey(attribute('publicId'));
    const uri = absoluteURI(attribute('uri'), base);
    addFirst(file.publicAny, key, uri);
    if (preferPublic) addFirst(file.publicPreferred, key, uri);
  },
  system: (file, attribute, base) =>
    addFirst(file.system, uriKey(attribute('systemId')), absoluteURI(attribute('uri'), base)),
  rewriteSystem: (file, attribute, base) =>
    addRewrite(file.rewriteSystem, attribute('systemIdStartString'), absoluteURI(attribute('rewritePrefix'), base)),
  systemSuffix: (file, attribute, base) =>
    addSuffix(file.systemSuffix, attribute('systemIdSuffix'), absoluteURI(attribute('uri'), base)),
  delegatePublic: (file, attribute, base, preferPublic) =>
    addDelegate(
      file.delegatePublic,
      publicKey(attribute('publicIdStartString')),
      absoluteURI(attribute('catalog'), base),
      preferPublic
    ),
  delegateSystem: (file, attribute, base) =>
    addDelegate(
      file.delegateSystem,
      uriKey(attribute('systemIdStartString')),
      absoluteURI(attribute('catalog'), base),
      true
    ),
  uri: (file, attribute, base) => addFirst(file.uri, uriKey(attribute('name')), absoluteURI(attribute('uri'), base)),
  rewriteURI: (file, attribute, base) =>
    addRewrite(file.rewriteURI, attribute('uriStartString'), absoluteURI(attribute('rewritePrefix'), base)),
  uriSuffix: (file, attribute, base) =>
    addSuffix(file.uriSuffix, attribute('uriSuffix'), absoluteURI(attribute('uri'), base)),
  delegateURI: (file, attribute, base) =>
    addDelegate(file.delegateURI, uriKey(attribute('uriStartString')), absoluteURI(attribute('catalog'), base), true),
  nextCatalog(file, attribute, base) {
    const catalog = absoluteURI(attribute('catalog'), base);
    if (catalog !== undefined) file.nextCatalogs.push(catalog);
  },
};

/** The prefer setting an element gives its content. */
function preferenceOf(value: string | undefined, inherited: boolean): boolean {
  if (value === 'public') return true;
  if (value === 'system') return false;
  return inherited;
}

/** Records one element of a catalog file; returns the scope its content is read in. */
function readElement(reader: StreamReader, scope: Scope, file: CatalogFile, isRoot: boolean): Scope {
  // Elements in other namespaces are ignored with all they hold (§6), and so are unknown ones.
  if (scope === null || reader.namespaceURI() !== CATALOG_NAMESPACE) return null;
  const attribute: AttributeReader = (name) => reader.attributeValue('', name);
  const base = absoluteURI(reader.attributeValue(XML_NAMESPACE, 'base'), scope.base) ?? scope.base;
  const name = reader.localName();
  if (name === 'group' || (isRoot && name === 'catalog')) {
    return { base, preferPublic: preferenceOf(attribute('prefer'), scope.preferPublic) };
  }
  if (Object.hasOwn(ENTRY_READERS, name))
    (ENTRY_READERS[name] as EntryReader)(file, attribute, base, scope.preferPublic);
  return null;
}

/** A catalog file with no entries yet. */
function emptyCatalogFile(): CatalogFile {
  return {
    system: new Map(),
    rewriteSystem: [],
    systemSuffix: [],
    delegateSystem: [],
    publicAny: new Map(),
    publicPreferred: new Map(),
    delegatePublic: [],
    uri: new Map(),
    rewriteURI: [],
    uriSuffix: [],
    delegateURI: [],
    nextCatalogs: [],
  };
}

/** Reads a catalog entry file; undefined when it is not an XML catalog, which is then treated as unreadable (§8). */
export function readCatalogFile(source: ResolvedSource, uri: string, preferPublic: boolean): CatalogFile | undefined {
  const file = emptyCatalogFile();
  const base = source.systemId ?? uri;
  try {
    const reader = FACTORY.createStreamReader({ ...source, systemId: base });
    const scopes: Scope[] = [];
    for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
      if (event === EventType.END_ELEMENT) scopes.pop();
      if (event !== EventType.START_ELEMENT) continue;
      const isRoot = scopes.length === 0;
      if (isRoot && (reader.namespaceURI() !== CATALOG_NAMESPACE || reader.localName() !== 'catalog')) return undefined;
      scopes.push(readElement(reader, isRoot ? { base, preferPublic } : (scopes.at(-1) as Scope), file, isRoot));
    }
  } catch {
    // A file that is not well-formed is not a catalog.
    return undefined;
  }
  return file;
}
