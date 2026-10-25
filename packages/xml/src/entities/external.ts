import type { CatalogProcessor, ResolvedOptions } from '../config/options.ts';
import type { EntityDeclaration } from '../dtd/declarations.ts';
import type { ExternalText } from '../dtd/input.ts';
import { ErrorCode } from '../errors/codes.ts';
import type { Location } from '../errors/xml-error.ts';
import type { DecoderRegistry } from '../input/decoders.ts';
import { checkDeclaredEncoding } from '../input/detect.ts';
import { DecodingFailureError, type OpenedSource, PENDING, openSource, readStream } from '../input/source.ts';
import {
  type AccessList,
  type ResolveRequest,
  type Resolution,
  type ResolvedSource,
  ResolutionError,
  accessAllows,
  orElse,
  accessRefusedError,
} from '../resolvers/resolver.ts';
import { ScanError } from '../scan/scanner.ts';
import { DeclarationParser, startsWithDeclaration } from '../tokenizer/declaration.ts';
import { lastIndexAtOrBefore } from '../util/arrays.ts';
import { Char, codePointLabel, isHighSurrogate, isLowSurrogate, isRestrictedChar } from '../util/chars.ts';
import { ErrorFactory } from '../util/errors.ts';
import { normalizeLineEnds, rawIndexMapper } from '../util/normalize.ts';
import { resolveURI } from '../util/uri.ts';

// Module-level constants, so V8 can inline them.
const { DELETE } = Char;
/** The last C1 control. */
const C1_LAST = 0x9f;

/** Fails at a location in an external entity. */
export type ExternalFail = (code: ErrorCode, message: string, location: Location) => never;

/**
 * A code unit that may not be allowed in an external entity, whose characters the tokenizer
 * doesn't check: a control character, a surrogate, U+FFFE or U+FFFF. Which of them are allowed
 * depends on the version.
 */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const CONTROL_SURROGATE_OR_NONCHARACTER = /[\0-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF\uFFFE\uFFFF]/g;
/** The C0 controls XML 1.0 forbids, in two classes of at most 16, which V8 searches 16 bytes at a time in one-byte text. */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const FORBIDDEN_C0_LOW = /[\0-\u0008\u000B\u000C\u000E-\u0012]/;
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const FORBIDDEN_C0_HIGH = /[\u0013-\u001F]/;
/** A code unit above U+00FF; text without one holds no surrogate, U+FFFE or U+FFFF. */
const ABOVE_LATIN_1 = /[\u0100-\uFFFF]/;

/** Thrown inside an asynchronous reader when a resolver has yet to answer; the reader waits for it and tries again. */
export class ResolutionPendingError extends Error {
  constructor() {
    super('A resolver has yet to answer');
    this.name = 'ResolutionPendingError';
  }
}

/** What a reference no catalog entry matches gets, by the catalog's `resolution`: nothing, empty content, or an error. */
export function unmatchedByCatalog(
  catalog: CatalogProcessor,
  publicId: string | undefined,
  systemId: string | undefined
): ResolvedSource | undefined {
  if (catalog.resolution === 'continue') return;
  if (catalog.resolution === 'ignore') return { text: '', ...(systemId !== undefined && { systemId }) };
  const described = [publicId && `public id ${publicId}`, systemId && `system id ${systemId}`].filter(Boolean);
  throw ErrorFactory.create(
    ResolutionError,
    ErrorCode.CATALOG_NO_MATCH,
    `No catalog entry matches ${described.join(' or ')}`
  );
}

/** The resolver request for an external entity or subset. */
export function resolveRequest(
  name: string,
  publicId: string | undefined,
  systemId: string | undefined,
  baseURI: string | undefined
): ResolveRequest {
  return {
    name,
    ...(publicId !== undefined && { publicId }),
    ...(systemId !== undefined && { systemId }),
    ...(baseURI !== undefined && { baseURI }),
  };
}

/** The resolver request for a declared external entity, under its name or another. */
export function entityRequest(entity: EntityDeclaration, name = entity.name): ResolveRequest {
  return resolveRequest(name, entity.publicId, entity.systemId, entity.baseURI);
}

/**
 * Reads the external entities and external DTD subset of one document. It asks the caller's entity
 * resolver first, then the catalog, and reads only what the access lists allow. A resolver may answer
 * with a promise; an asynchronous reader then waits for it, keeping each answer so that a retry asks no
 * resolver twice, while a synchronous reader throws.
 *
 * External DTD text and parameter entities are read whole with `readText`, which checks the text
 * declaration and the characters, and normalizes the line ends. External general entities are read
 * by a tokenizer, like the document.
 */
export class ExternalReader {
  readonly #options: ResolvedOptions;
  readonly #registry: DecoderRegistry;
  /** For an asynchronous reader, the answers so far by request, so that a retry asks no resolver twice. */
  readonly #answers: Map<string, ResolvedSource | undefined> | undefined;
  /** For an asynchronous reader, what resolvers that rejected failed with, thrown again where the reference is. */
  readonly #failures = new Map<string, unknown>();
  /** The resolver's answer an asynchronous reader is waiting for; undefined when it waits for none. */
  pending: Promise<void> | undefined;

