import { Char } from './chars.ts';

// Module-level constants, so V8 can inline them.
const { CARRIAGE_RETURN, LINE_FEED, LINE_SEPARATOR, NEXT_LINE, SPACE, TAB } = Char;

/**
 * Whether a code unit is whitespace in markup (S, §2.3 [3]): space, tab, LF or CR. In XML 1.1,
 * NEL and LS count too: line-end normalization turns them into LF (XML 1.1 §2.11), and the
 * scanners read text before it is normalized.
 */
export function isWhitespaceChar(char: number, version11: boolean): boolean {
  if (char === SPACE || char === LINE_FEED || char === TAB || char === CARRIAGE_RETURN) return true;
  return version11 && (char === NEXT_LINE || char === LINE_SEPARATOR);
}

/** Whether the span `[start, end)` of text holds only whitespace, as `isWhitespaceChar` decides it. */
export function isWhitespaceSpan(text: string, start: number, end: number, version11: boolean): boolean {
  for (let i = start; i < end; i++) {
    // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
    if (!isWhitespaceChar(text.charCodeAt(i), version11)) return false;
  }
  return true;
}

/** Whether text is all whitespace (S, §2.3 [3]): space, tab, LF and CR. True for the empty string. */
export function isAllWhitespace(text: string): boolean {
  return isWhitespaceSpan(text, 0, text.length, false);
}

/**
 * Normalizes a public identifier (§4.2.2, XML Catalogs §6.2): each run of whitespace becomes one
 * space, and there is none at either end.
 */
export function normalizePublicId(id: string): string {
  return id
    .replaceAll(/[\t\n\r ]+/g, ' ')
    .replace(/^ /, '')
    .replace(/ $/, '');
}
