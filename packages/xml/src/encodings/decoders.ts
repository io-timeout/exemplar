import type { Decoder } from '../input/decoders.ts';
import { NO_BYTES, concatBytes, isAscii } from '../util/bytes.ts';
import { Char, Unicode, highSurrogateOf, isHighSurrogate, isLowSurrogate, lowSurrogateOf } from '../util/chars.ts';
import { ErrorFactory } from '../util/errors.ts';
import { SINGLE_BYTE_TABLES } from './tables.ts';

// Module-level constants, so V8 can inline them.
const { HIGH_SURROGATE_FIRST, LOW_SURROGATE_LAST, SUPPLEMENTARY_FIRST, LAST_CODE_POINT } = Unicode;
const { NON_ASCII } = Char;

/** How many values a byte takes, and so how many entries a table for every byte holds. */
const BYTE_VALUES = 256;
/** How many bits a byte holds. */
const BYTE_BITS = 8;

/** The value a single-byte table gives a byte the encoding leaves undefined: U+FFFF, which no encoding maps to. */
const UNDEFINED_BYTE = 0xff_ff;

/** How many bytes a code unit takes in UTF-32 and in UTF-16. */
const UTF32_UNIT_BYTES = 4;
const UTF16_UNIT_BYTES = 2;

/** Thrown by exemplar's own decoders at bytes their encoding doesn't allow. */
export class DecodeError extends TypeError {
  /** The text decoded before the bad bytes, so the reader can still report it. */
  readonly decoded: string;

  constructor(encoding: string, decoded: string) {
    super(`The bytes are not legal ${encoding}`);
    this.name = 'DecodeError';
    this.decoded = decoded;
  }
}

/** The bytes a decoder carried over from the last chunk, an incomplete character, followed by the new ones. */
export function withCarry(carry: Uint8Array, bytes: Uint8Array = NO_BYTES): Uint8Array {
  return carry.length === 0 ? bytes : concatBytes(carry, bytes);
}

/** Turns code units into a string, a block at a time, natively. */
const UTF16_DECODER = new TextDecoder('utf-16le');

/** Decodes ASCII natively: UTF-8 reads it as every ASCII-compatible encoding does, and every runtime has it. */
const ASCII_DECODER = new TextDecoder();

/** The first `length` code units of `units` as a string. */
function unitsToString(units: Uint16Array, length: number): string {
  return UTF16_DECODER.decode(units.subarray(0, length));
}

/** A decoder for a single-byte encoding, by its table; a byte the table leaves undefined is an error. */
class SingleByteDecoder implements Decoder {
  readonly #name: string;
  /** The code unit each byte decodes to. */
  readonly #table: Uint16Array;
  /** Whether ASCII bytes decode to themselves, so that ASCII text can be decoded natively. */
  readonly #asciiCompatible: boolean;

  /** `table` holds the characters of the bytes from 0x80 for an ASCII-compatible encoding, or of every byte. */
  constructor(name: string, table: string) {
    this.#name = name;
    this.#table = new Uint16Array(BYTE_VALUES);
    // Bytes before the table's first, ASCII in an ASCII-compatible encoding, decode to themselves.
    const firstTableByte = BYTE_VALUES - table.length;
    this.#asciiCompatible = firstTableByte >= NON_ASCII;
    for (let byte = 0; byte < BYTE_VALUES; byte++) {
      // eslint-disable-next-line prefer-code-point -- table entries are 16-bit units
      this.#table[byte] = byte < firstTableByte ? byte : table.charCodeAt(byte - firstTableByte);
    }
  }

  decode(bytes?: Uint8Array): string {
    if (bytes === undefined) return '';
    if (this.#asciiCompatible && isAscii(bytes)) return ASCII_DECODER.decode(bytes);
    const table = this.#table;
    const units = new Uint16Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const unit = table[bytes[i] as number] as number;
      if (unit === UNDEFINED_BYTE) throw ErrorFactory.create(DecodeError, this.#name, unitsToString(units, i));
      units[i] = unit;
    }
    return unitsToString(units, bytes.length);
  }
}

/** The order of a 32-bit unit's bytes, most significant first: 1234 is big-endian, 4321 little-endian. */
export type ByteOrder = '1234' | '4321' | '2143' | '3412';

/** A decoder for UTF-32 and UCS-4 in any byte order; surrogates and values above U+10FFFF are an error. */
export class Utf32Decoder implements Decoder {
  readonly #name: string;
  /** How far each of a unit's four bytes, in order, shifts up into its value. */
  readonly #shifts: readonly number[];
  #carry = NO_BYTES;

