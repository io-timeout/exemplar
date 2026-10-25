import { byteByByte, bytes, decode, decodeChunks, factory, hex, splits } from '@test/helpers/bytes.ts';
import { describe, expect, it } from 'vitest';
import { cjkDecoders } from '@/index.ts';

/** Every charset the package registers, by canonical name. */
const CHARSETS = ['big5', 'big5-hkscs', 'euc-jp', 'euc-kr', 'gb2312', 'gbk', 'iso-2022-jp', 'shift_jis', 'windows-31j'];

/** Text in each charset mixing ASCII with one-, two- and, where the charset has them, three-byte characters. */
const SAMPLES: [string, string, string][] = [
  ['shift_jis', '95b68f9141b1', '文書Aｱ'],
  ['windows-31j', '95b6874041f040', '文①A\uE000'],
  ['euc-jp', 'cab8418eb18fb0a1', '文Aｱ丂'],
  ['iso-2022-jp', '1b24424a381b2842411b2849311b2842', '文Aｱ'],
  ['gbk', 'cec441a2e38140', '文A€丂'],
  ['gb2312', 'cec441d6d0', '文A中'],
  ['big5', 'a4e541a440', '文A一'],
  ['big5-hkscs', 'a4e5418745', '文A𧉧'],
  ['euc-kr', 'b9ae41b0a1', '문A가'],
];

/** The start of a character in each charset, cut off before its last byte. */
const TRUNCATED: [string, string][] = [
  ['shift_jis', '95'],
  ['windows-31j', 'f0'],
  ['euc-jp', '8fb0'],
  ['iso-2022-jp', '1b24'],
  ['gbk', '81'],
  ['gb2312', 'ce'],
  ['big5', 'a4'],
  ['big5-hkscs', '87'],
  ['euc-kr', 'b9'],
];

const ASCII = Uint8Array.from({ length: 0x80 }, (_, b) => b);
const asciiText = String.fromCharCode(...ASCII);

describe('cjkDecoders', () => {
  it('registers a decoder factory for each charset under its canonical name', () => {
    expect(Object.keys(cjkDecoders).toSorted()).toEqual(CHARSETS);
  });

  it.each(CHARSETS.filter((name) => name !== 'iso-2022-jp'))('%s decodes every byte below 0x80 as ASCII', (name) => {
    expect(decode(name, ASCII)).toBe(asciiText);
  });

  it('iso-2022-jp decodes every byte below 0x80 as ASCII but ESC, SO and SI, which switch modes', () => {
    const controls = new Set([0x0e, 0x0f, 0x1b]);
    const plain = ASCII.filter((b) => !controls.has(b));
    expect(decode('iso-2022-jp', plain)).toBe(String.fromCharCode(...plain));
  });

  it.each(SAMPLES)('%s decodes %s split at any byte, and byte by byte', (name, input, text) => {
    const data = hex(input);
    expect(decode(name, data)).toBe(text);
    for (const chunks of splits(data)) expect(decodeChunks(factory(name)(), chunks)).toBe(text);
    expect(decodeChunks(factory(name)(), byteByByte(data))).toBe(text);
  });

  it.each(TRUNCATED)('%s rejects %s cut off at the end of the input, whole or streamed', (name, input) => {
    const data = bytes('A', hex(input));
    expect(() => decode(name, data)).toThrow(TypeError);
    const decoder = factory(name)();
    expect(decoder.decode(data, { stream: true })).toBe('A');
    expect(() => decoder.decode()).toThrow(TypeError);
  });

  it.each(CHARSETS)('%s rejects 0x80 and 0xFF rather than decoding them as U+FFFD', (name) => {
    expect(() => decode(name, '4180')).toThrow(TypeError);
    expect(() => decode(name, '41ff')).toThrow(TypeError);
  });

  it('creates a decoder with state of its own each time', () => {
    const first = factory('iso-2022-jp')();
    expect(first.decode(hex('1b2442'), { stream: true })).toBe('');
    expect(factory('iso-2022-jp')().decode(hex('2422'))).toBe('$"');
    expect(first.decode(hex('2422'))).toBe('あ');
    const carrying = factory('euc-jp')();
    expect(carrying.decode(hex('a4'), { stream: true })).toBe('');
    expect(() => factory('euc-jp')().decode(hex('a2'))).toThrow(TypeError);
    expect(carrying.decode(hex('a2'))).toBe('あ');
  });
});
