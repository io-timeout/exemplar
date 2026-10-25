import type { Decoder } from '@exemplarjs/xml';
import { DecodeError, NO_BYTES, withCarry } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';

/** U+FFFF marks a sequence a table leaves undefined. */
const UNDEFINED = 0xff_ff;

/** The rows and cells of the JIS, KS and GB character sets: 94 of each, numbered from byte 0xA1 as EUC writes them. */
export const Euc = { FIRST: 0xa1, LAST: 0xfe, COUNT: 94 } as const;

/** Half-width katakana: bytes 0xA1–0xDF in Shift_JIS and after EUC-JP's SS2, U+FF61–U+FF9F in Unicode. */
const Katakana = { BYTE_FIRST: 0xa1, BYTE_LAST: 0xdf, UNICODE_FIRST: 0xff_61 } as const;

/** Bytes below this are ASCII in every encoding here. */
const ASCII_END = 0x80;

/** How much decoded text gathers in a run before it is joined onto the output, which keeps the joins few. */
const RUN_FLUSH_LENGTH = 4096;

/** Decodes base64 into 16-bit units, little-endian. */
export function unitsFromBase64(base64: string): Uint16Array {
  const binary = atob(base64);
  const units = new Uint16Array(binary.length / 2);
  // eslint-disable-next-line prefer-code-point -- reads bytes from a binary string
  for (let i = 0; i < units.length; i++) units[i] = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
  return units;
}

/**
 * Characters by two-byte sequence, as a grid: a row per lead byte from `leadFirst` up to 0xFE, a
 * column per trail byte in the trail ranges. GBK's trail ranges are 0x40–0x7E and 0x80–0xFE, so its
 * rows are 190 wide, and 0x81 0x80 is row 0, column 63. Each cell holds a UTF-16 code unit, U+FFFF
 * where the sequence is undefined.
 */
export class PairTable {
  readonly #leadFirst: number;
  /** Each trail byte's column plus one, or 0 for a byte no trail range holds. */
  readonly #columns = new Uint8Array(256);
  readonly #columnCount: number;
  /** The cells, row by row. */
  readonly #units: Uint16Array;

  /** Takes the trail ranges as first and last byte in turn. */
  constructor(leadFirst: number, trailRanges: readonly number[], units: Uint16Array) {
    this.#leadFirst = leadFirst;
    let column = 0;
    for (let range = 0; range < trailRanges.length; range += 2) {
      const last = trailRanges[range + 1] as number;
      for (let trail = trailRanges[range] as number; trail <= last; trail++) this.#columns[trail] = ++column;
    }
    this.#columnCount = column;
    this.#units = units;
  }

  /** The code unit for a sequence, or U+FFFF. */
  get(lead: number, trail: number): number {
    const column = this.#columns[trail] as number;
    if (lead < this.#leadFirst || lead > Euc.LAST || column === 0) return UNDEFINED;
    return this.#units[(lead - this.#leadFirst) * this.#columnCount + column - 1] ?? UNDEFINED;
  }
}

/** Where a charset departs from its shared table, as the JDK decodes it: by byte, two bytes, or the two after EUC-JP's 0x8F. */
export interface Overrides {
  /** Each is base64 of runs: a two-byte first key, a count, then a three-byte code point per key, 0xFFFFFF for an error. */
  readonly singles?: string;
  readonly pairs?: string;
  readonly triples?: string;
}

/**
 * A decoder for an encoding whose characters take one byte or more: it reads one sequence at a time,
 * as long as its first byte says, and carries an incomplete sequence from one chunk to the next. The
 * subclasses say what a sequence decodes to; the overrides come first, where the JDK decodes a
 * charset differently from the shared table, and a null override is an error.
 */
abstract class MultiByteDecoder implements Decoder {
  readonly #name: string;
  /** 1 for each byte that starts a two-byte sequence, else 0. */
  readonly #isLead: Uint8Array;
  readonly #singleOverrides: ReadonlyMap<number, string | null>;
  readonly #pairOverrides: ReadonlyMap<number, string | null>;
  /** The bytes of an incomplete sequence at the end of the last chunk. */
  #carry = NO_BYTES;

