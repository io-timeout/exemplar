import { errorOf, parseEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import {
  Char,
  Unicode,
  byCodeUnit,
  codePointLabel,
  codePointOf,
  highSurrogateOf,
  holdsNonChar,
  isChar,
  isHighSurrogate,
  isLowSurrogate,
  isRestrictedChar,
  isSurrogate,
  lowSurrogateOf,
} from '@/util/chars.ts';

/** The character each named code unit stands for. */
const CHARACTERS: Record<keyof typeof Char, string> = {
  TAB: '\t',
  LINE_FEED: '\n',
  CARRIAGE_RETURN: '\r',
  SPACE: ' ',
  EXCLAMATION: '!',
  DOUBLE_QUOTE: '"',
  HASH: '#',
  PERCENT: '%',
  AMPERSAND: '&',
  APOSTROPHE: "'",
  LEFT_PAREN: '(',
  RIGHT_PAREN: ')',
  ASTERISK: '*',
  PLUS: '+',
  COMMA: ',',
  HYPHEN: '-',
  PERIOD: '.',
  SLASH: '/',
  DIGIT_ZERO: '0',
  DIGIT_NINE: '9',
  COLON: ':',
  SEMICOLON: ';',
  LESS_THAN: '<',
  EQUALS: '=',
  GREATER_THAN: '>',
  QUESTION: '?',
  UPPER_A: 'A',
  UPPER_E: 'E',
  UPPER_F: 'F',
  UPPER_N: 'N',
  UPPER_Z: 'Z',
  LEFT_BRACKET: '[',
  RIGHT_BRACKET: ']',
  UNDERSCORE: '_',
  LOWER_A: 'a',
  LOWER_F: 'f',
  LOWER_X: 'x',
  LOWER_Z: 'z',
  VERTICAL_BAR: '|',
  DELETE: '\u007F',
  NON_ASCII: '\u0080',
  NEXT_LINE: '\u0085',
  LINE_SEPARATOR: '\u2028',
  NONCHARACTER_FFFE: '\uFFFE',
  NONCHARACTER_FFFF: '\uFFFF',
};

describe('Char', () => {
  it.each(Object.entries(CHARACTERS))('names %s for the code unit of %j', (name, character) => {
    expect(Char[name as keyof typeof Char]).toBe(character.charCodeAt(0));
  });
});

describe('surrogates', () => {
  it.each([0x1_00_00, 0x1_f6_00, 0x2_00_0b, 0x10_ff_ff])('split U+%s into a pair and join it again', (codePoint) => {
    const pair = String.fromCodePoint(codePoint);
    const [high, low] = [highSurrogateOf(codePoint), lowSurrogateOf(codePoint)];
    expect([high, low]).toEqual([pair.charCodeAt(0), pair.charCodeAt(1)]);
    expect(codePointOf(high, low)).toBe(codePoint);
  });

  it('tells high from low surrogates, and both from other code units', () => {
    const units = [0xd7_ff, Unicode.HIGH_SURROGATE_FIRST, 0xdb_ff, Unicode.LOW_SURROGATE_FIRST, 0xdf_ff, 0xe0_00];
    expect(units.map((c) => [isSurrogate(c), isHighSurrogate(c), isLowSurrogate(c)])).toEqual([
      [false, false, false],
      [true, true, false],
      [true, true, false],
      [true, false, true],
      [true, false, true],
      [false, false, false],
    ]);
  });

  it('names the ends of the code point ranges', () => {
    expect([Unicode.SUPPLEMENTARY_FIRST, Unicode.LAST_CODE_POINT]).toEqual([0x1_00_00, 0x10_ff_ff]);
  });
});

describe('byCodeUnit', () => {
  it('orders as the default sort does, by code unit rather than locale', () => {
    const words = ['b', 'B', 'a', 'é', 'e', 'ab', 'a', ''];
    expect(words.toSorted(byCodeUnit)).toEqual(['', 'B', 'a', 'a', 'ab', 'b', 'e', 'é']);
    expect([byCodeUnit('a', 'a'), byCodeUnit('a', 'b'), byCodeUnit('b', 'a')]).toEqual([0, -1, 1]);
  });
});

describe('codePointLabel', () => {
  it.each([
    [0x00, 'U+0000'],
    [0xa0, 'U+00A0'],
    [0xff_fe, 'U+FFFE'],
    [0x1_f6_00, 'U+1F600'],
  ])('writes %i as %s', (c, label) => {
    expect(codePointLabel(c)).toBe(label);
  });
});

describe('characters (§2.2 [2], XML 1.1 §2.2 [2])', () => {
  it.each(
    [0x09, 0x0a, 0x0d, 0x20, 0x7f, 0x85, 0xd7_ff, 0xe0_00, 0xff_fd, 0x1_00_00, 0x10_ff_ff].map((c) => codePointLabel(c))
  )('allows %s in both versions', (name) => {
    const c = Number.parseInt(name.slice(2), 16);
    expect(isChar(c, false)).toBe(true);
    expect(isChar(c, true)).toBe(true);
  });

  it.each([0x00, 0xd8_00, 0xdb_ff, 0xdc_00, 0xdf_ff, 0xff_fe, 0xff_ff, 0x11_00_00].map((c) => codePointLabel(c)))(
    'excludes %s in both versions',
    (name) => {
      const c = Number.parseInt(name.slice(2), 16);
      expect(isChar(c, false)).toBe(false);
      expect(isChar(c, true)).toBe(false);
    }
  );

  it('allows the C0 controls but NUL only in XML 1.1', () => {
    for (let c = 1; c < 0x20; c++) {
      expect(isChar(c, true), codePointLabel(c)).toBe(true);
      expect(isChar(c, false), codePointLabel(c)).toBe(c === 0x09 || c === 0x0a || c === 0x0d);
    }
  });

  it('allows C0 controls in XML 1.1 only as references', () => {
    expect(parseEveryWay('<?xml version="1.1"?><a>&#x1;</a>')).toBe('<a>\u0001</a>');
    expect(errorOf('<?xml version="1.1"?><a>\u0001</a>').code).toBe('WF_INVALID_CHARACTER');
  });

  it('names the RestrictedChars, which XML 1.1 documents hold only as references (XML 1.1 §2.2 [2a])', () => {
    const ranges = [
      [0x1, 0x8],
      [0xb, 0xc],
      [0xe, 0x1f],
      [0x7f, 0x84],
      [0x86, 0x9f],
    ];
    for (let c = 0; c <= 0xff_ff; c++) {
      const restricted = ranges.some(([low, high]) => c >= (low as number) && c <= (high as number));
      expect(isRestrictedChar(c), codePointLabel(c)).toBe(restricted);
    }
  });
});

describe('holdsNonChar', () => {
  const nul = String.fromCharCode(0x00);
  const soh = String.fromCharCode(0x01);
  const lone = String.fromCharCode(0xd8_00);
  const fffe = String.fromCharCode(0xff_fe);

  it('finds a character outside Char, or a lone surrogate, in either version', () => {
    for (const version11 of [false, true]) {
      expect(holdsNonChar(`a${nul}`, version11)).toBe(true);
      expect(holdsNonChar(`a${lone}b`, version11)).toBe(true);
      expect(holdsNonChar(fffe, version11)).toBe(true);
      expect(holdsNonChar(`a\tb${String.fromCodePoint(0x1_f6_00)}`, version11)).toBe(false);
    }
  });

  it('allows the C0 controls but NUL only in XML 1.1', () => {
    expect([holdsNonChar(soh, false), holdsNonChar(soh, true)]).toEqual([true, false]);
  });
});
