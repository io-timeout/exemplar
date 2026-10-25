import { ErrorCode } from '../errors/codes.ts';
import { Char, Unicode, codePointLabel, codePointOf, isRestrictedChar } from '../util/chars.ts';
import { ErrorFactory } from '../util/errors.ts';
import {
  CharClass,
  type ClassTables,
  NAME_CLASSES,
  NAME_LAST,
  NameClass,
  TABLES_REPLACEMENT_TEXT,
  TABLES_XML_10,
  TABLES_XML_11,
  isNameCharBmp,
  isNameStartCharBmp,
} from './classes.ts';

// Module-level constants, so V8 can inline them; imported and exported bindings are read again on every use.
const NAMES = NAME_CLASSES;
const { ORDINARY, QUOTE } = CharClass;
const LINE_FEED_CLASS = CharClass.LINE_FEED;
const CARRIAGE_RETURN_CLASS = CharClass.CARRIAGE_RETURN;
const LESS_THAN_CLASS = CharClass.LESS_THAN;
const RIGHT_BRACKET_CLASS = CharClass.RIGHT_BRACKET;
const WHITESPACE_CLASS = CharClass.WHITESPACE;
const { NONE: NOT_IN_NAMES, NAME_START_CHAR, COLON: NAME_COLON } = NameClass;
const { SPACE, TAB, LINE_FEED, LESS_THAN, AMPERSAND, HYPHEN, QUESTION, GREATER_THAN, RIGHT_BRACKET, NON_ASCII } = Char;
const { NEXT_LINE, LINE_SEPARATOR, NONCHARACTER_FFFE, NONCHARACTER_FFFF } = Char;
const { HIGH_SURROGATE_FIRST, HIGH_SURROGATE_LAST, LOW_SURROGATE_FIRST, LOW_SURROGATE_LAST } = Unicode;

/**
 * For one kind of loop, 0 where every table set classes an ASCII code unit as ordinary and 1
 * elsewhere. A loop steps over a 0 without looking at the document's own table.
 */
function needsDocumentTable(kind: 'text' | 'attribute'): Uint8Array {
  const needs = new Uint8Array(NON_ASCII);
  for (let char = 0; char < NON_ASCII; char++) {
    const ordinary = [TABLES_XML_10, TABLES_XML_11, TABLES_REPLACEMENT_TEXT].every(
      (tables) => tables[kind][char] === ORDINARY
    );
    needs[char] = ordinary ? 0 : 1;
  }
  return needs;
}

const TEXT_NEEDS_TABLE = needsDocumentTable('text');
const VALUE_NEEDS_TABLE = needsDocumentTable('attribute');

/**
 * What the scanning loops read and update: the tokenizer, or a stand-in in tests. The loops are
 * free functions over this state rather than methods, so that V8 can inline them into the
 * tokenizer's own loops.
 */
export interface ScanState {
  /** The text being scanned: the part of the document not yet dropped. */
  buffer: string;
  /** Whether no more text will be appended. */
  final: boolean;
  version11: boolean;
  /** The class tables for this document's version, or for replacement text. */
  tables: ClassTables;
  /** ScanFlag bits the current scan has set. */
  flags: number;
  /** The index of the first colon in the last name scanned, or -1. */
  firstColon: number;
  /** How many colons the last name held. */
  colonCount: number;
}

/** What a scan noticed in the text it passed, which later normalization has to handle. */
export const ScanFlag = {
  /** A CR, which line-end normalization turns into LF. */
  CR: 1,
  /** XML 1.1 NEL or LS, which become line feeds. */
  NEL: 2,
  /** A character or predefined-entity reference, to decode. */
  REFERENCE: 4,
  /** Tab, LF or CR in an attribute value, which normalization turns into spaces. */
  WHITESPACE: 8,
  /** An attribute value refers to an entity that is neither predefined nor a character reference. */
  ENTITY: 16,
} as const;

const { CR: CR_FLAG, NEL: NEL_FLAG, WHITESPACE: WHITESPACE_FLAG } = ScanFlag;

/** Returned when a scan reaches the end of the buffer before it can tell where its token ends. */
export const MORE = -1;

/** A local copy of MORE, which V8 can inline; the exported binding is read again on every use. */
const NEED_MORE = MORE;

/** A scan limit beyond any buffer. */
const NO_LIMIT = 0x7f_ff_ff_ff;

/** A well-formedness error a scan found, at a buffer index; the reader turns it into an XMLError with a location. */
export class ScanError extends Error {
  readonly code: string;
  /** Where in the buffer the error is. */
  readonly index: number;

  constructor(code: string, index: number, message: string) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
    this.index = index;
  }
}

