import { describe, expect, it } from 'vitest';
import {
  CharClass,
  NAME_CLASSES,
  NameClass,
  TABLES_XML_10,
  TABLES_XML_11,
  TABLES_REPLACEMENT_TEXT,
  isNameCharBmp,
  isNameStartCharBmp,
} from '@/scan/classes.ts';

const hex = (c: number): string => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

describe('the class tables', () => {
  it('give every class its own value, with 0 ordinary', () => {
    expect(CharClass.ORDINARY).toBe(0);
    expect(new Set(Object.values(CharClass)).size).toBe(Object.keys(CharClass).length);
  });

  it('class the C0 controls but tab, LF and CR as invalid in XML 1.0 (§2.2 [2])', () => {
    for (let c = 0; c < 0x20; c++) {
      if (c !== 0x09 && c !== 0x0a && c !== 0x0d) expect(TABLES_XML_10.data[c], hex(c)).toBe(CharClass.INVALID);
    }
    expect([TABLES_XML_10.data[0x09], TABLES_XML_10.data[0x0a], TABLES_XML_10.data[0x0d]]).toEqual([
      0,
      0,
      CharClass.CARRIAGE_RETURN,
    ]);
    expect(TABLES_XML_10.data[0x7f]).toBe(CharClass.ORDINARY);
  });

  it('class DEL as invalid in XML 1.1, where it is a RestrictedChar (XML 1.1 §2.2 [2a])', () => {
    expect(TABLES_XML_11.data[0x7f]).toBe(CharClass.INVALID);
    expect(TABLES_XML_11.data[0x01]).toBe(CharClass.INVALID);
  });

  it('stop text at <, & and ], and attribute values at <, &, quotes and whitespace', () => {
    for (const tables of [TABLES_XML_10, TABLES_XML_11]) {
      expect([tables.text[0x3c], tables.text[0x26], tables.text[0x5d]]).toEqual([
        CharClass.LESS_THAN,
        CharClass.AMPERSAND,
        CharClass.RIGHT_BRACKET,
      ]);
      expect([tables.text[0x22], tables.text[0x0a], tables.text[0x3e]]).toEqual([0, 0, 0]);
      expect([tables.attribute[0x22], tables.attribute[0x27]]).toEqual([CharClass.QUOTE, CharClass.QUOTE]);
      expect([tables.attribute[0x09], tables.attribute[0x0a], tables.attribute[0x0d]]).toEqual([
        CharClass.WHITESPACE,
        CharClass.LINE_FEED,
        CharClass.CARRIAGE_RETURN,
      ]);
      expect([tables.attribute[0x3c], tables.attribute[0x26], tables.attribute[0x5d]]).toEqual([
        CharClass.LESS_THAN,
        CharClass.AMPERSAND,
        0,
      ]);
      expect([tables.data[0x3c], tables.data[0x26], tables.data[0x5d]]).toEqual([0, 0, 0]);
    }
  });

  it('trust replacement text, whose characters were checked and whose line ends were normalized', () => {
    for (let c = 0; c < 0x20; c++) expect(TABLES_REPLACEMENT_TEXT.data[c]).toBe(CharClass.ORDINARY);
    expect(TABLES_REPLACEMENT_TEXT.text[0x0d]).toBe(CharClass.ORDINARY);
    expect([
      TABLES_REPLACEMENT_TEXT.attribute[0x09],
      TABLES_REPLACEMENT_TEXT.attribute[0x0a],
      TABLES_REPLACEMENT_TEXT.attribute[0x0d],
    ]).toEqual([CharClass.WHITESPACE, CharClass.WHITESPACE, CharClass.WHITESPACE]);
  });
});

describe('name characters (§2.3 [4], [4a], fifth edition)', () => {
  it('class ASCII letters, _ and : as name starts, digits, - and . as name characters', () => {
    const start = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_';
    for (let c = 0; c < 0x80; c++) {
      const ch = String.fromCharCode(c);
      let expected: number = NameClass.NONE;
      if (start.includes(ch)) expected = NameClass.NAME_START_CHAR;
      else if (ch === ':') expected = NameClass.COLON;
      else if ('0123456789-.'.includes(ch)) expected = NameClass.NAME_CHAR;
      expect(NAME_CLASSES[c], hex(c)).toBe(expected);
    }
  });

  it.each(
    [
      [0xc0, 0xd6],
      [0xd8, 0xf6],
      [0xf8, 0x2_ff],
      [0x3_70, 0x3_7d],
      [0x3_7f, 0x1f_ff],
      [0x20_0c, 0x20_0d],
      [0x20_70, 0x21_8f],
      [0x2c_00, 0x2f_ef],
      [0x30_01, 0xd7_ff],
      [0xf9_00, 0xfd_cf],
      [0xfd_f0, 0xff_fd],
    ].map(([low, high]) => [hex(low as number), hex(high as number), low as number, high as number] as const)
  )('lets a name start with %s to %s, and not just outside them', (_, __, low, high) => {
    expect(isNameStartCharBmp(low)).toBe(true);
    expect(isNameStartCharBmp(high)).toBe(true);
    expect(isNameStartCharBmp(low - 1)).toBe(false);
    expect(isNameStartCharBmp(high + 1)).toBe(false);
  });

  it('lets a name go on with U+00B7, U+0300–U+036F and U+203F–U+2040, which cannot start one', () => {
    for (const c of [0xb7, 0x3_00, 0x3_6f, 0x20_3f, 0x20_40]) {
      expect(isNameCharBmp(c), hex(c)).toBe(true);
      expect(isNameStartCharBmp(c), hex(c)).toBe(false);
    }
    for (const c of [0xb6, 0xb8, 0x20_3e, 0x20_41, 0xd7, 0xf7, 0x3_7e, 0xff_fe])
      expect(isNameCharBmp(c), hex(c)).toBe(false);
    expect(isNameCharBmp(0xc0)).toBe(true);
  });
});
