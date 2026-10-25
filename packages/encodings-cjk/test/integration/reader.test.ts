import { bytes, hex, splits } from '@test/helpers/bytes.ts';
import { cjkFactory, documentIn, errorOf, read, readFed } from '@test/helpers/documents.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode, XMLInputFactory } from '@exemplarjs/xml';
import { CREATE_READER, INPUT_ENCODING } from '@exemplarjs/xml/internal';

/** A document in each charset: the declared name, the root's name, its attribute and its text, in hex and decoded. */
const DOCUMENTS: [string, [string, string, string], [string, string, string]][] = [
  ['Shift_JIS', ['95b68f91', 'b1b2', '93fa967b8cea'], ['文書', 'ｱｲ', '日本語']],
  ['windows-31j', ['95b68f91', '8740', '93fa967bf040'], ['文書', '①', '日本\uE000']],
  ['EUC-JP', ['cab8bdf1', '8eb18eb2', 'c6fccbdcb8ec8fb0a1'], ['文書', 'ｱｲ', '日本語丂']],
  ['ISO-2022-JP', ['1b24424a383d711b2842', '1b284931321b2842', '1b2442467c4b5c386c1b2842'], ['文書', 'ｱｲ', '日本語']],
  ['GBK', ['cec4b5b5', 'd6b5', 'd6d0cec4a2e3'], ['文档', '值', '中文€']],
  ['GB2312', ['cec4b5b5', 'd6b5', 'd6d0cec4'], ['文档', '值', '中文']],
  ['Big5', ['a4e5a5f3', 'adc8', 'a4a4a4e5'], ['文件', '值', '中文']],
  ['Big5-HKSCS', ['a4e5a5f3', 'adc8', 'a4a48745'], ['文件', '值', '中𧉧']],
  ['EUC-KR', ['b9aebcad', 'b0aa', 'c7d1b1b9beee'], ['문서', '값', '한국어']],
];

/** What reading each document gives. */
const expected = ([name, value, text]: [string, string, string]): string[] => [
  `<${name} a=${value}>`,
  text,
  `</${name}>`,
];

describe('reading documents with the CJK decoders registered', () => {
  it.each(DOCUMENTS)('reads a document in %s', (encoding, parts, decoded) => {
    expect(read(documentIn(encoding, ...parts))).toEqual(expected(decoded));
  });

  it.each(DOCUMENTS)('reads a document in %s split at any byte', (encoding, parts, decoded) => {
    for (const chunks of splits(documentIn(encoding, ...parts))) expect(read(chunks)).toEqual(expected(decoded));
  });

  it.each(DOCUMENTS)('reads a document in %s fed to the async reader a byte at a time', (encoding, parts, decoded) => {
    expect(readFed(documentIn(encoding, ...parts))).toEqual(expected(decoded));
  });

  it.each([
    ['MS_Kanji', 'shift_jis'],
    ['csShiftJIS', 'shift_jis'],
    ['SHIFT_JIS', 'shift_jis'],
    ['csWindows31J', 'windows-31j'],
    ['Extended_UNIX_Code_Packed_Format_for_Japanese', 'euc-jp'],
    ['csEUCPkdFmtJapanese', 'euc-jp'],
    ['csISO2022JP', 'iso-2022-jp'],
    ['CP936', 'gbk'],
    ['MS936', 'gbk'],
    ['windows-936', 'gbk'],
    ['csGBK', 'gbk'],
    ['csGB2312', 'gb2312'],
    ['csBig5', 'big5'],
    ['csBig5HKSCS', 'big5-hkscs'],
    ['csEUCKR', 'euc-kr'],
  ])('decodes a document declared as %s with the %s decoder (§4.3.3)', (declared, canonical) => {
    // The internal reader type has the decoder the reader chose.
    const reader = cjkFactory[CREATE_READER](bytes(`<?xml version="1.0" encoding="${declared}"?><a/>`), {}, false);
    reader.next();
    expect(reader[INPUT_ENCODING]).toBe(canonical);
  });

  it('decodes with the encoding a source object names when the document declares none', () => {
    const data = bytes('<', hex('95b6'), '>', hex('93fa'), '</', hex('95b6'), '>');
    expect(read({ bytes: data, encoding: 'Shift_JIS' })).toEqual(['<文>', '日', '</文>']);
  });

  it('keeps trail bytes that look like markup inside their character', () => {
    // GBK 815D ends in "]" and Shift_JIS 955C in "\".
    const cdata = bytes('<?xml version="1.0" encoding="GBK"?><a><![CDATA[', hex('815d'), ']>]]></a>');
    expect(read(cdata)).toEqual(['<a>', '乚]>', '</a>']);
    const value = bytes('<?xml version="1.0" encoding="Shift_JIS"?><a b="', hex('955c'), '"/>');
    expect(read(value)).toEqual(['<a b=表>', '</a>']);
  });

  it('fails with ENCODING_UNSUPPORTED when the decoders are not registered', () => {
    const [encoding, parts] = DOCUMENTS[0] as (typeof DOCUMENTS)[number];
    expect(errorOf(documentIn(encoding, ...parts), new XMLInputFactory()).code).toBe(ErrorCode.ENCODING_UNSUPPORTED);
  });
});

describe('bytes a charset does not allow', () => {
  /** Bytes each charset rejects, after "AB" in the root's text. */
  const INVALID: [string, string][] = [
    ['Shift_JIS', '80'],
    ['windows-31j', 'fc4c'],
    ['EUC-JP', '8ea0'],
    ['ISO-2022-JP', '1b2441'],
    ['GBK', '817f'],
    ['GB2312', 'b040'],
    ['Big5', 'a17f'],
    ['Big5-HKSCS', '8862'],
    ['EUC-KR', 'a2e9'],
  ];

  it.each(INVALID)('%s fails with ENCODING_INVALID_BYTES at %s, whole or split at any byte', (encoding, bad) => {
    const data = bytes(`<?xml version="1.0" encoding="${encoding}"?>\n<a>AB`, hex(bad), '</a>');
    for (const chunks of [[data], ...splits(data)]) {
      expect(errorOf(chunks)).toMatchObject({ code: ErrorCode.ENCODING_INVALID_BYTES, line: 2, column: 6 });
    }
  });

  it.each(INVALID)('%s fails at %s when fed to the async reader a byte at a time', (encoding, bad) => {
    const data = bytes(`<?xml version="1.0" encoding="${encoding}"?>\n<a>AB`, hex(bad), '</a>');
    expect(() => readFed(data)).toThrow(
      expect.objectContaining({ code: ErrorCode.ENCODING_INVALID_BYTES, line: 2, column: 6 })
    );
  });

  it.each([
    ['Shift_JIS', '95'],
    ['EUC-JP', '8fb0'],
    ['ISO-2022-JP', '1b24'],
    ['Big5', 'a4'],
  ])('%s fails with ENCODING_INVALID_BYTES on %s cut off at the end of the document', (encoding, start) => {
    const data = bytes(`<?xml version="1.0" encoding="${encoding}"?><a/>`, hex(start));
    expect(errorOf(data).code).toBe(ErrorCode.ENCODING_INVALID_BYTES);
    expect(() => readFed(data)).toThrow(expect.objectContaining({ code: ErrorCode.ENCODING_INVALID_BYTES }));
  });
});
