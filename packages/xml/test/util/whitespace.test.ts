import { describe, expect, it } from 'vitest';
import { isAllWhitespace, isWhitespaceChar, isWhitespaceSpan, normalizePublicId } from '@/util/whitespace.ts';

describe('whitespace (§2.3 [3])', () => {
  it('is space, tab, LF and CR, and in XML 1.1 also NEL and LS', () => {
    for (const c of [0x20, 0x09, 0x0a, 0x0d]) {
      expect(isWhitespaceChar(c, false)).toBe(true);
      expect(isWhitespaceChar(c, true)).toBe(true);
    }
    for (const c of [0x85, 0x20_28]) {
      expect(isWhitespaceChar(c, false)).toBe(false);
      expect(isWhitespaceChar(c, true)).toBe(true);
    }
    for (const c of [0x0b, 0x0c, 0xa0, 0x30_00, 0x20_29, Number.NaN]) {
      expect(isWhitespaceChar(c, false)).toBe(false);
      expect(isWhitespaceChar(c, true)).toBe(false);
    }
  });
});

describe('blank text', () => {
  it('is space, tab, LF and CR only, and in XML 1.1 also NEL and LS', () => {
    expect(isWhitespaceSpan(' \t\r\n', 0, 4, false)).toBe(true);
    expect(isWhitespaceSpan('x \n', 1, 3, false)).toBe(true);
    expect(isWhitespaceSpan('', 0, 0, false)).toBe(true);
    expect(isWhitespaceSpan(' x ', 0, 3, false)).toBe(false);
    expect(isWhitespaceSpan('\u0085\u2028', 0, 2, false)).toBe(false);
    expect(isWhitespaceSpan('\u0085\u2028', 0, 2, true)).toBe(true);
    expect(isWhitespaceSpan('\u00A0', 0, 1, true)).toBe(false);
  });
});

describe('isAllWhitespace', () => {
  const nbsp = String.fromCharCode(0xa0);
  const nel = String.fromCharCode(0x85);

  it.each([
    ['', true],
    [' \t\r\n', true],
    ['a', false],
    [' a ', false],
    [nbsp, false],
    [nel, false],
  ])('tells whether %j is all white space', (text, expected) => {
    expect(isAllWhitespace(text)).toBe(expected);
  });
});

describe('normalizePublicId (§4.2.2, XML Catalogs §6.2)', () => {
  it.each([
    ['-//A//DTD One//EN', '-//A//DTD One//EN'],
    ['  -//A//DTD   One//EN ', '-//A//DTD One//EN'],
    ['-//A//DTD\tTab\nLine\r\nEnd//EN', '-//A//DTD Tab Line End//EN'],
    ['\n\t ', ''],
  ])('normalizes %j to %j', (id, expected) => {
    expect(normalizePublicId(id)).toBe(expected);
  });
});
