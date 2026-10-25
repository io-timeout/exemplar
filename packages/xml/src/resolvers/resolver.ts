import { ErrorCode } from '../errors/codes.ts';
import { ErrorFactory } from '../util/errors.ts';
import { protocolOf } from '../util/uri.ts';

/** What a resolver is asked for, as SAX's `EntityResolver2.resolveEntity` is. */
export interface ResolveRequest {
  /** The entity's name: `[dtd]` for the external subset, `%name` for a parameter entity. */
  readonly name: string;
  /** The public identifier, if the declaration gives one. */
  readonly publicId?: string;
  /** The system id as written in the document. */
  readonly systemId?: string;
  /** The base URI a relative system id resolves against. */
  readonly baseURI?: string;
  /** For an XInclude target: the HTTP `Accept` header its xi:include asks for. */
  readonly accept?: string;
  /** For an XInclude target: the HTTP `Accept-Language` header its xi:include asks for. */
  readonly acceptLanguage?: string;
  /** The protocols the factory allows for this read; a resolver that reads by URI keeps to them, as the bundled ones do. */
  readonly access?: AccessList;
}

/** An entity, DTD or other document a resolver supplies. Give its content in exactly one of `text`, `bytes` or `stream`. */
export interface ResolvedSource {
  /** The URI it was read from, which its locations report and its relative references resolve against. */
  readonly systemId?: string;
  readonly publicId?: string;
  /** An encoding supplied from outside, such as an HTTP charset. */
  readonly encoding?: string;
  /** The content as text, already decoded. */
  readonly text?: string;
  /** The content as bytes, whose encoding is detected. */
  readonly bytes?: Uint8Array;
  /** The content as a stream of bytes, which only asynchronous readers can read. */
  readonly stream?: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
}

/** What a resolver returns; asynchronous readers also take a promise of it. */
export type Resolution = ResolvedSource | undefined | Promise<ResolvedSource | undefined>;

/** Supplies external entities and DTDs, as SAX's `EntityResolver2` does. */
export interface EntityResolver {
  /** Supplies the entity or DTD a request names; undefined to let the next resolver, or the catalog, answer. */
  resolveEntity(request: ResolveRequest): Resolution;
  /** Supplies an external subset to a document whose DOCTYPE names none. */
  getExternalSubset?(request: { readonly name: string; readonly baseURI?: string }): Resolution;
}

/** Resolves URIs, such as XInclude targets, as JAXP's `URIResolver` does; XInclude passes its headers and access list. */
export interface URIResolver {
  resolve(
    href: string,
    base: string | undefined,
    request?: { readonly accept?: string; readonly acceptLanguage?: string; readonly access?: AccessList }
  ): Resolution;
}

/** Thrown by a resolver to fail the document at the reference it was asked about, with an error code. */
export class ResolutionError extends Error {
  /** The error code the document fails with, such as ACCESS_REFUSED. */
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ResolutionError';
    this.code = code;
  }
}

/** A resolver's answer, or else what `next` gives; when the answer is a promise, the result is a promise too. */
export function orElse(answer: Resolution, next: () => Resolution): Resolution {
  if (answer instanceof Promise) return answer.then((found) => found ?? next());
  return answer ?? next();
}

/** The protocols external access may use, such as `['file', 'https']`, or `'all'`. */
export type AccessList = readonly string[] | 'all';

/** Whether an access list allows the protocol of an absolute URI. */
export function accessAllows(access: AccessList, uri: string | undefined): boolean {
  if (access === 'all') return true;
  if (uri === undefined) return false;
  return access.includes(protocolOf(uri));
}

/** The error for a read that an access list doesn't allow. */
export function accessRefusedError(uri: string): ResolutionError {
  return ErrorFactory.create(
    ResolutionError,
    ErrorCode.ACCESS_REFUSED,
    `Reading ${uri} is not allowed: the access list does not name '${protocolOf(uri)}'`
  );
}

/** Throws a refusal when a request carries an access list that does not allow a URI. */
export function checkAccess(request: { readonly access?: AccessList }, uri: string): void {
  if (request.access !== undefined && !accessAllows(request.access, uri)) throw accessRefusedError(uri);
}