/** A ScanError built by ErrorFactory: a small call keeps the tokenizer's hot functions within V8's inlining budget. */
export function scanError(code: string, index: number, message: string): ScanError {
  return ErrorFactory.create(ScanError, code, index, message);
}

/** Strings longer than this are compared with one slice rather than a character at a time. */
const SLICE_COMPARE_LENGTH = 16;

/** Whether `text` holds `expected` at `start`; faster than `startsWith` with a position. */
export function holdsAt(text: string, start: number, expected: string): boolean {
  const length = expected.length;
  if (length > SLICE_COMPARE_LENGTH) {
    // The last character rejects most mismatches before a slice.
    // eslint-disable-next-line prefer-code-point -- compares code units
    const lastCharEqual = text.charCodeAt(start + length - 1) === expected.charCodeAt(length - 1);
    const sliceEqual = text.slice(start, start + length) === expected;
    return lastCharEqual && sliceEqual;
  }
  for (let i = 0; i < length; i++) {
    // eslint-disable-next-line prefer-code-point -- compares code units
    if (text.charCodeAt(start + i) !== expected.charCodeAt(i)) return false;
  }
  return true;
}

/** Whether two spans of the same text, starting at `firstStart` and `secondStart`, hold the same characters. */
export function sameSpan(text: string, firstStart: number, secondStart: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    // eslint-disable-next-line prefer-code-point -- compares code units
    if (text.charCodeAt(firstStart + i) !== text.charCodeAt(secondStart + i)) return false;
  }
  return true;
}

/** Throws WF_INVALID_CHARACTER for the character at `pos`. */
function throwInvalidChar(state: ScanState, pos: number): never {
  const label = codePointLabel(state.buffer.codePointAt(pos) as number);
  throw scanError(ErrorCode.WF_INVALID_CHARACTER, pos, `${label} is not allowed here`);
}

/** Checks that the high surrogate `high` at `pos` is followed by a low one; returns the index of the low one, or MORE. */
function checkSurrogatePair(state: ScanState, pos: number, high: number): number {
  if (high > HIGH_SURROGATE_LAST) throwInvalidChar(state, pos);
  // eslint-disable-next-line prefer-code-point -- reads one half of a surrogate pair
  const low = state.buffer.charCodeAt(pos + 1);
  if (Number.isNaN(low)) return state.final ? throwInvalidChar(state, pos) : NEED_MORE;
  if (low < LOW_SURROGATE_FIRST || low > LOW_SURROGATE_LAST) throwInvalidChar(state, pos);
  return pos + 1;
}

/** Checks a character above U+007F at `pos`; returns the index of its last code unit, or MORE. */
function checkNonAscii(state: ScanState, pos: number, char: number): number {
  if (char >= HIGH_SURROGATE_FIRST && char <= LOW_SURROGATE_LAST) return checkSurrogatePair(state, pos, char);
  if (char === NONCHARACTER_FFFE || char === NONCHARACTER_FFFF) throwInvalidChar(state, pos);
  if (!state.version11) return pos;
  if (char === NEXT_LINE || char === LINE_SEPARATOR) {
    state.flags |= NEL_FLAG;
  } else if (isRestrictedChar(char)) {
    throwInvalidChar(state, pos);
  }
  return pos;
}

/** Checks the `]` at `pos` in character data, which may not start `]]>`; returns `pos`, or MORE to decide. */
function checkRightBracket(state: ScanState, pos: number): number {
  const text = state.buffer;
  // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
  if (text.charCodeAt(pos + 1) !== RIGHT_BRACKET) return pos + 1 === text.length && !state.final ? NEED_MORE : pos;
  // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
  const third = text.charCodeAt(pos + 2);
  if (Number.isNaN(third) && !state.final) return NEED_MORE;
  if (third === GREATER_THAN) {
    throw scanError(ErrorCode.WF_CDATA_END_IN_TEXT, pos, ']]> is not allowed in character data');
  }
  return pos;
}

/** Handles an ASCII code unit that isn't ordinary in every table: a line end, `]` or an invalid character. Returns the index to go on after, or MORE. */
function handleSpecial(state: ScanState, pos: number, charClass: number): number {
  // Ordinary in this document's tables but not in every set, such as DEL in XML 1.0.
  if (charClass === ORDINARY || charClass === LINE_FEED_CLASS) return pos;
  if (charClass === CARRIAGE_RETURN_CLASS) {
    state.flags |= CR_FLAG;
    return pos;
  }
  if (charClass === RIGHT_BRACKET_CLASS) return checkRightBracket(state, pos);
  return throwInvalidChar(state, pos);
}

/**
 * Scans character data from `start` to the next `<` or `&`, checking each character. Returns the
 * index of that `<` or `&`, the end of the buffer once the input is final, MORE, or `limit` if it
 * gets there first.
 */