  constructor(name: string, leads: string, overrides: Overrides) {
    this.#name = name;
    this.#isLead = leadFlags(leads);
    this.#singleOverrides = overridesFromRuns(overrides.singles);
    this.#pairOverrides = overridesFromRuns(overrides.pairs);
  }

  /** How many bytes the sequence starting with this byte takes: two after a lead byte, else one. */
  protected sequenceLength(bytes: Uint8Array, start: number): number {
    return this.#isLead[bytes[start] as number] === 1 ? 2 : 1;
  }

  /** A single byte's character, or undefined: ASCII. */
  protected singleByteChar(byte: number): string | undefined {
    // eslint-disable-next-line prefer-code-point -- an ASCII byte
    return byte < ASCII_END ? String.fromCharCode(byte) : undefined;
  }

  /** A two-byte sequence's character, or undefined. */
  protected abstract pairChar(lead: number, trail: number): string | undefined;

  /** A longer sequence's character, for encodings that have them. */
  protected longerSequenceChar(_bytes: Uint8Array, _start: number, _length: number): string | undefined {
    return undefined;
  }

  /** Decodes a chunk; with `stream`, an incomplete sequence at its end waits for the next chunk. */
  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string {
    const input = withCarry(this.#carry, bytes);
    this.#carry = NO_BYTES;
    let decoded = '';
    let run = '';
    for (let i = 0; i < input.length;) {
      const length = this.sequenceLength(input, i);
      if (i + length > input.length) {
        if (options?.stream !== true) throw ErrorFactory.create(DecodeError, this.#name, decoded + run);
        this.#carry = input.slice(i);
        break;
      }
      const char = this.#decodeSequence(input, i, length);
      if (char === undefined) throw ErrorFactory.create(DecodeError, this.#name, decoded + run);
      run += char;
      if (run.length > RUN_FLUSH_LENGTH) {
        decoded += run;
        run = '';
      }
      i += length;
    }
    return decoded + run;
  }

  /** The character of the sequence at `start`, an override first; undefined when it decodes to an error. */
  #decodeSequence(input: Uint8Array, start: number, length: number): string | undefined {
    const first = input[start] as number;
    if (length === 1) {
      const overridden = this.#singleOverrides.get(first);
      return overridden === undefined ? this.singleByteChar(first) : (overridden ?? undefined);
    }
    if (length === 2) {
      const trail = input[start + 1] as number;
      const overridden = this.#pairOverrides.get((first << 8) | trail);
      return overridden === undefined ? this.pairChar(first, trail) : (overridden ?? undefined);
    }
    return this.longerSequenceChar(input, start, length);
  }
}

/** The code point an override gives for a sequence that decodes to an error. */
const ERROR_CODE_POINT = 0xff_ff_ff;

/** Overrides keyed by the bytes as one number, from their packed runs; null marks an error. */
function overridesFromRuns(runs: string | undefined): Map<number, string | null> {
  const overrides = new Map<number, string | null>();
  if (runs === undefined) return overrides;
  const bytes = atob(runs);
  /** A big-endian number from `length` bytes at `start`. */
  const readNumber = (start: number, length: number): number => {
    let value = 0;
    // eslint-disable-next-line prefer-code-point -- reads bytes from a binary string
    for (let offset = 0; offset < length; offset++) value = (value << 8) | bytes.charCodeAt(start + offset);
    return value;
  };
  for (let i = 0; i < bytes.length;) {
    const firstKey = readNumber(i, 2);
    const count = readNumber(i + 2, 1);
    i += 3;
    for (let offset = 0; offset < count; offset++, i += 3) {
      const codePoint = readNumber(i, 3);
      overrides.set(firstKey + offset, codePoint === ERROR_CODE_POINT ? null : String.fromCodePoint(codePoint));
    }
  }
  return overrides;
}

/** A table's code unit as a string, or undefined for U+FFFF. */
function charOfUnit(unit: number): string | undefined {
  // eslint-disable-next-line prefer-code-point -- table entries are 16-bit units
  return unit === UNDEFINED ? undefined : String.fromCharCode(unit);
}

/** Lead bytes from a 256-bit mask in hex: each digit holds four bytes' flags, the lowest byte in the lowest bit. */
function leadFlags(mask: string): Uint8Array {
  const isLead = new Uint8Array(256);
  for (let byte = 0; byte < 256; byte++) {
    const digit = Number.parseInt(mask[Math.floor(byte / 4)] ?? '0', 16);
    isLead[byte] = (digit >> (byte % 4)) & 1;
  }
  return isLead;
}

/** A half-width katakana byte's character, or undefined for a byte outside them. */
function halfWidthKatakana(byte: number): string | undefined {
  if (byte < Katakana.BYTE_FIRST || byte > Katakana.BYTE_LAST) return undefined;
  // eslint-disable-next-line prefer-code-point -- below U+10000
  return String.fromCharCode(Katakana.UNICODE_FIRST + byte - Katakana.BYTE_FIRST);
}

/**
 * Shift_JIS folds two JIS X 0208 rows into each lead byte, 0x81–0x9F and then 0xE0 onwards, past the katakana bytes.
 * The 188 trail bytes run 0x40–0xFC without 0x7F: the first 94 are a cell of the odd row, the rest of the even row.
 */
const ShiftJis = {
  LEAD_FIRST: 0x81,
  LEAD_LAST_BEFORE_KATAKANA: 0x9f,
  LEAD_FIRST_AFTER_KATAKANA: 0xe0,
  TRAIL_FIRST: 0x40,
  TRAIL_GAP: 0x7f,
  TRAIL_LAST: 0xfc,
  TRAILS_PER_LEAD: 188,
  /** The leads windows-31j gives to private use, and the code point they start at. */
  PRIVATE_LEAD_FIRST: 0xf0,
  PRIVATE_LEAD_LAST: 0xf9,
  PRIVATE_USE_FIRST: 0xe0_00,
} as const;

/** Which pair of JIS rows a Shift_JIS lead byte covers, counting from 0. */
function shiftJisLeadIndex(lead: number): number {
  if (lead <= ShiftJis.LEAD_LAST_BEFORE_KATAKANA) return lead - ShiftJis.LEAD_FIRST;
  const before = ShiftJis.LEAD_LAST_BEFORE_KATAKANA - ShiftJis.LEAD_FIRST + 1;
  return before + lead - ShiftJis.LEAD_FIRST_AFTER_KATAKANA;
}

/** A Shift_JIS trail byte's place among the 188, counting from 0. */
function shiftJisTrailIndex(trail: number): number {
  return trail < ShiftJis.TRAIL_GAP ? trail - ShiftJis.TRAIL_FIRST : trail - ShiftJis.TRAIL_FIRST - 1;
}

/** Shift_JIS and windows-31j: JIS X 0208 rows folded into two-byte codes, half-width katakana as single bytes. */
export class ShiftJisDecoder extends MultiByteDecoder {
  readonly #jis: PairTable;
  /** Whether lead bytes 0xF0–0xF9 are the user-defined area, which windows-31j maps to U+E000–U+E757. */
  readonly #hasPrivateUse: boolean;

  constructor(
    name: string,
    jis: PairTable,
    leads: string,
    overrides: Overrides,
    userDefinedArea: 'private use' | 'unmapped' = 'unmapped'
  ) {
    super(name, leads, overrides);
    this.#jis = jis;
    this.#hasPrivateUse = userDefinedArea === 'private use';
  }

  protected override singleByteChar(byte: number): string | undefined {
    return halfWidthKatakana(byte) ?? super.singleByteChar(byte);
  }

  protected pairChar(lead: number, trail: number): string | undefined {
    if (trail < ShiftJis.TRAIL_FIRST || trail === ShiftJis.TRAIL_GAP || trail > ShiftJis.TRAIL_LAST) return undefined;
    const trailIndex = shiftJisTrailIndex(trail);
    const row = shiftJisLeadIndex(lead) * 2 + (trailIndex < Euc.COUNT ? 0 : 1);
    const cell = trailIndex % Euc.COUNT;
    if (row < Euc.COUNT) return charOfUnit(this.#jis.get(Euc.FIRST + row, Euc.FIRST + cell));
    if (!this.#hasPrivateUse || lead > ShiftJis.PRIVATE_LEAD_LAST) return undefined;
    const offset = (lead - ShiftJis.PRIVATE_LEAD_FIRST) * ShiftJis.TRAILS_PER_LEAD + trailIndex;
    // eslint-disable-next-line prefer-code-point -- private use, below U+10000
    return String.fromCharCode(ShiftJis.PRIVATE_USE_FIRST + offset);
  }
}

/** EUC-JP's single shifts: SS2 before a half-width katakana byte, SS3 before two bytes of JIS X 0212. */
const SINGLE_SHIFT_2 = 0x8e;
const SINGLE_SHIFT_3 = 0x8f;

/** EUC-JP: JIS X 0208 in two bytes, half-width katakana after SS2, JIS X 0212 in three bytes after SS3. */
export class EucJpDecoder extends MultiByteDecoder {
  readonly #jis: PairTable;
  /** JIS X 0212, the supplementary kanji read after SS3. */
  readonly #supplementary: PairTable;
  /** Overrides for the two bytes after SS3. */
  readonly #tripleOverrides: ReadonlyMap<number, string | null>;

  constructor(name: string, jis: PairTable, supplementary: PairTable, leads: string, overrides: Overrides) {
    super(name, leads, overrides);
    this.#jis = jis;
    this.#supplementary = supplementary;
    this.#tripleOverrides = overridesFromRuns(overrides.triples);
  }

  protected override sequenceLength(bytes: Uint8Array, start: number): number {
    return bytes[start] === SINGLE_SHIFT_3 ? 3 : super.sequenceLength(bytes, start);
  }

  protected pairChar(lead: number, trail: number): string | undefined {
    if (lead === SINGLE_SHIFT_2) return halfWidthKatakana(trail);
    return charOfUnit(this.#jis.get(lead, trail));
  }

  protected override longerSequenceChar(bytes: Uint8Array, start: number): string | undefined {
    const [lead, trail] = [bytes[start + 1] as number, bytes[start + 2] as number];
    const overridden = this.#tripleOverrides.get((lead << 8) | trail);
    return overridden === undefined ? charOfUnit(this.#supplementary.get(lead, trail)) : (overridden ?? undefined);
  }
}

/** A double-byte encoding read through one table: GBK, GB2312, Big5, Big5-HKSCS and EUC-KR. */
export class DoubleByteDecoder extends MultiByteDecoder {
  readonly #table: PairTable;
  /** The lowest trail byte the encoding allows, for one that uses only part of its table, as GB2312 uses GBK's. */
  readonly #trailFirst: number;

  constructor(name: string, table: PairTable, leads: string, overrides: Overrides, trailFirst = 0) {
    super(name, leads, overrides);
    this.#table = table;
    this.#trailFirst = trailFirst;
  }

  protected pairChar(lead: number, trail: number): string | undefined {
    return trail < this.#trailFirst ? undefined : charOfUnit(this.#table.get(lead, trail));
  }
}

/** The modes of ISO-2022-JP. */
const Mode = { ASCII: 0, ROMAN: 1, JIS0208: 2, KANA: 3 } as const;

/** The control bytes of ISO-2022-JP: an escape starts a mode switch, SO shifts to katakana and SI back. */
const ESCAPE = 0x1b;
const SHIFT_OUT = 0x0e;
const SHIFT_IN = 0x0f;

/** The mode each escape sequence switches to, by the two bytes after ESC. */
const ESCAPE_MODES: ReadonlyMap<string, number> = new Map([
  ['(B', Mode.ASCII],
  ['(J', Mode.ROMAN],
  ['(I', Mode.KANA],
  ['$@', Mode.JIS0208],
  ['$B', Mode.JIS0208],
]);

/** ISO-2022-JP writes JIS X 0208 bytes and katakana without their high bit: 0x21 and up, rather than 0xA1. */
const HIGH_BIT = 0x80;
const KANA_BYTE_FIRST = Katakana.BYTE_FIRST - HIGH_BIT;
const KANA_BYTE_LAST = Katakana.BYTE_LAST - HIGH_BIT;

/** ISO-2022-JP as the JDK reads it: ASCII, JIS X 0201 Roman and katakana, and JIS X 0208, switched by escapes, SO and SI. */
export class Iso2022JpDecoder implements Decoder {
  readonly #jis: PairTable;
  /** The mode the bytes are read in, which escapes, SO and SI switch. */
  #mode: number = Mode.ASCII;
  /** The mode SO left, which SI returns to. */
  #modeBeforeShiftOut: number = Mode.ASCII;
  /** The bytes of an incomplete sequence at the end of the last chunk. */
  #carry = NO_BYTES;
  /** The text the last step decoded. */
  #stepText = '';

  constructor(jis: PairTable) {
    this.#jis = jis;
  }

  /** Decodes a chunk; with `stream`, an incomplete sequence at its end waits for the next chunk. */
  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string {
    const input = withCarry(this.#carry, bytes);
    this.#carry = NO_BYTES;
    let decoded = '';
    let i = 0;
    while (i < input.length) {
      const length = this.#decodeStep(input, i);
      if (length === undefined) throw ErrorFactory.create(DecodeError, 'ISO-2022-JP', decoded);
      if (length < 0) {
        if (options?.stream !== true) throw ErrorFactory.create(DecodeError, 'ISO-2022-JP', decoded);
        this.#carry = input.slice(i);
        break;
      }
      decoded += this.#stepText;
      i += length;
    }
    return decoded;
  }

  /** Reads one escape, shift or character; returns how many bytes it took, -1 when more are needed, or undefined on an error. */
  #decodeStep(input: Uint8Array, start: number): number | undefined {
    const byte = input[start] as number;
    this.#stepText = '';
    if (byte >= ASCII_END) return undefined;
    if (byte === ESCAPE) return this.#switchMode(input, start);
    if (byte === SHIFT_OUT) {
      this.#modeBeforeShiftOut = this.#mode;
      this.#mode = Mode.KANA;
      return 1;
    }
    if (byte === SHIFT_IN) {
      this.#mode = this.#modeBeforeShiftOut;
      return 1;
    }
    switch (this.#mode) {
      case Mode.JIS0208: {
        if (start + 1 >= input.length) return -1;
        const unit = this.#jis.get(byte + HIGH_BIT, (input[start + 1] as number) + HIGH_BIT);
        if (unit === UNDEFINED) return undefined;
        // eslint-disable-next-line prefer-code-point -- table entries are 16-bit units
        this.#stepText = String.fromCharCode(unit);
        return 2;
      }
      case Mode.KANA: {
        if (byte > KANA_BYTE_LAST) return undefined;
        // Bytes below the katakana land on the code points before U+FF61, as the JDK decodes them.
        // eslint-disable-next-line prefer-code-point -- below U+10000
        this.#stepText = String.fromCharCode(Katakana.UNICODE_FIRST + byte - KANA_BYTE_FIRST);
        return 1;
      }
      default: {
        // eslint-disable-next-line prefer-code-point -- an ASCII byte
        this.#stepText = this.#mode === Mode.ROMAN ? romanChar(byte) : String.fromCharCode(byte);
        return 1;
      }
    }
  }

  /** Switches mode at an escape sequence; returns its length, -1 when more bytes are needed, or undefined if unknown. */
  #switchMode(input: Uint8Array, start: number): number | undefined {
    if (start + 2 >= input.length) return -1;
    const mode = ESCAPE_MODES.get(String.fromCodePoint(input[start + 1] as number, input[start + 2] as number));
    if (mode === undefined) return undefined;
    this.#mode = mode;
    return 3;
  }
}

/** Where JIS X 0201 Roman differs from ASCII: the yen sign for the backslash, the overline for the tilde. */
const ROMAN: ReadonlyMap<number, string> = new Map([
  [0x5c, '\u00A5'],
  [0x7e, '\u203E'],
]);

/** A JIS X 0201 Roman byte's character. */
function romanChar(byte: number): string {
  // eslint-disable-next-line prefer-code-point -- an ASCII byte
  return ROMAN.get(byte) ?? String.fromCharCode(byte);
}
