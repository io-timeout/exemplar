import { outcome } from '@test/helpers/bytes.ts';
import { describe, expect, it } from 'vitest';

// Each case is the bytes in hex and what the JDK decodes them to, or null for an error.

describe("EUC-KR (KS X 1001 rows of Microsoft's CP949.TXT)", () => {
  it.each([
    ['a1a1', '\u3000'],
    ['a2e6', '€'],
    ['a2e7', '®'],
    ['a2e8', '㉾'],
    ['a4a1', 'ㄱ'],
    ['a4d4', '\u3164'],
    ['a5a1', 'ⅰ'],
    ['a5aa', 'ⅹ'],
    ['acf1', 'я'],
    ['b0a1', '가'],
    ['c8fe', '힝'],
    ['caa1', '伽'],
    ['cafe', '龕'],
    ['fdfe', '詰'],
    ['80', null],
    ['a0', null],
    ['a1', null],
    ['ff', null],
    // A Unified Hangul Code extension that EUC-KR does not have.
    ['8141', null],
    ['a1a0', null],
    ['a1ff', null],
    ['a2e9', null],
    ['a5ab', null],
    ['acf2', null],
    ['c9a1', null],
    ['fea1', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('euc-kr', input)).toBe(text);
  });
});