export function scanText(state: ScanState, start: number, limit = NO_LIMIT): number {
  const text = state.buffer;
  const table = state.tables.text;
  const end = text.length;
  const stop = Math.min(end, limit);
  let pos = start;
  while (pos < stop) {
    // eslint-disable-next-line prefer-code-point -- steps by code unit; checkNonAscii checks surrogate pairs
    const char = text.charCodeAt(pos);
    if (char < NON_ASCII && TEXT_NEEDS_TABLE[char] === 0) {
      pos++;
      continue;
    }
    if (char === LESS_THAN || char === AMPERSAND) return pos;
    const last = char < NON_ASCII ? handleSpecial(state, pos, table[char] as number) : checkNonAscii(state, pos, char);
    if (last === NEED_MORE) return NEED_MORE;
    pos = last + 1;
  }
  if (pos < end) return pos;
  return state.final ? end : NEED_MORE;
}

/** Skips spaces, tabs and LFs, which are ordinary in every text table; returns the index after them. */
export function skipSpacesTabsAndLineFeeds(text: string, start: number): number {
  const end = text.length;
  let pos = start;
  while (pos < end) {
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const char = text.charCodeAt(pos);
    if (char !== SPACE && char !== LINE_FEED && char !== TAB) return pos;
    pos++;
  }
  return pos;
}

/** Handles an ASCII code unit of an attribute value that isn't ordinary in every table; returns the index to go on after, or MORE. */
function handleSpecialInValue(state: ScanState, pos: number, charClass: number): number {
  if (charClass === WHITESPACE_CLASS || charClass === QUOTE) {
    if (charClass === WHITESPACE_CLASS) state.flags |= WHITESPACE_FLAG;
    return pos;
  }
  if (charClass === LESS_THAN_CLASS) {
    throw scanError(ErrorCode.WF_LT_IN_ATTRIBUTE, pos, '< is not allowed in an attribute value');
  }
  if (charClass === LINE_FEED_CLASS || charClass === CARRIAGE_RETURN_CLASS) state.flags |= WHITESPACE_FLAG;
  return handleSpecial(state, pos, charClass);
}

/**
 * Scans an attribute value from `start` to its closing `quote` or a reference, checking each
 * character. Returns that index, MORE, or `limit` if it gets there first.
 */
export function scanAttributeValue(state: ScanState, start: number, quote: number, limit = NO_LIMIT): number {
  const text = state.buffer;
  const table = state.tables.attribute;
  const end = text.length;
  const stop = Math.min(end, limit);
  let pos = start;
  while (pos < stop) {
    // eslint-disable-next-line prefer-code-point -- steps by code unit; checkNonAscii checks surrogate pairs
    const char = text.charCodeAt(pos);
    if (char < NON_ASCII && VALUE_NEEDS_TABLE[char] === 0) {
      pos++;
      continue;
    }
    if (char === quote || char === AMPERSAND) return pos;
    const last =
      char < NON_ASCII ? handleSpecialInValue(state, pos, table[char] as number) : checkNonAscii(state, pos, char);
    if (last === NEED_MORE) return NEED_MORE;
    pos = last + 1;
  }
  return pos < end ? pos : NEED_MORE;
}

/**
 * How many code units the character above U+007F at `pos` takes in a name: 0 if it can't be there,
 * 1 or 2 (a surrogate pair) if it can, or MORE. `first` asks whether it may start the name.
 */
function nonAsciiNameCharWidth(state: ScanState, pos: number, char: number, first: boolean): number {
  if (char < HIGH_SURROGATE_FIRST || char > HIGH_SURROGATE_LAST) {
    const allowed = first ? isNameStartCharBmp(char) : isNameCharBmp(char);
    return allowed ? 1 : 0;
  }
  // eslint-disable-next-line prefer-code-point -- reads one half of a surrogate pair
  const low = state.buffer.charCodeAt(pos + 1);
  if (Number.isNaN(low)) return state.final ? 0 : NEED_MORE;
  const paired = low >= LOW_SURROGATE_FIRST && low <= LOW_SURROGATE_LAST;
  return paired && codePointOf(char, low) <= NAME_LAST ? 2 : 0;
}

/** Records a colon at `pos` in the name being scanned. */
function recordColon(state: ScanState, pos: number): void {
  if (state.firstColon === -1) state.firstColon = pos;
  state.colonCount++;
}

/** Checks a name's first character at `start`; returns the index after it, `start` if it can't start a name, or MORE. */
function scanNameStart(state: ScanState, start: number): number {
  if (start >= state.buffer.length) return state.final ? start : NEED_MORE;
  // eslint-disable-next-line prefer-code-point -- steps by code unit; nonAsciiNameCharWidth checks surrogate pairs
  const char = state.buffer.charCodeAt(start);
  if (char >= NON_ASCII) {
    const width = nonAsciiNameCharWidth(state, start, char, true);
    return width === NEED_MORE ? NEED_MORE : start + width;
  }
  const nameClass = NAMES[char] as number;
  if (nameClass < NAME_START_CHAR) return start;
  if (nameClass === NAME_COLON) recordColon(state, start);
  return start + 1;
}

