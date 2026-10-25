import type { DeclarationStore } from '../dtd/store.ts';
import type { ErrorCode } from '../errors/codes.ts';
import type { Location } from '../errors/xml-error.ts';
import type { AttributeList } from './attributes.ts';
import type { EventType } from './event-type.ts';
import type { StreamReader } from './stream-reader.ts';

/** What a validator sees of the document a cursor reads. */
export interface ValidationContext {
  /** The cursor reading the document, positioned at the event being validated. */
  readonly reader: StreamReader;
  /** The declarations read so far. @internal */
  store(): DeclarationStore;
  /** The current start tag's attributes, namespace declarations and defaults included. @internal */
  attributes(): AttributeList;
  /** Whether the reader applies Namespaces, which adds the namespace validity constraints. */
  readonly namespaceAware: boolean;
  /** Whether the XML declaration says `standalone="yes"`. */
  standalone(): boolean;
  /** Whether the current character data was written with character references. */
  textHasReferences(): boolean;
  /** Reports a validity error at the current event, or at a location. */
  error(code: ErrorCode, message: string, location?: Location): void;
}

/** Checks one document as a cursor reads it. */
export interface DocumentValidator {
  /** The DTD has been read. */
  dtd(): void;
  /** A start tag. */
  startElement(): void;
  /** An end tag. */
  endElement(): void;
  /** Character data or CDATA; returns true for whitespace in element content, which the cursor reports as SPACE. */
  text(event: EventType): boolean;
  /** A comment, PI or unexpanded entity reference. */
  markup(event: EventType): void;
  /** An expanded entity starts. */
  entity(name: string): void;
  /** The end of the document, where references to IDs that never appeared are reported. */
  endDocument(): void;
}

/** Makes a document validator for each cursor; passed to the factory as `validator`. */
export interface Validator {
  /** Creates the validator for one document. */
  create(context: ValidationContext): DocumentValidator;
}
