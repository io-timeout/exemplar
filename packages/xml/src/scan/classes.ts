import { Char } from '../util/chars.ts';

// Module-level constants, so V8 can inline them.
const { NON_ASCII } = Char;

/** The last code point a name may hold (§2.3 [4]). */
export const NAME_LAST = 0xe_ff_ff;

/**
 * What a scanning loop must do with an ASCII code unit. The loops look each one up in a class table
 * (`ClassTables`); most code units are ORDINARY and need nothing, so a loop only compares with 0.
 */
export const CharClass = {
  /** Needs nothing; the loop steps over it. */
  ORDINARY: 0,
  /** An LF, which in an attribute value becomes a space. */
  LINE_FEED: 1,
  /** A CR, which line-end normalization must handle. */
  CARRIAGE_RETURN: 2,
  /** `<`, which ends text and may not appear in an attribute value. */
  LESS_THAN: 3,
  /** `&`, which starts a reference. */
  AMPERSAND: 4,
  /** `]`, which may start the `]]>` that character data may not hold. */
  RIGHT_BRACKET: 5,
  /** A character the document may not hold, such as a C0 control in XML 1.0. */
  INVALID: 6,
  /** Whitespace in an attribute value that becomes a space and needs nothing else. */
  WHITESPACE: 7,
  /** `"` or `'`, which may close an attribute value. */
  QUOTE: 8,
} as const;

/** One class table per kind of loop, so that each loop's ordinary characters take one comparison. */
export interface ClassTables {
  /** For character data. */
  readonly text: Uint8Array;
  /** For attribute values. */
  readonly attribute: Uint8Array;
  /** For comments, PIs, CDATA sections and literals, which only need their characters checked. */
  readonly data: Uint8Array;
}

/** Builds the tables for XML 1.0, XML 1.1, or an entity's replacement text. */
function classTables(kind: 'xml10' | 'xml11' | 'replacementText'): ClassTables {
  const replacementText = kind === 'replacementText';
  const data = new Uint8Array(NON_ASCII);
  // Replacement text was checked when its entity was declared, and has no line ends left to join.
  if (!replacementText) {
    // The C0 controls are invalid but for tab, LF and CR (§2.2 [2]).
    for (let char = 0; char < Char.SPACE; char++) data[char] = CharClass.INVALID;
    data[Char.TAB] = CharClass.ORDINARY;
    data[Char.LINE_FEED] = CharClass.ORDINARY;
    data[Char.CARRIAGE_RETURN] = CharClass.CARRIAGE_RETURN;
    // XML 1.1 makes DEL a RestrictedChar.
    if (kind === 'xml11') data[Char.DELETE] = CharClass.INVALID;
  }
  const text = data.slice();
  text[Char.LESS_THAN] = CharClass.LESS_THAN;
  text[Char.AMPERSAND] = CharClass.AMPERSAND;
  text[Char.RIGHT_BRACKET] = CharClass.RIGHT_BRACKET;
  const attribute = data.slice();
  attribute[Char.LESS_THAN] = CharClass.LESS_THAN;
  attribute[Char.AMPERSAND] = CharClass.AMPERSAND;
  attribute[Char.TAB] = CharClass.WHITESPACE;
  attribute[Char.LINE_FEED] = replacementText ? CharClass.WHITESPACE : CharClass.LINE_FEED;
  if (replacementText) attribute[Char.CARRIAGE_RETURN] = CharClass.WHITESPACE;
  attribute[Char.DOUBLE_QUOTE] = CharClass.QUOTE;
  attribute[Char.APOSTROPHE] = CharClass.QUOTE;
  return { text, attribute, data };
}

/** The class tables of XML 1.0. */
export const TABLES_XML_10 = classTables('xml10');

/** The class tables of XML 1.1. */
export const TABLES_XML_11 = classTables('xml11');

/** The class tables for an entity's replacement text. */
export const TABLES_REPLACEMENT_TEXT = classTables('replacementText');

/** What an ASCII character can be in a name (§2.3 [4], [4a]); the order lets a loop test `>= NAME_START_CHAR`. */
export const NameClass = {
  /** Not in names at all. */
  NONE: 0,
  /** A NameChar but not a NameStartChar: a digit, `-` or `.`. */
  NAME_CHAR: 1,
  /** A NameStartChar: a letter or `_`. */
  NAME_START_CHAR: 2,
  /** `:`, a NameStartChar that namespaces give a meaning of its own. */
  COLON: 3,
} as const;

/** The name class of each ASCII character. */
export const NAME_CLASSES = (() => {
  const table = new Uint8Array(NON_ASCII);
  for (let char = Char.DIGIT_ZERO; char <= Char.DIGIT_NINE; char++) table[char] = NameClass.NAME_CHAR;
  for (let char = Char.UPPER_A; char <= Char.UPPER_Z; char++) table[char] = NameClass.NAME_START_CHAR;
  for (let char = Char.LOWER_A; char <= Char.LOWER_Z; char++) table[char] = NameClass.NAME_START_CHAR;
  table[Char.COLON] = NameClass.COLON;
  table[Char.UNDERSCORE] = NameClass.NAME_START_CHAR;
  table[Char.HYPHEN] = NameClass.NAME_CHAR;
  table[Char.PERIOD] = NameClass.NAME_CHAR;
  return table;
})();

/**
 * Whether a BMP code point above U+007F is a NameStartChar (fifth edition §2.3 [4], and XML 1.1 [4],
 * whose ranges these are).
 */
export function isNameStartCharBmp(codePoint: number): boolean {
  return (
    (codePoint >= 0xc0 && codePoint <= 0xd6) ||
    (codePoint >= 0xd8 && codePoint <= 0xf6) ||
    (codePoint >= 0xf8 && codePoint <= 0x2_ff) ||
    (codePoint >= 0x3_70 && codePoint <= 0x3_7d) ||
    (codePoint >= 0x3_7f && codePoint <= 0x1f_ff) ||
    (codePoint >= 0x20_0c && codePoint <= 0x20_0d) ||
    (codePoint >= 0x20_70 && codePoint <= 0x21_8f) ||
    (codePoint >= 0x2c_00 && codePoint <= 0x2f_ef) ||
    (codePoint >= 0x30_01 && codePoint <= 0xd7_ff) ||
    (codePoint >= 0xf9_00 && codePoint <= 0xfd_cf) ||
    (codePoint >= 0xfd_f0 && codePoint <= 0xff_fd)
  );
}

/** Whether a BMP code point above U+007F is a NameChar (§2.3 [4a]), which may appear in a name after its first character. */
export function isNameCharBmp(codePoint: number): boolean {
  return (
    isNameStartCharBmp(codePoint) ||
    codePoint === 0xb7 ||
    (codePoint >= 0x3_00 && codePoint <= 0x3_6f) ||
    (codePoint >= 0x20_3f && codePoint <= 0x20_40)
  );
}
