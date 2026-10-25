import type { ErrorCode } from './codes.ts';

/** Where something is in a document or one of its external entities. */
export interface Location {
  /** The line, counting from 1. */
  readonly line: number;
  /** The column, counting from 1 in UTF-16 code units, so a character beyond the BMP takes two. */
  readonly column: number;
  /** The position from the start of the entity's text as given, before line ends are normalized, counting from 0 in UTF-16 code units. */
  readonly offset: number;
  /** The URI of the document or external entity, when it has one. */
  readonly systemId?: string;
}

/** An error the parser reports, with a stable code and the location it was found at. */
export class XMLError extends Error {
  /** What went wrong, as one of `ErrorCode`'s stable codes. */
  readonly code: ErrorCode;
  /** The line it was found on, counting from 1. */
  readonly line: number;
  /** The column, counting from 1 in UTF-16 code units. */
  readonly column: number;
  /** The position from the start of the entity's text, counting from 0. */
  readonly offset: number;
  declare readonly systemId?: string;
  /** The entity references that led to the error, outermost first. */
  readonly entities: readonly string[];

  constructor(code: ErrorCode, message: string, location: Location, entities: readonly string[] = []) {
    super(message);
    this.name = 'XMLError';
    this.code = code;
    this.line = location.line;
    this.column = location.column;
    this.offset = location.offset;
    if (location.systemId !== undefined) this.systemId = location.systemId;
    this.entities = entities;
  }

  /** The error's location. */
  get location(): Location {
    return {
      line: this.line,
      column: this.column,
      offset: this.offset,
      ...(this.systemId !== undefined && { systemId: this.systemId }),
    };
  }
}

/** Receives warnings and errors; a fatal error reaches `fatalError` before it is thrown. */
export interface ErrorHandler {
  warning?(error: XMLError): void;
  error?(error: XMLError): void;
  fatalError?(error: XMLError): void;
}
