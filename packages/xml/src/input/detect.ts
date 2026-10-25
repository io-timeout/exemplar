import { isEbcdic } from '../encodings/decoders.ts';
import { SINGLE_BYTE_TABLES } from '../encodings/tables.ts';
import { ErrorCode } from '../errors/codes.ts';
import { couldStartDeclaration, DECLARATION_START_LENGTH, startsWithDeclaration } from '../tokenizer/declaration.ts';
import { XML_DECLARATION_OPEN_LENGTH } from '../tokenizer/syntax.ts';
import { BYTE_ORDER_MARK } from '../util/bytes.ts';
import { Char } from '../util/chars.ts';
import { canonicalEncoding } from './decoders.ts';

/** The four-byte encodings, by byte order. */
type Utf32Encoding = 'utf-32be' | 'utf-32le' | 'x-ucs-4-2143' | 'x-ucs-4-3412';

/** The byte order or ASCII-compatibility the first bytes show, or EBCDIC. */
export type EncodingFamily = 'utf-16le' | 'utf-16be' | Utf32Encoding | 'ascii' | 'ebcdic';

/** What the first bytes of a document say about its encoding. */
export interface Detection {
  /** The encoding a byte-order mark at the start shows, if there is one. */
  readonly byteOrderMark?: 'utf-8' | 'utf-16le' | 'utf-16be' | Utf32Encoding;
  /** How many bytes that mark takes, which decoding skips; 0 without one. */
  readonly byteOrderMarkLength: number;
  /** The byte order or ASCII compatibility the first bytes show. */
  readonly family: EncodingFamily;
  /** The encoding supplied from outside, such as an HTTP charset. */
  readonly external?: string;
  /** The canonical name of the decoder to use. */
  readonly decoderName: string;
}

/** A zero byte, which pads a character to the width of UTF-16 or UTF-32. */
const ZERO_BYTE = 0x00;

/** Stands for any byte, or none, in a signature. */
const ANY_BYTE = -1;

/** The bytes EBCDIC writes for the characters of `<?xm` and `?>`. */
const EbcdicByte = { LESS_THAN: 0x4c, QUESTION: 0x6f, LOWER_X: 0xa7, LOWER_M: 0x94, GREATER_THAN: 0x6e } as const;

/** Bytes a document may start with, and what they show. */
interface Signature<T> {
  /** The bytes, ANY_BYTE matching any byte or none. */
  readonly bytes: readonly number[];
  /** What a document that starts with them is in. */
  readonly shows: T;
}

const { UTF8, UTF16BE, UTF16LE } = BYTE_ORDER_MARK;

/** The byte-order marks, UTF-32's being UTF-16's with two zero bytes; the four-byte ones first, as FF FE 00 00 cannot begin UTF-16, which forbids NUL. */
const BYTE_ORDER_MARKS: readonly Signature<NonNullable<Detection['byteOrderMark']>>[] = [
  { bytes: [ZERO_BYTE, ZERO_BYTE, ...UTF16BE], shows: 'utf-32be' },
  { bytes: [...UTF16LE, ZERO_BYTE, ZERO_BYTE], shows: 'utf-32le' },
  { bytes: [ZERO_BYTE, ZERO_BYTE, ...UTF16LE], shows: 'x-ucs-4-2143' },
  { bytes: [...UTF16BE, ZERO_BYTE, ZERO_BYTE], shows: 'x-ucs-4-3412' },
  { bytes: UTF8, shows: 'utf-8' },
  { bytes: UTF16BE, shows: 'utf-16be' },
  { bytes: UTF16LE, shows: 'utf-16le' },
];