  constructor(options: ResolvedOptions, registry: DecoderRegistry, async = false) {
    this.#options = options;
    this.#registry = registry;
    if (async) this.#answers = new Map();
  }

  /** Asks the resolver, then the catalog, for an entity; undefined when neither supplies it. A refused read throws ACCESS_REFUSED. */
  resolve(request: ResolveRequest, access: AccessList): { source: ResolvedSource; systemId?: string } | undefined {
    const resolver = this.#options.entityResolver;
    const catalog = this.#options.catalog;
    if (resolver === undefined && catalog === undefined) return undefined;
    const absolute = resolveURI(request.systemId, request.baseURI);
    // The caller's resolver answers first, as in the JDK; the access list goes with the request for resolvers that read.
    const asked = { ...request, access };
    const key = JSON.stringify([request.name, request.publicId, request.systemId, request.baseURI]);
    const source = this.#resolverAnswer(key, () => {
      const answer = resolver?.resolveEntity(asked);
      return catalog === undefined
        ? answer
        : orElse(answer, () => this.#resolveThroughCatalog(catalog, asked, absolute, access));
    });
    if (source === undefined) return undefined;
    const systemId = source.systemId ?? absolute;
    return { source, ...(systemId !== undefined && { systemId }) };
  }

  /** What the catalog maps an entity to, read by the resolver, or else by the catalog if the access list allows it. */
  #resolveThroughCatalog(
    catalog: CatalogProcessor,
    request: ResolveRequest,
    absolute: string | undefined,
    access: AccessList
  ): Resolution {
    const { name, publicId, systemId, baseURI } = request;
    const mapped = catalog.matchEntity(publicId, systemId, baseURI);
    if (mapped === undefined) return unmatchedByCatalog(catalog, publicId, absolute ?? systemId);
    const again = { name, systemId: mapped, access, ...(publicId !== undefined && { publicId }) };
    return orElse(this.#options.entityResolver?.resolveEntity(again), () => {
      if (!accessAllows(access, mapped)) throw accessRefusedError(mapped);
      return catalog.read(mapped);
    });
  }

  /** Asks the resolver for an external subset for a document whose DOCTYPE names none. */
  externalSubset(name: string, baseURI: string | undefined): { source: ResolvedSource; systemId?: string } | undefined {
    const resolver = this.#options.entityResolver;
    if (resolver?.getExternalSubset === undefined) return undefined;
    const request = { name, ...(baseURI !== undefined && { baseURI }) };
    const source = this.#resolverAnswer(JSON.stringify(['[subset]', name, baseURI]), () =>
      resolver.getExternalSubset?.(request)
    );
    if (source === undefined) return undefined;
    return { source, ...(source.systemId !== undefined && { systemId: source.systemId }) };
  }

  /** A resolver's answer, at once or from an earlier promise; an asynchronous reader waits for a promise or a stream. */
  #resolverAnswer(key: string, ask: () => Resolution): ResolvedSource | undefined {
    const answers = this.#answers;
    if (answers === undefined) {
      const answer = ask();
      if (answer instanceof Promise) {
        throw ErrorFactory.create(
          TypeError,
          'A synchronous reader needs a resolver that answers at once; use an asynchronous reader'
        );
      }
      return answer;
    }
    if (answers.has(key)) return answers.get(key);
    if (this.#failures.has(key)) throw this.#failures.get(key);
    const answer = ask();
    if (!(answer instanceof Promise) && answer?.stream === undefined) {
      answers.set(key, answer);
      return answer;
    }
    this.pending = Promise.resolve(answer)
      .then(async (source) => {
        answers.set(key, source === undefined ? undefined : await withStreamRead(source));
      })
      .catch((error: unknown) => {
        this.#failures.set(key, error);
      });
    throw ErrorFactory.create(ResolutionPendingError);
  }

  /** Opens what a resolver supplied, for decoding. */
  openResolved(source: ResolvedSource, systemId: string | undefined): OpenedSource {
    return openSource(
      {
        ...(source.text !== undefined && { text: source.text }),
        ...(source.bytes !== undefined && { bytes: source.bytes }),
        ...(source.stream !== undefined && { stream: source.stream }),
        ...(source.encoding !== undefined && { encoding: source.encoding }),
        ...(source.publicId !== undefined && { publicId: source.publicId }),
        ...(systemId !== undefined && { systemId }),
      },
      this.#registry
    );
  }

  /** Reads a resolved DTD or parameter entity whole: its text declaration checked, line ends normalized, characters checked. */
  readText(opened: OpenedSource, systemId: string | undefined, version11: boolean, fail: ExternalFail): ExternalText {
    const raw = readWholeText(opened, systemId, version11, fail);
    const full = normalizeLineEnds(raw, version11);
    const locateLine = lineLocator(full, systemId);
    const rawIndexOf = rawIndexMapper(raw, version11);
    // Lines and columns count the normalized text; offsets count the text as given, as they do in documents.
    const locate = (index: number): Location => ({ ...locateLine(index), offset: rawIndexOf(index) });
    // The declaration is read before line ends are normalized, as NEL and LS may not appear in it (§2.11).
    const normalized = (index: number): number => normalizeLineEnds(raw.slice(0, index), version11).length;
    const start = normalized(
      this.#readTextDeclaration(raw, opened, version11, (index) => locate(normalized(index)), fail)
    );
    checkCharacters(full, start, version11, locate, fail);
    return { text: full.slice(start), systemId, locate: (index) => locate(start + index) };
  }

  /** Reads an optional text declaration at the start of an external entity; returns where its content starts. */
  #readTextDeclaration(
    text: string,
    opened: OpenedSource,
    version11: boolean,
    locate: (index: number) => Location,
    fail: ExternalFail
  ): number {
    if (!startsWithDeclaration(text)) return 0;
    const parser = new DeclarationParser(text, 0);
    let declaration;
    try {
      declaration = parser.parse('text');
    } catch (error) {
      const failure = ErrorFactory.expect(error, ScanError);
      return fail(failure.code as ErrorCode, failure.message, locate(failure.index));
    }
    if (declaration.version === '1.1' && !version11) {
      fail(ErrorCode.WF_ENTITY_VERSION, 'An XML 1.0 document cannot use an XML 1.1 entity', locate(0));
    }
    const problem = checkDeclaredEncoding(opened.text.detection, declaration.encoding);
    if (problem?.level === 'fatal') fail(problem.code, problem.message, locate(0));
    return parser.end;
  }
}

