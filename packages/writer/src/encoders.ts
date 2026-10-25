import { ErrorCode } from '@exemplarjs/xml';
import { SINGLE_BYTE_TABLES, canonicalEncoding, codePointLabel } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { WriterError } from './error.ts';

/** Turns written text into bytes in one encoding. */
export interface Encoder {
  /** The encoding's name as the XML declaration gives it. */
  readonly name: string;
  /** The byte order mark the output starts with, if the encoding has one. */
  readonly byteOrderMark: Uint8Array | undefined;
  encode(text: string): Uint8Array;
  /** Matches the first character the encoding cannot hold, if it cannot hold every character. */
  readonly unencodable: RegExp | undefined;
}

const utf8 = new TextEncoder();

/** U+FEFF, which UTF-16 output starts with as its byte order mark. */
const BYTE_ORDER_MARK = '\uFEFF';

/** The bytes in a UTF-16 code unit. */
const UNIT_BYTES = 2;

/** The values a byte can take. */
const BYTE_VALUES = 256;

/** U+FFFF marks a byte a single-byte table leaves undefined. */
const UNDEFINED = 0xff_ff;

/** Text as UTF-16 code units in one byte order. */
function utf16Bytes(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(text.length * UNIT_BYTES);
  const view = new DataView(bytes.buffer);
  // eslint-disable-next-line prefer-code-point -- UTF-16 is written in code units
  for (let i = 0; i < text.length; i++) view.setUint16(i * UNIT_BYTES, text.charCodeAt(i), littleEndian);
  return bytes;
}

/** Encodes UTF-16 code units in one byte order, after a byte order mark or not. */
function utf16(name: string, byteOrder: 'big-endian' | 'little-endian', mark: 'with BOM' | 'without BOM'): Encoder {
  const littleEndian = byteOrder === 'little-endian';
  return {
    name,
    byteOrderMark: mark === 'with BOM' ? utf16Bytes(BYTE_ORDER_MARK, littleEndian) : undefined,
    unencodable: undefined,
    encode: (text) => utf16Bytes(text, littleEndian),
  };
}

/** The name an XML declaration gives a single-byte encoding: IANA's preferred spelling. */
function declaredName(canonical: string): string {
  return /^(iso|us|koi8|ibm)/.test(canonical) ? canonical.toUpperCase() : canonical;
}

/** Each code unit's byte from a decoding table of the upper bytes, the lower ones decoding to themselves; the first byte wins. */
function reverseTable(table: string): Map<number, number> {
  const bytes = new Map<number, number>();
  const tableStart = BYTE_VALUES - table.length;
  for (let byte = 0; byte < BYTE_VALUES; byte++) {
    // eslint-disable-next-line prefer-code-point -- table entries are 16-bit units
    const unit = byte < tableStart ? byte : table.charCodeAt(byte - tableStart);
    if (unit !== UNDEFINED && !bytes.has(unit)) bytes.set(unit, byte);
  }
  return bytes;
}

/** A code unit as a regular expression escape, `\uXXXX`. */
function unicodeEscape(unit: number): string {
  return String.raw`\u` + unit.toString(16).padStart(4, '0');
}

/** Encodes one byte per character through a decoding table reversed. */
function singleByte(canonical: string, table: string): Encoder {
  const name = declaredName(canonical);
  const bytes = reverseTable(table);
  const encodable = [...bytes.keys()].map((unit) => unicodeEscape(unit)).join('');
  return {
    name,
    byteOrderMark: undefined,
    unencodable: new RegExp(`[^${encodable}]`),
    encode(text) {
      const encoded = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        // eslint-disable-next-line prefer-code-point -- single-byte encodings hold no surrogate pairs
        const byte = bytes.get(text.charCodeAt(i));
        if (byte === undefined) {
          const code = text.codePointAt(i) as number;
          throw ErrorFactory.create(
            WriterError,
            ErrorCode.WRITE_ENCODING,
            `${codePointLabel(code)} cannot be written in ${name}`
          );
        }
        encoded[i] = byte;
      }
      return encoded;
    },
  };
}

/** The encoders built in, by canonical encoding name. */
const ENCODERS: Readonly<Record<string, () => Encoder>> = {
  'utf-8': () => ({
    name: 'UTF-8',
    byteOrderMark: undefined,
    unencodable: undefined,
    encode: (text) => utf8.encode(text),
  }),
  'utf-16': () => utf16('UTF-16', 'big-endian', 'with BOM'),
  'utf-16be': () => utf16('UTF-16BE', 'big-endian', 'without BOM'),
  'utf-16le': () => utf16('UTF-16LE', 'little-endian', 'without BOM'),
  ...Object.fromEntries(
    Object.entries(SINGLE_BYTE_TABLES).map(([name, table]) => [name, () => singleByte(name, table)])
  ),
};

/** The encoder for an encoding name; throws when none is built in. */
export function encoderFor(name: string): Encoder {
  const createEncoder = ENCODERS[canonicalEncoding(name)];
  if (createEncoder === undefined) throw ErrorFactory.create(RangeError, `There is no encoder for ${name}`);
  return createEncoder();
}
