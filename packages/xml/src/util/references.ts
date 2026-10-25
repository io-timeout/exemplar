import { Char, Unicode } from './chars.ts';

// Module-level constants, so V8 can inline them.
const { DIGIT_ZERO, DIGIT_NINE, LOWER_A, LOWER_F, UPPER_A, UPPER_F } = Char;

/** The five predefined entities (§4.6), which every document has without declaring them, and their characters. */
export const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
]);

/** The lengths of `&#` and `&#x`, which come before a character reference's digits. */
export const CHARACTER_REFERENCE_OPEN_LENGTH = '&#'.length;
export const HEX_REFERENCE_OPEN_LENGTH = '&#x'.length;

/** A value past every code point. A reference's value stops growing here, so a long run of digits can't overflow. */
const BEYOND_CODE_POINTS = Unicode.LAST_CODE_POINT + 1;

/**
 * Reads the digits of a character reference from `start`, decimal or hexadecimal. Returns the
 * index after the last digit and the value, which is capped just above U+10FFFF.
 */
export function readDigits(text: string, start: number, isHex: boolean): [number, number] {
  let value = 0;
  let pos = start;
  for (; pos < text.length; pos++) {
    // eslint-disable-next-line prefer-code-point -- digits are ASCII
    const digit = digitValue(text.charCodeAt(pos), isHex);
    if (digit < 0) break;
    value = Math.min(value * (isHex ? 16 : 10) + digit, BEYOND_CODE_POINTS);
  }
  return [pos, value];
}

/** The value of a decimal digit, or of a hexadecimal one when `isHex`; -1 for anything else. */
function digitValue(char: number, isHex: boolean): number {
  if (char >= DIGIT_ZERO && char <= DIGIT_NINE) return char - DIGIT_ZERO;
  if (!isHex) return -1;
  if (char >= LOWER_A && char <= LOWER_F) return char - LOWER_A + 10;
  if (char >= UPPER_A && char <= UPPER_F) return char - UPPER_A + 10;
  return -1;
}

/**
 * The code point a character reference names, given what lies between its `&` and `;`: `#38`
 * or `#x26`. Returns -1 when that is malformed.
 */
export function codePointOfReference(body: string): number {
  const isHex = body.startsWith('#x');
  const start = isHex ? '#x'.length : '#'.length;
  const [end, value] = readDigits(body, start, isHex);
  return end === start || end !== body.length ? -1 : value;
}
