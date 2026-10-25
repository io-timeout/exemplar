import { bytes, framed, join, singleByte, split, utf32, utf8, verdict } from '@test/helpers/lexical.ts';
import { describe, expect, it } from 'vitest';
import {
  DecodeError,
  SINGLE_BYTE_DECODERS,
  Utf16Decoder,
  Utf32Decoder,
  isEbcdic,
  withCarry,
} from '@/encodings/decoders.ts';
import { SINGLE_BYTE_TABLES } from '@/encodings/tables.ts';
import { NO_BYTES } from '@/util/bytes.ts';

/** The DecodeError a decoding raises. */
function failure(decode: () => string): DecodeError {
  try {
    decode();
  } catch (error) {
    if (error instanceof DecodeError) return error;
    throw error;
  }
  throw new Error('The bytes were decoded');
}

describe('DecodeError', () => {
  it('is a TypeError that names the encoding and keeps the text decoded before the bad bytes', () => {
    const error = new DecodeError('KOI8-R', 'abc');
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ name: 'DecodeError', decoded: 'abc', message: 'The bytes are not legal KOI8-R' });
  });
});

describe('withCarry', () => {
  it('puts carried bytes before new ones, and returns the new ones as they are when nothing is carried', () => {
    const chunk = bytes(3, 4);
    expect(withCarry(NO_BYTES, chunk)).toBe(chunk);
    expect([...withCarry(bytes(1, 2), chunk)]).toEqual([1, 2, 3, 4]);
    expect([...withCarry(bytes(1))]).toEqual([1]);
    expect(withCarry(NO_BYTES)).toBe(NO_BYTES);
  });
});

describe('single-byte decoders', () => {
  it('has a decoder for every table', () => {
    expect(Object.keys(SINGLE_BYTE_DECODERS).toSorted()).toEqual(Object.keys(SINGLE_BYTE_TABLES).toSorted());
  });

  it('passes ASCII through in ASCII-compatible encodings and maps the upper half by its table', () => {
    expect(SINGLE_BYTE_DECODERS['iso-8859-1']?.().decode(bytes(0x41, 0x7f, 0x80, 0xe9, 0xff))).toBe('A\u007F\u0080éÿ');
    expect(SINGLE_BYTE_DECODERS['windows-1252']?.().decode(bytes(0x80, 0x9f))).toBe('€Ÿ');
    expect(SINGLE_BYTE_DECODERS['koi8-r']?.().decode(bytes(0xe1, 0xe2, 0xc2))).toBe('АБб');
  });

  it('maps every byte by its table in EBCDIC', () => {
    expect(SINGLE_BYTE_DECODERS['ibm037']?.().decode(bytes(0x4c, 0x6f, 0xa7, 0x94, 0x93, 0x40, 0x15, 0x25))).toBe(
      '<?xml \u0085\n'
    );
  });

  it('decodes nothing to the empty string, chunk by chunk with no state', () => {
    const decoder = SINGLE_BYTE_DECODERS['iso-8859-2']?.() ?? expect.unreachable();
    expect(decoder.decode()).toBe('');
    expect(decoder.decode(bytes(0xa3), { stream: true }) + decoder.decode(bytes(0xb3))).toBe('Łł');
  });

  it('rejects a byte the code page leaves undefined, with the text before it', () => {
    const decoder = SINGLE_BYTE_DECODERS['windows-1252']?.() ?? expect.unreachable();
    const error = failure(() => decoder.decode(bytes(0x61, 0x80, 0x81, 0x62)));
    expect(error).toMatchObject({ decoded: 'a€', message: 'The bytes are not legal windows-1252' });
  });

  it('rejects every byte above 0x7F in US-ASCII', () => {
    const decoder = SINGLE_BYTE_DECODERS['us-ascii']?.() ?? expect.unreachable();
    expect(decoder.decode(bytes(0x00, 0x7f))).toBe('\u0000\u007F');
    expect(failure(() => decoder.decode(bytes(0x41, 0x80))).decoded).toBe('A');
  });

  it('tells EBCDIC code pages from others', () => {
    expect(isEbcdic('ibm037')).toBe(true);
    expect(isEbcdic('ibm1149')).toBe(true);
    expect(isEbcdic('iso-8859-1')).toBe(false);
    expect(isEbcdic('utf-8')).toBe(false);
    expect(isEbcdic('IBM037')).toBe(false);
  });
});

