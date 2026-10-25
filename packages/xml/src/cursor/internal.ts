import type { ErrorCode } from '../errors/codes.ts';
import { scanError } from '../scan/scanner.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';
import { ErrorFactory } from '../util/errors.ts';

/*
 * Hooks the other reading APIs (events, SAX, the DOM builder, XInclude) use on the cursor. They are
 * symbol-keyed so they stay out of the public API; `@exemplarjs/xml/internal` exports them.
 */
/** Sets the listener that hears where expanded entities start and end, as SAX's LexicalHandler does. */
export const LISTEN_ENTITIES: unique symbol = Symbol('listenEntities');
/** What the DTD held, in order, for SAX's DeclHandler and LexicalHandler. */
export const DTD_ITEMS: unique symbol = Symbol('dtdItems');
/** Adds a filter that every event must pass. */
export const ADD_FILTER: unique symbol = Symbol('addFilter');
/** Has the factory create a cursor with some resolved options replaced. */
export const CREATE_READER: unique symbol = Symbol('createReader');
/** The current event's position, which an event object turns into a location only when asked. */
export const EVENT_POSITION: unique symbol = Symbol('eventPosition');
/** The current event's document offset. */
export const EVENT_OFFSET: unique symbol = Symbol('eventOffset');
/** Whether every declaration the DTD refers to was read. */
export const DTD_COMPLETE: unique symbol = Symbol('dtdComplete');
/** The encoding detection chose for the document. */
export const INPUT_ENCODING: unique symbol = Symbol('inputEncoding');
/** The encoding the XML declaration names. */
export const XML_ENCODING: unique symbol = Symbol('xmlEncoding');
/** The unparsed entities and notations included content has added, which XInclude reports. */
export const INCLUDED_DECLARATIONS: unique symbol = Symbol('includedDeclarations');

/** Hears where expanded entities start and end, as SAX's `LexicalHandler` does. */
export interface EntityListener {
  /** An expanded entity's text starts. */
  startEntity(name: string): void;
  /** An expanded entity's text ends. */
  endEntity(name: string): void;
  /** An external entity's encoding as detected and as declared, and its declared version, once its text declaration is read. */
  readExternal?(name: string, inputEncoding?: string, xmlEncoding?: string, xmlVersion?: string): void;
}

/** Whether a number can index an attribute or declaration: an integer from 0 that fits in 32 bits. */
export function isIndex(value: number): boolean {
  return value >>> 0 === value;
}

/** Throws the RangeError for an attribute or namespace index the current event doesn't have; `kind` says which. */
export function outOfRange(kind: string, index: number): never {
  throw ErrorFactory.create(RangeError, `${kind} index ${index} is out of range for the current event`);
}

/** Throws a ScanError at buffer index `index` in `tokenizer`'s text, by default the start of its current token. */
export function fail(tokenizer: Tokenizer, code: ErrorCode, message: string, index = tokenizer.tokenStart): never {
  throw scanError(code, index, message);
}

/** The shortest slice V8 keeps as a view of its parent string; it copies shorter ones itself. */
const SLICED_LENGTH = 13;

/**
 * Copies a string so that it no longer holds the input chunk it was sliced from. A slice of 13 or
 * more characters is a view of its parent, which keeps the parent's memory alive.
 */
export function copyString(text: string): string {
  return text.length < SLICED_LENGTH ? text : (text + ' ').slice(0, -1);
}