/**
 * Scans a name from `start`, recording its colons in `firstColon` and `colonCount`. Returns the
 * index after it, `start` when no name starts there, or MORE.
 */
export function scanName(state: ScanState, start: number): number {
  state.firstColon = -1;
  state.colonCount = 0;
  const afterFirst = scanNameStart(state, start);
  if (afterFirst <= start) return afterFirst;
  const text = state.buffer;
  const end = text.length;
  let pos = afterFirst;
  while (pos < end) {
    // eslint-disable-next-line prefer-code-point -- steps by code unit; nonAsciiNameCharWidth checks surrogate pairs
    const char = text.charCodeAt(pos);
    if (char < NON_ASCII) {
      const nameClass = NAMES[char] as number;
      if (nameClass === NOT_IN_NAMES) return pos;
      if (nameClass === NAME_COLON) recordColon(state, pos);
      pos++;
      continue;
    }
    const width = nonAsciiNameCharWidth(state, pos, char, false);
    if (width === NEED_MORE) return NEED_MORE;
    if (width === 0) return pos;
    pos += width;
  }
  return state.final ? end : NEED_MORE;
}

/** What ends the content `scanTo` reads: `--` in a comment, `?>` in a PI, `]]>` in a CDATA section. */
export const Terminator = { COMMENT: 0, PI: 1, CDATA: 2 } as const;

/** One of the terminators. */
export type TerminatorKind = (typeof Terminator)[keyof typeof Terminator];

/** The first character of each terminator, by kind. */
const TERMINATOR_FIRST_CHARS = [HYPHEN, QUESTION, RIGHT_BRACKET];

/** Returned by `terminatorStartsAt` when the terminator doesn't start there. */
const NOT_HERE = -2;

/** Whether `terminator` starts at `pos`, where its first character is: returns `pos` if so, MORE if that isn't known yet, or NOT_HERE. */
function terminatorStartsAt(text: string, pos: number, terminator: TerminatorKind): number {
  // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
  const second = text.charCodeAt(pos + 1);
  if (Number.isNaN(second)) return NEED_MORE;
  if (terminator === Terminator.COMMENT) return second === HYPHEN ? pos : NOT_HERE;
  if (terminator === Terminator.PI) return second === GREATER_THAN ? pos : NOT_HERE;
  if (second !== RIGHT_BRACKET) return NOT_HERE;
  // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
  const third = text.charCodeAt(pos + 2);
  if (Number.isNaN(third)) return NEED_MORE;
  return third === GREATER_THAN ? pos : NOT_HERE;
}

/** Checks one character of a comment, PI, CDATA section or literal; returns the index of its last code unit, or MORE. */
function checkDataChar(state: ScanState, pos: number, char: number): number {
  if (char >= NON_ASCII) return checkNonAscii(state, pos, char);
  const charClass = state.tables.data[char] as number;
  return charClass === ORDINARY ? pos : handleSpecial(state, pos, charClass);
}

/** Checks the characters of buffer indexes `[start, end)`, whose end is already known. */
export function scanSpan(state: ScanState, start: number, end: number): void {
  let pos = start;
  // eslint-disable-next-line prefer-code-point -- steps by code unit; checkNonAscii checks surrogate pairs
  while (pos < end) pos = Math.max(pos, checkDataChar(state, pos, state.buffer.charCodeAt(pos))) + 1;
}

/** Scans from `start` to `--` (comments), `?>` (PIs) or `]]>` (CDATA), checking characters; returns its index, or MORE. */
export function scanTo(state: ScanState, start: number, terminator: TerminatorKind): number {
  const text = state.buffer;
  const table = state.tables.data;
  const end = text.length;
  const firstChar = TERMINATOR_FIRST_CHARS[terminator] as number;
  let pos = start;
  while (pos < end) {
    // eslint-disable-next-line prefer-code-point -- steps by code unit; checkNonAscii checks surrogate pairs
    const char = text.charCodeAt(pos);
    if (char === firstChar) {
      const found = terminatorStartsAt(text, pos, terminator);
      if (found !== NOT_HERE) return found;
    }
    if (char < NON_ASCII && table[char] === ORDINARY) {
      pos++;
      continue;
    }
    const last = checkDataChar(state, pos, char);
    if (last === NEED_MORE) return NEED_MORE;
    pos = last + 1;
  }
  return NEED_MORE;
}
