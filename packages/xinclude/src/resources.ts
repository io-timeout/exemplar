import {
  type CatalogProcessor,
  ErrorCode,
  EventType,
  type Resolution,
  ResolutionError,
  type ResolvedSource,
  type Source,
} from '@exemplarjs/xml';
import {
  type ByteStream,
  type ResolvedOptions,
  resolveURI,
  accessAllows,
  escapeURI,
  orElse,
  readStream,
  accessRefusedError,
  unmatchedByCatalog,
} from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';

/** A resource that cannot be included, which a fallback may stand in for. */
export class ResourceError extends Error {
  override name = 'ResourceError';
  /** The code to fail with when no fallback stands in. */
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.XINCLUDE_RESOURCE) {
    super(message);
    this.code = code;
  }
}

/** The HTTP headers an xi:include asks a resolver to send. */
export interface Headers {
  readonly accept?: string;
  readonly acceptLanguage?: string;
}

/** A resource's absolute URI and the source a resolver gives, or will give, for it. */
export type FoundResource = { uri: string; source: ResolvedSource | Promise<ResolvedSource | undefined> };

/** Goes on with a resource once it is found, given its source and URI. */
export type Resume = (source: ResolvedSource, uri: string) => number;

/** A resolver's answer the reader waits for, and what it does once the answer comes. */
export interface Waiting {
  readonly uri: string;
  /** Settles once the answer has come, or the resolver has failed. */
  readonly promise: Promise<void>;
  hasSettled: boolean;
  answer: ResolvedSource | undefined;
  /** What a resolver that rejected failed with. */
  failure: unknown;
  hasFailed: boolean;
  readonly resume: Resume;
}

/** The text or bytes a document was read from, to include it again; undefined when its source holds neither. */
export function contentOf(source: Source | undefined): ResolvedSource | undefined {
  if (typeof source === 'string') return { text: source };
  if (source instanceof Uint8Array) return { bytes: source };
  if (typeof source !== 'object') return undefined;
  if ('text' in source && source.text !== undefined) return { text: source.text };
  if ('bytes' in source && source.bytes !== undefined) return { bytes: source.bytes };
  return undefined;
}

/** Asks the resolvers for a resource, and then the catalog, which reads only what the access list allows. */
export function findResource(options: ResolvedOptions, href: string, base: string, headers: Headers): FoundResource {
  const escaped = escapeURI(href);
  const uri = resolveURI(escaped, base || undefined);
  if (uri === undefined)
    throw ErrorFactory.create(ResourceError, `${href} cannot be resolved against ${base || 'no base URI'}`);
  const catalog = options.catalog;
  const fromResolvers = askResolvers(options, escaped, base, headers);
  const source =
    catalog === undefined
      ? fromResolvers
      : orElse(fromResolvers, () => askCatalog(options, catalog, escaped, base, headers));
  if (source === undefined) throw ErrorFactory.create(ResourceError, `No resolver supplies ${uri}`);
  return { uri, source };
}

/** Asks the URI resolver, then the entity resolver, for a resource, passing on the access list. */
function askResolvers(options: ResolvedOptions, href: string, base: string, headers: Headers): Resolution {
  const asked = { ...headers, access: options.accessExternalEntities };
  const request = { name: '[xinclude]', systemId: href, ...(base !== '' && { baseURI: base }), ...asked };
  return orElse(options.uriResolver?.resolve(href, base || undefined, asked), () =>
    options.entityResolver?.resolveEntity(request)
  );
}

/** What the catalog's URI entries map a resource to, read by the resolvers or else the catalog. */
function askCatalog(
  options: ResolvedOptions,
  catalog: CatalogProcessor,
  href: string,
  base: string,
  headers: Headers
): Resolution {
  const mapped = catalog.matchURI(href, base || undefined);
  if (mapped === undefined) {
    // A target nothing matches is a resource error, unless the catalog is strict.
    if (catalog.resolution === 'strict') unmatchedByCatalog(catalog, undefined, resolveURI(href, base || undefined));
    return undefined;
  }
  return orElse(askResolvers(options, mapped, '', headers), () => {
    if (!accessAllows(options.accessExternalEntities, mapped)) throw accessRefusedError(mapped);
    return catalog.read(mapped);
  });
}

/** Whether a resolver's answer has only a stream, which must be read before it can be included. */
export function isStreamOnly(source: ResolvedSource): boolean {
  return source.stream !== undefined && source.text === undefined && source.bytes === undefined;
}

/** Waits for a resolver's answer, reading a stream whole, as the cursor reads one a resolver answers with. */
export function waitFor(uri: string, source: FoundResource['source'], resume: Resume): Waiting {
  const waiting: Waiting = {
    uri,
    hasSettled: false,
    answer: undefined,
    failure: undefined,
    hasFailed: false,
    resume,
    promise: Promise.resolve(source)
      .then(readStreamWhole)
      .then(
        (answer) => {
          waiting.answer = answer;
          waiting.hasSettled = true;
        },
        (error: unknown) => {
          waiting.failure = error;
          waiting.hasFailed = true;
          waiting.hasSettled = true;
        }
      ),
  };
  return waiting;
}

/**
 * A resolver's answer a reader waits for, if any. While it waits, `next()` returns NEED_INPUT and the
 * caller awaits `fill()`, which settles once the answer has come; the reader then goes on with it.
 */
export class Pending {
  #waiting: Waiting | undefined;
  /** Whether NEED_INPUT was returned for the answer and nothing has been filled since. */
  #returnedNeedInput = false;

  /** Whether the reader waits for an answer. */
  get waiting(): boolean {
    return this.#waiting !== undefined;
  }

  /** Starts waiting for a resolver's answer, to go on with `resume` once it comes; returns NEED_INPUT. */
  wait(uri: string, source: FoundResource['source'], resume: Resume): number {
    this.#waiting = waitFor(uri, source, resume);
    return this.#needInput();
  }

  /** Goes on with the answer once it has come, or returns NEED_INPUT until then; a failed answer is a resource error. */
  resume(): number {
    const waiting = this.#waiting;
    if (waiting === undefined) throw ErrorFactory.create(Error, 'No resolver answer is awaited');
    if (!waiting.hasSettled) return this.#needInput();
    this.#waiting = undefined;
    if (waiting.failure instanceof ResolutionError) throw waiting.failure;
    if (waiting.hasFailed) throw ErrorFactory.create(ResourceError, `Reading ${waiting.uri} failed`);
    if (waiting.answer === undefined) throw ErrorFactory.create(ResourceError, `No resolver supplies ${waiting.uri}`);
    return waiting.resume(waiting.answer, waiting.answer.systemId ?? waiting.uri);
  }

  /** Starts a fill: what it waits for, while an answer is awaited. */
  fill(): Promise<void> | undefined {
    this.#returnedNeedInput = false;
    return this.#waiting?.promise;
  }

  /** NEED_INPUT; asked again before `fill()`, it throws rather than return it for ever. */
  #needInput(): number {
    if (this.#returnedNeedInput)
      throw ErrorFactory.create(Error, 'The reader needs more input: await fill() before calling next() again');
    this.#returnedNeedInput = true;
    return EventType.NEED_INPUT;
  }
}

/** A resolver's answer with its stream read into bytes. */
async function readStreamWhole(source: ResolvedSource | undefined): Promise<ResolvedSource | undefined> {
  if (source === undefined || !isStreamOnly(source)) return source;
  const { stream, ...rest } = source;
  return { ...rest, bytes: await readStream(stream as ByteStream) };
}
