import { lastIndexAtOrBefore } from './arrays.ts';
import { Char } from './chars.ts';
import {
  CHARACTER_REFERENCE_OPEN_LENGTH,
  HEX_REFERENCE_OPEN_LENGTH,
  PREDEFINED_ENTITIES,
  readDigits,
} from './references.ts';

// Module-level constants, so V8 can inline them.
const { HASH, LINE_FEED, LOWER_X } = Char;

/** An XML 1.1 line end: CR LF, CR NEL, a lone CR, NEL or LS. */
const LINE_END_XML_11 = /\r[\n\u0085]?|[\u0085\u2028]/g;
/** A two-character line end, CR LF, which normalizing turns into one LF; XML 1.1 adds CR NEL. */
const TWO_CHARACTER_LINE_END = /\r\n/g;
const TWO_CHARACTER_LINE_END_XML_11 = /\r[\n\u0085]/g;
/** The whitespace left in an attribute value once its line ends are normalized: tab and LF. */
const TAB_OR_LINE_FEED = /[\t\n]/g;
/** The whitespace in an attribute value from replacement text, whose line ends stay as they are: tab, LF and CR. */
const TAB_LINE_FEED_OR_CR = /[\t\n\r]/g;

/**
 * Turns every line end into a single LF (§2.11). Files written on Windows end lines with CR LF and
 * old Mac files with a lone CR; XML reads both as LF, so `a\r\nb` becomes `a\nb`. XML 1.1 also
 * counts NEL, LS and CR NEL as line ends (XML 1.1 §2.11).
 */
export function normalizeLineEnds(text: string, version11: boolean): string {
  if (version11) return text.replaceAll(LINE_END_XML_11, '\n');
  let cr = text.indexOf('\r');
  if (cr === -1) return text;
  let normalized = '';
  let copiedTo = 0;
  while (cr !== -1) {
    // A CR before an LF is dropped; a lone CR becomes an LF.
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    normalized += text.charCodeAt(cr + 1) === LINE_FEED ? text.slice(copiedTo, cr) : `${text.slice(copiedTo, cr)}\n`;
    copiedTo = cr + 1;
    cr = text.indexOf('\r', copiedTo);
  }
  return normalized + text.slice(copiedTo);
}

/**
 * Maps an index in text whose line ends were normalized back to the index in the text as given. Each
 * CR LF became one LF, so in `a\r\nb` the `b` is at 2 once normalized but at 3 as given.
 */
export function rawIndexMapper(raw: string, version11: boolean): (index: number) => number {
  let shifts: number[] | undefined;
  return (index) => {
    shifts ??= shiftPositions(raw, version11);
    return index + lastIndexAtOrBefore(shifts, index) + 1;
  };
}

/** The normalized index of each LF that stands for a two-character line end, from which on indexes shift by one more. */
function shiftPositions(raw: string, version11: boolean): number[] {
  const positions: number[] = [];
  for (const match of raw.matchAll(version11 ? TWO_CHARACTER_LINE_END_XML_11 : TWO_CHARACTER_LINE_END)) {
    positions.push(match.index - positions.length);
  }
  return positions;
}

/**
 * Replaces each reference in text with what it stands for (§4.1, §4.6): `&lt;` and the other
 * predefined entities with their character, `&#38;` and `&#x26;` with the character they name,
 * and a reference to any other entity with nothing, since that entity's text is reported apart.
 * The tokenizer has already checked that every reference is well-formed.
 */
export function decodeReferences(text: string): string {
  let decoded = '';
  let copiedTo = 0;
  for (let ampersand = text.indexOf('&'); ampersand !== -1; ampersand = text.indexOf('&', copiedTo)) {
    const semicolon = text.indexOf(';', ampersand);
    decoded += text.slice(copiedTo, ampersand) + referenceText(text, ampersand, semicolon);
    copiedTo = semicolon + 1;
  }
  return copiedTo === 0 ? text : decoded + text.slice(copiedTo);
}

/** What the reference from the `&` at `ampersand` to the `;` at `semicolon` stands for. */
function referenceText(text: string, ampersand: number, semicolon: number): string {
  // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
  if (text.charCodeAt(ampersand + 1) !== HASH)
    return PREDEFINED_ENTITIES.get(text.slice(ampersand + 1, semicolon)) ?? '';
  // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
  const isHex = text.charCodeAt(ampersand + CHARACTER_REFERENCE_OPEN_LENGTH) === LOWER_X;
  const digitsStart = ampersand + (isHex ? HEX_REFERENCE_OPEN_LENGTH : CHARACTER_REFERENCE_OPEN_LENGTH);
  const [, codePoint] = readDigits(text, digitsStart, isHex);
  return String.fromCodePoint(codePoint);
}

/**
 * Normalizes an attribute value as written in a start tag (§3.3.3): line ends first, then each
 * whitespace character becomes a space, then references are decoded. So `a="1\t2"` reads as `1 2`,
 * while `a="1&#9;2"` keeps its tab, because a reference is decoded after the whitespace is replaced.
 *
 * Replacement text skips the line-end step: its line ends were normalized when the entity was
 * declared, so any CR left in it came from a character reference and becomes a space here.
 */
export function normalizeAttributeValue(value: string, version11: boolean, isReplacementText: boolean): string {
  const normalized = isReplacementText ? value : normalizeLineEnds(value, version11);
  return decodeReferences(normalized.replaceAll(isReplacementText ? TAB_LINE_FEED_OR_CR : TAB_OR_LINE_FEED, ' '));
}