/** A resolved source with its stream, if it has one, read into bytes. */
async function withStreamRead(source: ResolvedSource): Promise<ResolvedSource> {
  const { stream, ...rest } = source;
  return stream === undefined ? source : { ...rest, bytes: await readStream(stream) };
}

/** Reads every chunk of a source synchronously into one string, failing on bytes its encoding doesn't allow. */
function readWholeText(
  opened: OpenedSource,
  systemId: string | undefined,
  version11: boolean,
  fail: ExternalFail
): string {
  let text = '';
  for (;;) {
    let chunk;
    try {
      chunk = opened.text.read();
    } catch (error) {
      const failure = ErrorFactory.expect(error, DecodingFailureError);
      // Its line and column count the normalized text, and its offset the text as given, as for every other error.
      const read = normalizeLineEnds(text, version11);
      return fail(failure.code, failure.message, { ...locationIn(read, read.length, systemId), offset: text.length });
    }
    if (chunk === undefined) return text;
    if (chunk === PENDING)
      throw ErrorFactory.create(TypeError, 'A synchronous reader needs a resolver that supplies text or bytes');
    text += chunk;
  }
}

/** Fails at the first character the version does not allow literally; a surrogate pair is allowed. */
function checkCharacters(
  text: string,
  start: number,
  version11: boolean,
  locate: (index: number) => Location,
  fail: ExternalFail
): void {
  // In XML 1.0 text without wide characters only a C0 control can be wrong, which the quick searches rule out.
  if (!version11 && !ABOVE_LATIN_1.test(text) && !FORBIDDEN_C0_LOW.test(text) && !FORBIDDEN_C0_HIGH.test(text)) return;
  CONTROL_SURROGATE_OR_NONCHARACTER.lastIndex = start;
  for (
    let match = CONTROL_SURROGATE_OR_NONCHARACTER.exec(text);
    match !== null;
    match = CONTROL_SURROGATE_OR_NONCHARACTER.exec(text)
  ) {
    const pos = match.index;
    // eslint-disable-next-line prefer-code-point -- reads one half of a surrogate pair
    const unit = text.charCodeAt(pos);
    // eslint-disable-next-line prefer-code-point -- reads one half of a surrogate pair
    const next = text.charCodeAt(pos + 1);
    if (isHighSurrogate(unit) && isLowSurrogate(next)) {
      CONTROL_SURROGATE_OR_NONCHARACTER.lastIndex = pos + 2;
      continue;
    }
    // XML 1.0 allows DEL and the C1 controls; XML 1.1 allows NEL, which line-end handling has already turned into LF.
    if (unit >= DELETE && unit <= C1_LAST && (!version11 || !isRestrictedChar(unit))) continue;
    const label = codePointLabel(text.codePointAt(pos) as number);
    fail(ErrorCode.WF_INVALID_CHARACTER, `${label} is not allowed here`, locate(pos));
  }
}

/** The line and column of an index in text whose line ends are already LF. */
export function locationIn(text: string, index: number, systemId: string | undefined): Location {
  return lineLocator(text, systemId)(index);
}

/** Locates indexes in text whose line ends are already LF, finding where its lines start the first time it is asked. */
export function lineLocator(text: string, systemId: string | undefined): (index: number) => Location {
  let starts: number[] | undefined;
  return (index) => {
    starts ??= lineStarts(text);
    // The first line starts at 0, so there is always one at or before the index.
    const line = lastIndexAtOrBefore(starts, index);
    const column = index - (starts[line] as number) + 1;
    return { line: line + 1, column, offset: index, ...(systemId !== undefined && { systemId }) };
  };
}

/** Where each line of a text starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