  constructor(name: string, order: ByteOrder) {
    this.#name = name;
    // Each byte shifts up past the bytes below it: byte 1 past three, byte 4 past none.
    this.#shifts = order.split('').map((digit) => (UTF32_UNIT_BYTES - Number(digit)) * BYTE_BITS);
  }

  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string {
    const input = withCarry(this.#carry, bytes);
    const wholeUnitsEnd = input.length - (input.length % UTF32_UNIT_BYTES);
    this.#carry = input.slice(wholeUnitsEnd);
    if (options?.stream !== true && this.#carry.length > 0) {
      throw ErrorFactory.create(DecodeError, this.#name, this.#decodeWholeUnits(input, wholeUnitsEnd));
    }
    return this.#decodeWholeUnits(input, wholeUnitsEnd);
  }

  /** Decodes the whole units before `end`; a surrogate or a value above U+10FFFF is an error. */
  #decodeWholeUnits(input: Uint8Array, end: number): string {
    const [shift1, shift2, shift3, shift4] = this.#shifts as [number, number, number, number];
    // Room for two UTF-16 code units per character, as a surrogate pair needs.
    const units = new Uint16Array((end / UTF32_UNIT_BYTES) * 2);
    let length = 0;
    for (let i = 0; i < end; i += UTF32_UNIT_BYTES) {
      // Read unsigned, so a top byte of 0x80 or more makes the value too large rather than negative.
      const codePoint =
        (((input[i] as number) << shift1) |
          ((input[i + 1] as number) << shift2) |
          ((input[i + 2] as number) << shift3) |
          ((input[i + 3] as number) << shift4)) >>>
        0;
      if (codePoint > LAST_CODE_POINT || (codePoint >= HIGH_SURROGATE_FIRST && codePoint <= LOW_SURROGATE_LAST)) {
        throw ErrorFactory.create(DecodeError, this.#name, unitsToString(units, length));
      }
      if (codePoint >= SUPPLEMENTARY_FIRST) {
        units[length++] = highSurrogateOf(codePoint);
        units[length++] = lowSurrogateOf(codePoint);
      } else {
        units[length++] = codePoint;
      }
    }
    return unitsToString(units, length);
  }
}

/** UTF-16 through a fatal `TextDecoder`; at bad bytes it reports the text before them, as exemplar's own decoders do. */
export class Utf16Decoder implements Decoder {
  readonly #name: 'UTF-16LE' | 'UTF-16BE';
  readonly #littleEndian: boolean;
  readonly #native: TextDecoder;
  #carry = NO_BYTES;

  constructor(name: 'UTF-16LE' | 'UTF-16BE') {
    this.#name = name;
    this.#littleEndian = name === 'UTF-16LE';
    this.#native = new TextDecoder(this.#littleEndian ? 'utf-16le' : 'utf-16be', { fatal: true, ignoreBOM: true });
  }

  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string {
    const input = withCarry(this.#carry, bytes);
    let end = input.length;
    if (options?.stream === true) {
      // An odd byte, or a high surrogate, waits for the rest of its character in the next chunk.
      end -= end % UTF16_UNIT_BYTES;
      const lastUnit = end - UTF16_UNIT_BYTES;
      if (lastUnit >= 0 && isHighSurrogate(this.#codeUnitAt(input, lastUnit))) end = lastUnit;
    }
    this.#carry = input.slice(end);
    const whole = input.subarray(0, end);
    try {
      return this.#native.decode(whole);
    } catch {
      const valid = whole.subarray(0, this.#validLength(whole));
      throw ErrorFactory.create(DecodeError, this.#name, this.#native.decode(valid));
    }
  }

  /** The code unit whose two bytes start at `pos`, in this decoder's byte order. */
  #codeUnitAt(bytes: Uint8Array, pos: number): number {
    const first = bytes[pos] as number;
    const second = bytes[pos + 1] as number;
    return this.#littleEndian ? first | (second << BYTE_BITS) : (first << BYTE_BITS) | second;
  }

  /** How many bytes from the start hold whole characters, up to the first lone surrogate or odd byte. */
  #validLength(bytes: Uint8Array): number {
    let pos = 0;
    while (pos + UTF16_UNIT_BYTES <= bytes.length) {
      const length = this.#characterLength(bytes, pos);
      if (length === 0) return pos;
      pos += length;
    }
    return pos;
  }

  /** How many bytes the character at `pos` takes: one unit, or a surrogate pair; 0 for a lone surrogate. */
  #characterLength(bytes: Uint8Array, pos: number): number {
    const unit = this.#codeUnitAt(bytes, pos);
    if (isLowSurrogate(unit)) return 0;
    if (!isHighSurrogate(unit)) return UTF16_UNIT_BYTES;
    const low = pos + UTF16_UNIT_BYTES;
    const paired = low + UTF16_UNIT_BYTES <= bytes.length && isLowSurrogate(this.#codeUnitAt(bytes, low));
    return paired ? 2 * UTF16_UNIT_BYTES : 0;
  }
}

/** A factory for each single-byte table's decoder, by the encoding's canonical name. */
export const SINGLE_BYTE_DECODERS: Readonly<Record<string, () => Decoder>> = Object.fromEntries(
  Object.entries(SINGLE_BYTE_TABLES).map(([name, table]) => [name, () => new SingleByteDecoder(name, table)])
);

/** Whether a canonical encoding name is an EBCDIC code page exemplar decodes; their tables cover every byte. */
export function isEbcdic(name: string): boolean {
  return SINGLE_BYTE_TABLES[name]?.length === BYTE_VALUES;
}