describe('UTF-32 and UCS-4', () => {
  it.each([
    ['1234', 'UTF-32BE'],
    ['4321', 'UTF-32LE'],
    ['2143', 'UCS-4 in 2143 order'],
    ['3412', 'UCS-4 in 3412 order'],
  ])('decodes the byte order %s, characters outside the BMP as surrogate pairs', (order, name) => {
    const decoder = new Utf32Decoder(name, order as '1234');
    expect(decoder.decode(utf32('a\u{1F600}é', order))).toBe('a\u{1F600}é');
  });

  it('keeps U+FFFF as one code unit and writes U+10000 up as a surrogate pair', () => {
    const decoder = new Utf32Decoder('UTF-32BE', '1234');
    expect(decoder.decode(bytes(0, 0, 0xff, 0xff, 0, 1, 0, 0))).toBe('\uFFFF\u{10000}');
  });

  it('carries a partial unit to the next chunk when streaming', () => {
    const decoder = new Utf32Decoder('UTF-32BE', '1234');
    const data = utf32('ab', '1234');
    expect(decoder.decode(data.subarray(0, 6), { stream: true })).toBe('a');
    expect(decoder.decode(data.subarray(6, 7), { stream: true })).toBe('');
    expect(decoder.decode(data.subarray(7))).toBe('b');
    expect(decoder.decode()).toBe('');
  });

  it('rejects a partial unit at the end, after the whole ones', () => {
    const decoder = new Utf32Decoder('UTF-32LE', '4321');
    expect(failure(() => decoder.decode(bytes(0x41, 0, 0, 0, 0x42, 0)))).toMatchObject({
      decoded: 'A',
      message: 'The bytes are not legal UTF-32LE',
    });
    const streaming = new Utf32Decoder('UTF-32LE', '4321');
    streaming.decode(bytes(0x41, 0), { stream: true });
    expect(failure(() => streaming.decode()).decoded).toBe('');
  });

  it('rejects surrogate code points, which Unicode calls ill-formed', () => {
    const decoder = new Utf32Decoder('UTF-32BE', '1234');
    expect(failure(() => decoder.decode(bytes(0, 0, 0, 0x41, 0, 0, 0xd8, 0x00))).decoded).toBe('A');
    expect(failure(() => decoder.decode(bytes(0, 0, 0xdf, 0xff))).decoded).toBe('');
  });

  it('rejects values above U+10FFFF', () => {
    const decoder = new Utf32Decoder('UTF-32BE', '1234');
    expect(decoder.decode(bytes(0, 0x10, 0xff, 0xff))).toBe('\u{10FFFF}');
    expect(failure(() => decoder.decode(bytes(0, 0x11, 0, 0))).decoded).toBe('');
    expect(failure(() => decoder.decode(bytes(0xff, 0xff, 0xff, 0xff))).decoded).toBe('');
  });
});

describe('UTF-16', () => {
  const le = (...units: number[]): Uint8Array => bytes(...units.flatMap((u) => [u & 0xff, u >> 8]));
  const be = (...units: number[]): Uint8Array => bytes(...units.flatMap((u) => [u >> 8, u & 0xff]));

  it('decodes either byte order, keeping a byte-order mark for the caller to strip', () => {
    expect(new Utf16Decoder('UTF-16LE').decode(le(0xfe_ff, 0x41, 0xd8_3d, 0xde_00))).toBe('\uFEFFA😀');
    expect(new Utf16Decoder('UTF-16BE').decode(be(0x41, 0xe9))).toBe('Aé');
  });

  it('carries an odd byte, and a high surrogate, to the next chunk when streaming', () => {
    const decoder = new Utf16Decoder('UTF-16LE');
    const data = le(0x41, 0xd8_3d, 0xde_00, 0x42);
    expect(decoder.decode(data.subarray(0, 3), { stream: true })).toBe('A');
    expect(decoder.decode(data.subarray(3, 4), { stream: true })).toBe('');
    expect(decoder.decode(data.subarray(4, 7), { stream: true })).toBe('😀');
    expect(decoder.decode(data.subarray(7))).toBe('B');
  });

  it('decodes a surrogate pair whole within one chunk when streaming', () => {
    expect(new Utf16Decoder('UTF-16BE').decode(be(0xd8_3d, 0xde_00), { stream: true })).toBe('😀');
  });

  it.each([
    ['a lone low surrogate', le(0x41, 0xdc_00, 0x42), 'A'],
    ['a high surrogate without its low one', le(0x41, 0xd8_00, 0x42), 'A'],
    ['a high surrogate at the end', le(0x41, 0xd8_3d, 0xde_00, 0xd8_00), 'A😀'],
    ['an odd byte at the end', bytes(0x41, 0, 0x42), 'A'],
  ])('rejects %s, with the text before it', (_, data, decoded) => {
    expect(failure(() => new Utf16Decoder('UTF-16LE').decode(data))).toMatchObject({
      decoded,
      message: 'The bytes are not legal UTF-16LE',
    });
  });

  it('rejects a character left unfinished when the stream ends', () => {
    const decoder = new Utf16Decoder('UTF-16BE');
    expect(decoder.decode(be(0x41, 0xd8_3d), { stream: true })).toBe('A');
    expect(failure(() => decoder.decode())).toMatchObject({ decoded: '', message: 'The bytes are not legal UTF-16BE' });
  });
});