/** How each family writes the `<` of `<?xml`, or EBCDIC the whole `<?xm`, tried in order (Appendix F.1). */
const FAMILY_SIGNATURES: readonly Signature<EncodingFamily>[] = [
  { bytes: [ZERO_BYTE, ZERO_BYTE, ZERO_BYTE, Char.LESS_THAN], shows: 'utf-32be' },
  { bytes: [Char.LESS_THAN, ZERO_BYTE, ZERO_BYTE, ZERO_BYTE], shows: 'utf-32le' },
  { bytes: [ZERO_BYTE, ZERO_BYTE, Char.LESS_THAN, ZERO_BYTE], shows: 'x-ucs-4-2143' },
  { bytes: [ZERO_BYTE, Char.LESS_THAN, ZERO_BYTE, ZERO_BYTE], shows: 'x-ucs-4-3412' },
  { bytes: [EbcdicByte.LESS_THAN, EbcdicByte.QUESTION, EbcdicByte.LOWER_X, EbcdicByte.LOWER_M], shows: 'ebcdic' },
  { bytes: [ZERO_BYTE, Char.LESS_THAN], shows: 'utf-16be' },
  // UTF-16LE's `<`, then a character with a zero byte, such as `?` or a letter.
  { bytes: [Char.LESS_THAN, ZERO_BYTE, ANY_BYTE, ZERO_BYTE], shows: 'utf-16le' },
  { bytes: [Char.LESS_THAN, ZERO_BYTE, ZERO_BYTE, ANY_BYTE], shows: 'utf-16le' },
];

/** The most bytes a signature takes, and so the most detection waits for before it decides. */
const SIGNATURE_LENGTH = 4;

/** The bytes a signature can start with. */
const SIGNATURE_STARTS: ReadonlySet<number> = new Set(
  [...BYTE_ORDER_MARKS, ...FAMILY_SIGNATURES].map(({ bytes }) => bytes[0] as number)
);

/** Whether the head starts with a signature's bytes, ANY_BYTE matching any byte or none. */
function startsWithSignature(head: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, i) => byte === ANY_BYTE || head[i] === byte);
}

