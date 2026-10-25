import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { encoderFor } from '@/encoders.ts';

const UTF8 = new TextEncoder();

describe('encoderFor', () => {
  it('encodes UTF-8 with no byte order mark, holding every character', () => {
    const encoder = encoderFor('UTF-8');
    expect(encoder.name).toBe('UTF-8');
    expect(encoder.byteOrderMark).toBeUndefined();
    expect(encoder.unencodable).toBeUndefined();
    expect(encoder.encode('a é 误 😀')).toEqual(UTF8.encode('a é 误 😀'));
  });

  it.each([
    ['UTF-16', 'UTF-16', [0xfe, 0xff], [0, 0x61, 0xd8, 0x3d, 0xde, 0x00]],
    ['UTF-16BE', 'UTF-16BE', undefined, [0, 0x61, 0xd8, 0x3d, 0xde, 0x00]],
    ['UTF-16LE', 'UTF-16LE', undefined, [0x61, 0, 0x3d, 0xd8, 0x00, 0xde]],
  ])('encodes %s as code units in its byte order', (name, declared, bom, bytes) => {
    const encoder = encoderFor(name);
    expect(encoder.name).toBe(declared);
    expect(encoder.byteOrderMark === undefined ? undefined : [...encoder.byteOrderMark]).toEqual(bom);
    expect(encoder.unencodable).toBeUndefined();
    expect([...encoder.encode('a😀')]).toEqual(bytes);
  });

  it.each([
    ['utf-8', 'UTF-8'],
    ['utf-16be', 'UTF-16BE'],
    ['latin1', 'ISO-8859-1'],
    ['iso-8859-15', 'ISO-8859-15'],
    ['us-ascii', 'US-ASCII'],
    ['koi8-r', 'KOI8-R'],
    ['ibm037', 'IBM037'],
    ['ebcdic-cp-us', 'IBM037'],
    ['WINDOWS-1252', 'windows-1252'],
    ['macintosh', 'macintosh'],
  ])('finds %s whatever its case or alias, naming it %s', (name, declared) => {
    expect(encoderFor(name).name).toBe(declared);
  });

  it.each(['UTF-32', 'Shift_JIS', 'x-unknown', ''])('throws a RangeError for %s, which has no encoder', (name) => {
    expect(() => encoderFor(name)).toThrow(RangeError);
  });

  it('encodes ISO-8859-1 one byte per character, and finds what it cannot hold', () => {
    const encoder = encoderFor('ISO-8859-1');
    expect(encoder.byteOrderMark).toBeUndefined();
    expect([...encoder.encode('aéÿ')]).toEqual([0x61, 0xe9, 0xff]);
    expect(encoder.unencodable?.test('é')).toBe(false);
    expect(encoder.unencodable?.test('€')).toBe(true);
    expect(encoder.unencodable?.exec('a€b')?.index).toBe(1);
  });

  it('holds only ASCII in US-ASCII', () => {
    const encoder = encoderFor('US-ASCII');
    expect([...encoder.encode('\u0000~\u007F')]).toEqual([0, 0x7e, 0x7f]);
    expect(encoder.unencodable?.test('\u0080')).toBe(true);
    expect(() => encoder.encode('é')).toThrow(
      expect.objectContaining({ code: 'WRITE_ENCODING', message: 'U+00E9 cannot be written in US-ASCII' })
    );
  });

  it('maps the upper half through the table in windows-1252', () => {
    expect([...encoderFor('windows-1252').encode('€‚ƒ')]).toEqual([0x80, 0x82, 0x83]);
  });

  it('maps every byte through the table in EBCDIC', () => {
    expect([...encoderFor('IBM037').encode('<a>')]).toEqual([0x4c, 0x81, 0x6e]);
  });

  it('throws WRITE_ENCODING with the code point, a character beyond the BMP included', () => {
    expect(() => encoderFor('ISO-8859-1').encode('a\u{10000}')).toThrow(
      expect.objectContaining({ code: 'WRITE_ENCODING', message: 'U+10000 cannot be written in ISO-8859-1' })
    );
  });

  it.each(['ISO-8859-1', 'ISO-8859-7', 'windows-1251', 'KOI8-R', 'macintosh', 'IBM1047'])(
    'gives bytes the reader decodes back to the same text in %s',
    (name) => {
      const encoder = encoderFor(name);
      let text = '';
      for (let c = 0x20; c < 0x30_00 && text.length < 200; c++) {
        const ch = String.fromCodePoint(c);
        if (encoder.unencodable?.test(ch) !== true && ch !== '<' && ch !== '&') text += ch;
      }
      const prefix = encoder.encode(`<?xml version="1.0" encoding="${encoder.name}"?><a>`);
      const bytes = Uint8Array.from([...prefix, ...encoder.encode(text), ...encoder.encode('</a>')]);
      const reader = new XMLInputFactory().createStreamReader(bytes);
      reader.next();
      reader.next();
      expect(reader.text()).toBe(text);
    }
  );
});