describe('documents in the encodings exemplar decodes itself', () => {
  /** A document's bytes: an ASCII declaration naming an encoding, then content in that encoding. */
  const declared = (encoding: string, content: string): Uint8Array => {
    const head = utf8(`<?xml version="1.0" encoding="${encoding}"?><a>`);
    return join(head, singleByte(encoding.toLowerCase(), content), utf8('</a>'));
  };

  it('decodes ISO-8859-1 as registered, not as windows-1252', () => {
    const doc = framed('<?xml version="1.0" encoding="ISO-8859-1"?><a>', [0x80, 0xe9], '</a>');
    expect(verdict(doc)).toBe('accepted <a>\u0080é</a>');
  });

  it.each([
    ['ISO-8859-2', 'Łódź'],
    ['ISO-8859-5', 'Жук'],
    ['ISO-8859-7', 'Ωμέγα'],
    ['ISO-8859-15', '€ŒŠ'],
    ['ISO-8859-16', 'Ș'],
    ['windows-1251', 'Жук'],
    ['windows-1252', '€‚ƒ'],
    ['windows-874', 'กข'],
    ['KOI8-R', 'Жук'],
    ['KOI8-U', 'єї'],
    ['macintosh', 'Äπ'],
  ])('decodes %s by its table', (encoding, content) => {
    expect(verdict(declared(encoding, content))).toBe(`accepted <a>${content}</a>`);
  });

  it('rejects bytes a code page leaves undefined, keeping the text before them for the location', () => {
    const doc = framed('<?xml version="1.0" encoding="windows-1252"?>\n<a>x', [0x81], '</a>');
    expect(verdict(doc)).toBe('ENCODING_INVALID_BYTES 2:5');
  });

  it('reads UTF-32 and UCS-4 in every byte order, with or without a BOM, whole or a byte at a time', () => {
    const xml = '<?xml version="1.0" encoding="UTF-32"?><a>\u{1F600}</a>';
    for (const order of ['1234', '4321', '2143', '3412']) {
      for (const bom of [true, false]) {
        const doc = utf32(xml, order, bom);
        expect(verdict(doc), order).toBe('accepted <a>\u{1F600}</a>');
        expect(verdict(split(doc, 1)), order).toBe('accepted <a>\u{1F600}</a>');
      }
    }
  });

  it('rejects a surrogate code point, and a truncated unit, in UTF-32', () => {
    const doc = utf32('<?xml version="1.0" encoding="UTF-32"?><a>x</a>', '1234', true);
    const surrogate = join(doc.subarray(0, -20), bytes(0, 0, 0xd8, 0), doc.subarray(-20));
    expect(verdict(surrogate)).toBe('ENCODING_INVALID_BYTES 1:43');
    expect(verdict(doc.subarray(0, -1))).toBe('ENCODING_INVALID_BYTES 1:47');
  });

  it('reads EBCDIC in the code page the declaration names', () => {
    expect(verdict(singleByte('ibm037', '<?xml version="1.0" encoding="IBM037"?><a>[]</a>'))).toBe(
      'accepted <a>[]</a>'
    );
    expect(verdict(singleByte('ibm1047', '<?xml version="1.0" encoding="IBM1047"?><a>[]</a>'))).toBe(
      'accepted <a>[]</a>'
    );
    expect(verdict(singleByte('ibm037', '<?xml version="1.0"?><a/>'))).toBe('ENCODING_UNDECLARED 1:1');
    expect(verdict(singleByte('ibm037', '<?xml version="1.0" encoding="UTF-8"?><a/>'))).toBe('ENCODING_MISMATCH 1:1');
  });

  it('decodes EBCDIC NL as NEL, a line end in XML 1.1 and an ordinary character in XML 1.0 (§2.11)', () => {
    const doc = (version: string): Uint8Array =>
      singleByte('ibm037', `<?xml version="${version}" encoding="IBM037"?><a>x\u0085y</a>`);
    expect(doc('1.0')).toContain(0x15);
    expect(verdict(doc('1.1'))).toBe('accepted <a>x&#10;y</a>');
    expect(verdict(doc('1.0'))).toBe('accepted <a>x\u0085y</a>');
  });
});
