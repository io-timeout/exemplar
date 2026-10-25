import { ErrorCode } from '../errors/codes.ts';
import { type ErrorHandler, type Location, XMLError } from '../errors/xml-error.ts';
import { DecodingFailureError, UnsupportedEncodingError } from '../input/source.ts';
import { ResolutionError } from '../resolvers/resolver.ts';
import { ScanError } from '../scan/scanner.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';
import { ErrorFactory } from '../util/errors.ts';
import type { EntityStack } from './entity-stack.ts';

/**
 * Reports errors to the caller's error handler as XMLErrors, each naming the entities being read
 * where it happened. The rest of the reader throws ScanErrors, which know only a buffer index;
 * `toXmlError` turns those into XMLErrors with a line and column.
 *
 * A recoverable error goes to the handler's `error` and reading carries on; without that handler
 * it is thrown and ends the document, as in the JDK. A fatal error goes to `fatalError` and is then thrown.
 */
export class ErrorReporter {
  readonly #handler: ErrorHandler;
  readonly #entities: EntityStack;
  /** Recoverable errors held back while an asynchronous reader may still have to read the DTD again. */
  #deferred: XMLError[] | undefined;
  /** The error that ended the document, once there is one: a fatal error, or a recoverable one no handler took. */
  endedBy: XMLError | undefined;

  constructor(handler: ErrorHandler, entities: EntityStack) {
    this.#handler = handler;
    this.#entities = entities;
  }

  /** An XMLError at a location, naming the entities being read and then `entities`. */
  #xmlError(code: ErrorCode, message: string, location: Location, entities: readonly string[] = []): XMLError {
    return ErrorFactory.create(XMLError, code, message, location, [...this.#entities.openEntityNames(), ...entities]);
  }

  /** Tells the error handler of a warning. */
  warn(code: ErrorCode, message: string, location: Location): void {
    this.#handler.warning?.(this.#xmlError(code, message, location));
  }

  /** Reports a recoverable error; without an error handler it is thrown, ending the document. */
  error(code: ErrorCode, message: string, location: Location): void {
    const error = this.#xmlError(code, message, location);
    if (!this.#handler.error) {
      this.endedBy = error;
      throw error;
    }
    if (this.#deferred === undefined) this.#handler.error(error);
    else this.#deferred.push(error);
  }

  /** Throws a fatal error at a location, inside the entities given too, telling the error handler first. */
  fatal(code: ErrorCode, message: string, location: Location, entities: readonly string[]): never {
    const error = this.#xmlError(code, message, location, entities);
    this.releaseHeldErrors();
    this.endedBy = error;
    this.#handler.fatalError?.(error);
    throw error;
  }

  /** Reports a read the access lists refused as a recoverable error; rethrows anything else. */
  reportRefused(error: unknown, location: Location): void {
    if (!(error instanceof ResolutionError) || error.code !== ErrorCode.ACCESS_REFUSED) throw error;
    this.error(error.code, error.message, location);
  }

  /** Holds recoverable errors back until they are released or discarded, while the DTD may be read again. */
  holdErrors(): void {
    this.#deferred = [];
  }

  /** Reports the errors held back, and stops holding them. */
  releaseHeldErrors(): void {
    const errors = this.#deferred;
    this.#deferred = undefined;
    for (const error of errors ?? []) this.#handler.error?.(error);
  }

  /** Drops the errors held back, which reading the DTD again will find again. */
  discardHeldErrors(): void {
    this.#deferred = undefined;
  }

  /** Turns an error thrown while reading into an XMLError, telling the handler's `fatalError` first; returns anything else as it is. */
  toXmlError(error: unknown): unknown {
    if (error instanceof XMLError) return error;
    const converted = this.#documentError(error, this.#entities.current);
    if (converted === undefined) return error;
    this.endedBy = converted;
    this.#handler.fatalError?.(converted);
    return converted;
  }

  /** The XMLError for an error about the document, placed in `tokenizer`'s text where it happened; undefined for any other error. */
  #documentError(error: unknown, tokenizer: Tokenizer): XMLError | undefined {
    const entities = this.#entities;
    if (error instanceof ScanError) {
      return this.#xmlError(error.code as ErrorCode, error.message, entities.locationIn(tokenizer, error.index));
    }
    if (error instanceof DecodingFailureError) {
      return this.#xmlError(error.code, error.message, entities.locationIn(tokenizer, tokenizer.buffer.length));
    }
    if (error instanceof UnsupportedEncodingError) {
      return this.#xmlError(ErrorCode.ENCODING_UNSUPPORTED, error.message, entities.documentStart());
    }
    if (error instanceof ResolutionError) {
      return this.#xmlError(error.code, error.message, entities.locationIn(tokenizer, tokenizer.tokenStart));
    }
    return undefined;
  }
}