/** An encoding declaration, with the name in it (§4.3.3). */
const ENCODING_DECLARATION = /\sencoding\s*=\s*["']([A-Za-z][\w.-]*)["']/;

const IBM037_TABLE = SINGLE_BYTE_TABLES['ibm037'] as string;

/** IBM1026 writes `"` at 0xFC, where IBM037_TABLE writes it at 0x7F. */
const IBM1026_QUOTE = 0xfc;

/** Reads the characters of an XML declaration in every EBCDIC page: IBM037_TABLE, with IBM1026's `"` too. */
const EBCDIC_DECLARATION_CHARS = `${IBM037_TABLE.slice(0, IBM1026_QUOTE)}"${IBM037_TABLE.slice(IBM1026_QUOTE + 1)}`;

/** Reads the first `end` bytes of the head as the characters of a declaration. */
function headAsText(head: Uint8Array, end: number, inEbcdic: boolean): string {
  let text = '';
  for (let i = 0; i < end; i++) {
    const byte = head[i] as number;
    // eslint-disable-next-line prefer-code-point -- a byte, read as Latin-1
    text += inEbcdic ? EBCDIC_DECLARATION_CHARS.charAt(byte) : String.fromCharCode(byte);
  }
  return text;
}

/** The index of the `?>` that ends the declaration, searching from `from`; -1 if it is not yet read. */
function findDeclarationEnd(head: Uint8Array, from: number, inEbcdic: boolean): number {
  const question = inEbcdic ? EbcdicByte.QUESTION : Char.QUESTION;
  const greater = inEbcdic ? EbcdicByte.GREATER_THAN : Char.GREATER_THAN;
  for (let i = head.indexOf(question, from); i !== -1; i = head.indexOf(question, i + 1)) {
    if (head[i + 1] === greater) return i;
  }
  return -1;
}

/** Reads the `encoding` of an XML declaration in ASCII or EBCDIC, its end searched for from `from`; null if not yet read. */
function declaredEncodingInHead(head: Uint8Array, inEbcdic: boolean, from: number): string | undefined | null {
  const start = headAsText(head, Math.min(head.length, DECLARATION_START_LENGTH), inEbcdic);
  // Too few bytes to tell whether `<?xml` and its whitespace begin the document.
  if (start.length < DECLARATION_START_LENGTH) return couldStartDeclaration(start) ? null : undefined;
  if (!startsWithDeclaration(start)) return undefined;
  // The closing `?>` can come straight after `<?xml`, as in `<?xml?>`.
  const end = findDeclarationEnd(head, Math.max(from, XML_DECLARATION_OPEN_LENGTH), inEbcdic);
  if (end === -1) return null;
  return ENCODING_DECLARATION.exec(headAsText(head, end, inEbcdic))?.[1];
}

/** Detects a byte-order mark at the start of the head, and so the encoding. */
function detectByteOrderMark(head: Uint8Array): Detection | undefined {
  const mark = BYTE_ORDER_MARKS.find(({ bytes }) => startsWithSignature(head, bytes));
  if (mark === undefined) return undefined;
  const { bytes, shows: encoding } = mark;
  // UTF-8 is ASCII-compatible; the other marks give their own byte order.
  const family = encoding === 'utf-8' ? 'ascii' : encoding;
  return { byteOrderMark: encoding, byteOrderMarkLength: bytes.length, family, decoderName: encoding };
}

/** Tells the encoding family without a BOM by how the first `<?xm` is written (Appendix F.1). */
function encodingFamilyOf(head: Uint8Array): EncodingFamily {
  return FAMILY_SIGNATURES.find(({ bytes }) => startsWithSignature(head, bytes))?.shows ?? 'ascii';
}

/** Whether fewer than four bytes may still begin a byte-order mark, or `<` in a form other than ASCII's. */
function mayNeedMoreBytes(head: Uint8Array): boolean {
  const [first, second] = head;
  // `<` may still be UTF-16LE or UTF-32LE only while a zero byte may follow it.
  if (first === Char.LESS_THAN) return second === undefined || second === ZERO_BYTE;
  return first === undefined || SIGNATURE_STARTS.has(first);
}

/**
 * Detects the encoding as XML 1.0 §4.3.3 and Appendix F say, with RFC 7303's precedence for a BOM.
 * Returns undefined when more bytes are needed; the first `searched` bytes need no search for the declaration's end again.
 */
export function detect(head: Uint8Array, final: boolean, external?: string, searched = 0): Detection | undefined {
  if (head.length < SIGNATURE_LENGTH && !final && mayNeedMoreBytes(head)) return undefined;
  const byteOrderMark = detectByteOrderMark(head);
  if (byteOrderMark) return byteOrderMark;
  const family = encodingFamilyOf(head);
  if (external !== undefined) {
    const name = canonicalEncoding(external);
    return { byteOrderMarkLength: 0, family, external: name, decoderName: decoderFor(name, family) };
  }
  if (family !== 'ascii' && family !== 'ebcdic') return { byteOrderMarkLength: 0, family, decoderName: family };
  return detectFromDeclaration(head, family, final, searched);
}

/** Detects ASCII-compatible or EBCDIC bytes by the declaration in them; undefined while its end may be still to come. */
function detectFromDeclaration(
  head: Uint8Array,
  family: 'ascii' | 'ebcdic',
  final: boolean,
  searched: number
): Detection | undefined {
  // `?` may end the bytes searched before, with its `>` among the new ones.
  const declared = declaredEncodingInHead(head, family === 'ebcdic', searched - 1);
  if (declared === null && !final) return undefined;
  const fallback = family === 'ebcdic' ? 'ibm037' : 'utf-8';
  const name = declared ? canonicalEncoding(declared) : fallback;
  // A declaration that does not fit the first bytes is decoded as they show, so the check can report the mismatch.
  const fits = family === 'ebcdic' ? isEbcdic(name) : !isAsciiIncompatible(name);
  return { byteOrderMarkLength: 0, family, decoderName: fits ? name : fallback };
}

/** The decoder for an encoding supplied from outside: UTF-16 and UTF-32 take their byte order from the first bytes. */
function decoderFor(name: string, family: EncodingFamily): string {
  if (name === 'utf-16') return family === 'utf-16le' ? 'utf-16le' : 'utf-16be';
  if (name !== 'utf-32') return name;
  return isUtf32Family(family) ? family : 'utf-32be';
}

/** A problem with the declared encoding, and how serious it is. */
export interface EncodingProblem {
  readonly code: ErrorCode;
  readonly message: string;
  /** How it is reported: a fatal error, a recoverable error, or a warning. */
  readonly level: 'fatal' | 'error' | 'warning';
}

/** Whether an encoding can't be what ASCII-compatible first bytes show: UTF-16, UTF-32 or EBCDIC. */
function isAsciiIncompatible(name: string): boolean {
  return isUtf16(name) || name.startsWith('utf-32') || name.startsWith('x-ucs-4') || isEbcdic(name);
}

/** Whether an encoding name belongs to the UTF-16 family. */
function isUtf16(name: string): boolean {
  return name === 'utf-16' || name === 'utf-16le' || name === 'utf-16be';
}

/** Whether a family is one of the four-byte byte orders. */
function isUtf32Family(family: EncodingFamily): boolean {
  return family === 'utf-32be' || family === 'utf-32le' || family === 'x-ucs-4-2143' || family === 'x-ucs-4-3412';
}

/** A problem with the declared encoding. */
function encodingProblem(code: ErrorCode, message: string, level: EncodingProblem['level']): EncodingProblem {
  return { code, message, level };
}

/** A fatal mismatch between the detected and declared encodings. */
function encodingMismatch(detected: string, declaration: string): EncodingProblem {
  return encodingProblem(
    ErrorCode.ENCODING_MISMATCH,
    `The document is in ${detected} but declares ${declaration}`,
    'fatal'
  );
}

/** Checks an encoding supplied from outside against the declaration: a conflict is only worth a warning (RFC 7303 §3.2). */
function checkExternal(detection: Detection, declaration: string | undefined): EncodingProblem | undefined {
  const declared = declaration === undefined ? undefined : canonicalEncoding(declaration);
  if (declared === undefined || declared === detection.external || detection.byteOrderMark !== undefined)
    return undefined;
  const message = `The encoding supplied from outside, ${detection.external}, overrides the declared ${declaration}`;
  return encodingProblem(ErrorCode.ENCODING_CONFLICT, message, 'warning');
}

/** Checks a document that detection found ASCII-compatible. */
function checkAscii(detection: Detection, declaration: string, declared: string): EncodingProblem | undefined {
  if (isAsciiIncompatible(declared))
    return encodingMismatch(detection.byteOrderMark ?? 'an ASCII-compatible encoding', declaration);
  if (detection.byteOrderMark === 'utf-8' && declared !== 'utf-8') return encodingMismatch('UTF-8', declaration);
  return undefined;
}

/** Checks a document that detection found in UTF-16. */
function checkUtf16(detection: Detection, declaration: string, declared: string): EncodingProblem | undefined {
  if (!isUtf16(declared) || (declared !== 'utf-16' && declared !== detection.family)) {
    return encodingMismatch(detection.family, declaration);
  }
  if (declared !== 'utf-16' || detection.byteOrderMark !== undefined) return undefined;
  return encodingProblem(
    ErrorCode.ENCODING_UTF16_WITHOUT_BOM,
    'A document declared as UTF-16 must begin with a byte-order mark',
    'error'
  );
}

/** Checks the encoding the XML declaration names against what detection found (§4.3.3, Appendix F, RFC 7303). */
export function checkDeclaredEncoding(
  detection: Detection | undefined,
  declaration: string | undefined
): EncodingProblem | undefined {
  if (detection === undefined) return undefined;
  if (detection.external !== undefined) return checkExternal(detection, declaration);
  if (declaration === undefined) {
    if (detection.family === 'ascii' || detection.byteOrderMark !== undefined) return undefined;
    const message = `A document in ${detection.family} without a byte-order mark must declare its encoding`;
    return encodingProblem(ErrorCode.ENCODING_UNDECLARED, message, 'fatal');
  }
  const declared = canonicalEncoding(declaration);
  if (detection.family === 'ebcdic') return isEbcdic(declared) ? undefined : encodingMismatch('EBCDIC', declaration);
  // A four-byte encoding must be declared as UTF-32, in its byte order if named.
  if (isUtf32Family(detection.family)) {
    return declared === 'utf-32' || declared === detection.family
      ? undefined
      : encodingMismatch(detection.family, declaration);
  }
  return detection.family === 'ascii'
    ? checkAscii(detection, declaration, declared)
    : checkUtf16(detection, declaration, declared);
}
