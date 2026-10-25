import { canonicalOfAsync } from '@test/helpers/canonical.ts';
import { bytes, framed, join, singleByte, split, utf16, utf32, utf8, verdict } from '@test/helpers/lexical.ts';
import { reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { isEbcdic } from '@/encodings/decoders.ts';
import { SINGLE_BYTE_TABLES } from '@/encodings/tables.ts';
import { type XMLError, XMLInputFactory } from '@/index.ts';
import { type Detection, checkDeclaredEncoding, detect } from '@/input/detect.ts';

/** Every EBCDIC page exemplar decodes. */
const EBCDIC = Object.keys(SINGLE_BYTE_TABLES).filter((name) => isEbcdic(name));

/** What detection decides for a whole document. */
const detected = (head: Uint8Array, external?: string): Detection =>
  detect(head, true, external) ?? expect.unreachable();

/** An async iterable over chunks. */
async function* streamOf(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

describe('byte-order marks (§4.3.3, Appendix F)', () => {
  it.each([
    [
      'UTF-8',
      [0xef, 0xbb, 0xbf, 0x3c],
      { byteOrderMark: 'utf-8', byteOrderMarkLength: 3, family: 'ascii', decoderName: 'utf-8' },
    ],
    [
      'UTF-16BE',
      [0xfe, 0xff, 0x00, 0x3c],
      { byteOrderMark: 'utf-16be', byteOrderMarkLength: 2, family: 'utf-16be', decoderName: 'utf-16be' },
    ],
    [
      'UTF-16LE',
      [0xff, 0xfe, 0x3c, 0x00],
      { byteOrderMark: 'utf-16le', byteOrderMarkLength: 2, family: 'utf-16le', decoderName: 'utf-16le' },
    ],
    [
      'UTF-32BE',
      [0x00, 0x00, 0xfe, 0xff],
      { byteOrderMark: 'utf-32be', byteOrderMarkLength: 4, family: 'utf-32be', decoderName: 'utf-32be' },
    ],
    [
      'UTF-32LE',
      [0xff, 0xfe, 0x00, 0x00],
      { byteOrderMark: 'utf-32le', byteOrderMarkLength: 4, family: 'utf-32le', decoderName: 'utf-32le' },
    ],
    [
      'UCS-4 2143',
      [0x00, 0x00, 0xff, 0xfe],
      { byteOrderMark: 'x-ucs-4-2143', byteOrderMarkLength: 4, decoderName: 'x-ucs-4-2143' },
    ],
    [
      'UCS-4 3412',
      [0xfe, 0xff, 0x00, 0x00],
      { byteOrderMark: 'x-ucs-4-3412', byteOrderMarkLength: 4, decoderName: 'x-ucs-4-3412' },
    ],
  ])('takes %s from its byte-order mark', (_, head, expected) => {
    expect(detect(bytes(...head), false)).toEqual(expect.objectContaining(expected));
  });

  it('lets a byte-order mark override an encoding supplied from outside (RFC 7303 §3.2)', () => {
    expect(detect(bytes(0xef, 0xbb, 0xbf, 0x3c), false, 'iso-8859-1')).toEqual({
      byteOrderMark: 'utf-8',
      byteOrderMarkLength: 3,
      family: 'ascii',
      decoderName: 'utf-8',
    });
  });
});

describe('the first bytes without a byte-order mark (Appendix F.1)', () => {
  it.each([
    ['UTF-32BE', [0x00, 0x00, 0x00, 0x3c], 'utf-32be'],
    ['UTF-32LE', [0x3c, 0x00, 0x00, 0x00], 'utf-32le'],
    ['UCS-4 2143', [0x00, 0x00, 0x3c, 0x00], 'x-ucs-4-2143'],
    ['UCS-4 3412', [0x00, 0x3c, 0x00, 0x00], 'x-ucs-4-3412'],
    ['UTF-16BE', [0x00, 0x3c, 0x00, 0x3f], 'utf-16be'],
    ['UTF-16LE', [0x3c, 0x00, 0x3f, 0x00], 'utf-16le'],
    ['UTF-16LE before a name', [0x3c, 0x00, 0x61, 0x00], 'utf-16le'],
    ['UTF-16LE before a character with a zero low byte', [0x3c, 0x00, 0x00, 0x4e], 'utf-16le'],
  ])('tells %s by how the first < is written', (_, head, family) => {
    expect(detected(bytes(...head))).toEqual({ byteOrderMarkLength: 0, family, decoderName: family });
  });

  it('tells EBCDIC by <?xm and reads it as IBM037 until the declaration names a page', () => {
    expect(detected(singleByte('ibm037', '<?xml version="1.0"?>'))).toEqual({
      byteOrderMarkLength: 0,
      family: 'ebcdic',
      decoderName: 'ibm037',
    });
  });

  it('takes anything else as ASCII-compatible, and UTF-8 without a declaration', () => {
    expect(detected(utf8('<doc/>'))).toEqual({ byteOrderMarkLength: 0, family: 'ascii', decoderName: 'utf-8' });
    expect(detected(bytes(0x3c, 0x00, 0x41, 0x42))).toMatchObject({ family: 'ascii' });
    expect(detected(bytes())).toMatchObject({ family: 'ascii', decoderName: 'utf-8' });
  });
});

describe('the encoding declaration in the first bytes (§4.3.3)', () => {
  it('reads the encoding the XML declaration names, in either quotes, with spaces around =', () => {
    expect(detected(utf8('<?xml version="1.0" encoding="ISO-8859-1"?>')).decoderName).toBe('iso-8859-1');
    expect(detected(utf8("<?xml version='1.0' encoding = 'Latin1' ?>")).decoderName).toBe('iso-8859-1');
    expect(detected(utf8('<?xml\nversion="1.0"\tencoding="KOI8-R"?>')).decoderName).toBe('koi8-r');
  });

  it('defaults to UTF-8 when the declaration names no encoding', () => {
    expect(detected(utf8('<?xml version="1.0"?><a/>')).decoderName).toBe('utf-8');
  });

  it('does not take a PI whose target starts with xml for the declaration', () => {
    expect(detected(utf8('<?xml-stylesheet encoding="latin1"?><a/>')).decoderName).toBe('utf-8');
    expect(detected(utf8('<?xmlfoo encoding="latin1"?><a/>')).decoderName).toBe('utf-8');
  });

  it('decodes as the first bytes show when the declaration names an encoding they rule out, so the check reports it', () => {
    expect(detected(utf8('<?xml version="1.0" encoding="UTF-16"?>')).decoderName).toBe('utf-8');
    expect(detected(utf8('<?xml version="1.0" encoding="UTF-32"?>')).decoderName).toBe('utf-8');
    expect(detected(utf8('<?xml version="1.0" encoding="IBM037"?>')).decoderName).toBe('utf-8');
    expect(detected(singleByte('ibm037', '<?xml version="1.0" encoding="UTF-8"?>')).decoderName).toBe('ibm037');
  });

  it('takes the EBCDIC page an EBCDIC declaration names', () => {
    expect(detected(singleByte('ibm500', "<?xml version='1.0' encoding='IBM500'?>")).decoderName).toBe('ibm500');
    expect(detected(singleByte('ibm1047', '<?xml version="1.0" encoding="IBM1047"?>')).decoderName).toBe('ibm1047');
  });

  it.each(EBCDIC)('reads a declaration written in %s, in either quotes (Appendix F.1)', (page) => {
    for (const q of ['"', "'"]) {
      const declaration = `<?xml\nversion=${q}1.0${q}\tencoding = ${q}${page.toUpperCase()}${q} standalone=${q}no${q} ?>`;
      expect(detected(singleByte(page, `${declaration}<a/>`)).decoderName).toBe(page);
    }
  });

  it('waits for four bytes while they may begin a byte-order mark or a wide <, then for the end of an XML declaration', () => {
    const heads = [
      [],
      [0x3c],
      [0x3c, 0x00],
      [0x00, 0x3c],
      [0xfe, 0xff, 0x00],
      [0xff, 0xfe, 0x00],
      [0xef, 0xbb],
      [0x4c, 0x6f],
    ];
    for (const head of heads) {
      expect(detect(bytes(...head), false), `${head}`).toBeUndefined();
    }
    expect(detect(utf8('<?xm'), false)).toBeUndefined();
    expect(detect(utf8('<?xml'), false)).toBeUndefined();
    expect(detect(utf8('<?xml version="1.0" enc'), false)).toBeUndefined();
    expect(detect(utf8('<?xml version="1.0" enc'), true)).toMatchObject({ decoderName: 'utf-8' });
    expect(detect(utf8('<a>'), true)).toMatchObject({ decoderName: 'utf-8' });
  });

  it('decides at once when the first bytes cannot begin a declaration', () => {
    expect(detect(utf8('a'), false)).toMatchObject({ decoderName: 'utf-8' });
    expect(detect(utf8('<a>'), false)).toMatchObject({ decoderName: 'utf-8' });
    expect(detect(utf8('<a/>'), false)).toMatchObject({ decoderName: 'utf-8' });
    expect(detect(utf8('<?xmL'), false)).toMatchObject({ decoderName: 'utf-8' });
    expect(detect(utf8('<?xml-'), false)).toMatchObject({ decoderName: 'utf-8' });
  });

  it('waits for the end of the declaration however long it is (§4.3.3)', () => {
    const long = `<?xml version="1.0"${' '.repeat(1100)}`;
    expect(detect(utf8(long), false)).toBeUndefined();
    expect(detect(utf8(`${long} encoding="ISO-8859-1"?>`), false)).toMatchObject({ decoderName: 'iso-8859-1' });
    expect(detect(utf8(long), true)).toMatchObject({ decoderName: 'utf-8' });
  });
});

describe('an encoding supplied from outside (RFC 7303)', () => {
  it('overrides the declaration, by its canonical name', () => {
    expect(detected(utf8('<?xml version="1.0" encoding="utf-8"?>'), 'Latin1')).toEqual({
      byteOrderMarkLength: 0,
      family: 'ascii',
      external: 'iso-8859-1',
      decoderName: 'iso-8859-1',
    });
  });

  it('takes the byte order of UTF-16 from the first bytes, big-endian when they do not show one', () => {
    expect(detected(bytes(0x3c, 0, 0x61, 0), 'UTF-16').decoderName).toBe('utf-16le');
    expect(detected(bytes(0, 0x3c, 0, 0x61), 'UTF-16').decoderName).toBe('utf-16be');
    expect(detected(utf8('<a/>'), 'UTF-16').decoderName).toBe('utf-16be');
  });

  it('takes the byte order of UTF-32 from the first bytes, big-endian when they do not show one', () => {
    expect(detected(bytes(0x3c, 0, 0, 0), 'UTF-32').decoderName).toBe('utf-32le');
    expect(detected(bytes(0, 0, 0x3c, 0), 'UTF-32').decoderName).toBe('x-ucs-4-2143');
    expect(detected(utf8('<a/>'), 'UTF-32').decoderName).toBe('utf-32be');
  });

  it('keeps a byte order the name gives', () => {
    expect(detected(bytes(0x3c, 0, 0x61, 0), 'UTF-16BE').decoderName).toBe('utf-16be');
  });
});

describe('the declared encoding against what was detected', () => {
  const ascii = detected(utf8('<a/>'));
  const utf8Bom = detected(bytes(0xef, 0xbb, 0xbf, 0x3c));
  const utf16beBare = detected(bytes(0, 0x3c, 0, 0x61));
  const utf16leBare = detected(bytes(0x3c, 0, 0x61, 0));
  const utf16leBom = detected(bytes(0xff, 0xfe, 0x3c, 0));
  const utf32beBare = detected(bytes(0, 0, 0, 0x3c));
  const utf32beBom = detected(bytes(0, 0, 0xfe, 0xff));
  const ucs2143 = detected(bytes(0, 0, 0x3c, 0));
  const ebcdic = detected(singleByte('ibm037', '<?xml?>'));

  it('has nothing to check before detection', () => {
    expect(checkDeclaredEncoding(undefined, 'UTF-8')).toBeUndefined();
  });

  it.each([
    ['ASCII-compatible bytes', ascii, 'Utf-8'],
    ['ASCII-compatible bytes', ascii, 'ISO-8859-1'],
    ['a UTF-8 byte-order mark', utf8Bom, 'UTF-8'],
    ['UTF-16 with a byte-order mark', utf16leBom, 'UTF-16'],
    ['UTF-16 with a byte-order mark', utf16leBom, 'UTF-16LE'],
    ['UTF-16 without a byte-order mark', utf16leBare, 'UTF-16LE'],
    ['UTF-16 without a byte-order mark', utf16beBare, 'utf-16be'],
    ['UTF-32 without a byte-order mark', utf32beBare, 'UTF-32'],
    ['UTF-32 without a byte-order mark', utf32beBare, 'UTF-32BE'],
    ['UTF-32 without a byte-order mark', utf32beBare, 'ISO-10646-UCS-4'],
    ['UCS-4 in 2143 order', ucs2143, 'UTF-32'],
    ['EBCDIC', ebcdic, 'IBM037'],
    ['EBCDIC', ebcdic, 'ebcdic-cp-us'],
    ['EBCDIC', ebcdic, 'IBM500'],
  ])('accepts %s declared as %s', (_, detection, declaration) => {
    expect(checkDeclaredEncoding(detection, declaration)).toBeUndefined();
  });

  it.each([
    ['ASCII-compatible bytes', ascii, 'UTF-16'],
    ['ASCII-compatible bytes', ascii, 'UTF-32'],
    ['ASCII-compatible bytes', ascii, 'IBM037'],
    ['a UTF-8 byte-order mark', utf8Bom, 'ISO-8859-1'],
    ['a UTF-8 byte-order mark', utf8Bom, 'UTF-16'],
    ['UTF-16', utf16leBom, 'UTF-8'],
    ['UTF-16LE', utf16leBare, 'UTF-16BE'],
    ['UTF-16BE', utf16beBare, 'UTF-16LE'],
    ['UTF-32BE', utf32beBare, 'UTF-32LE'],
    ['UTF-32BE', utf32beBom, 'UTF-8'],
    ['UCS-4 in 2143 order', ucs2143, 'UTF-32BE'],
    ['EBCDIC', ebcdic, 'UTF-8'],
  ])('rejects %s declared as %s as a fatal mismatch', (_, detection, declaration) => {
    expect(checkDeclaredEncoding(detection, declaration)).toMatchObject({ code: 'ENCODING_MISMATCH', level: 'fatal' });
  });

  it('requires a declaration when neither a byte-order mark nor ASCII shows the encoding', () => {
    for (const detection of [utf16beBare, utf16leBare, utf32beBare, ucs2143, ebcdic]) {
      expect(checkDeclaredEncoding(detection, undefined)).toMatchObject({
        code: 'ENCODING_UNDECLARED',
        level: 'fatal',
      });
    }
    for (const detection of [ascii, utf8Bom, utf16leBom, utf32beBom]) {
      expect(checkDeclaredEncoding(detection, undefined)).toBeUndefined();
    }
  });

  it('reports UTF-16 declared without a byte-order mark as an error, which is not fatal', () => {
    expect(checkDeclaredEncoding(utf16leBare, 'UTF-16')).toMatchObject({
      code: 'ENCODING_UTF16_WITHOUT_BOM',
      level: 'error',
    });
  });

  it('only warns when an encoding supplied from outside conflicts with the declaration (RFC 7303 §3.2)', () => {
    const external = detected(utf8('<?xml?>'), 'utf-8');
    expect(checkDeclaredEncoding(external, 'ISO-8859-1')).toMatchObject({
      code: 'ENCODING_CONFLICT',
      level: 'warning',
    });
    expect(checkDeclaredEncoding(external, 'UTF-8')).toBeUndefined();
    expect(checkDeclaredEncoding(external, undefined)).toBeUndefined();
  });

  it('does not warn when a byte-order mark settled the encoding', () => {
    const detection: Detection = {
      byteOrderMark: 'utf-8',
      byteOrderMarkLength: 3,
      family: 'ascii',
      external: 'utf-8',
      decoderName: 'utf-8',
    };
    expect(checkDeclaredEncoding(detection, 'ISO-8859-1')).toBeUndefined();
  });
});

describe('detection in documents', () => {
  it('finds a byte-order mark split over chunks, or after an empty chunk, and never reports it as text', () => {
    const doc = join(bytes(0xef, 0xbb, 0xbf), utf8('<?xml version="1.0"?><root xml:lang="en"/>'));
    expect(verdict(split(doc, 1))).toBe('accepted <root xml:lang="en"></root>');
    expect(verdict([bytes(), doc])).toBe('accepted <root xml:lang="en"></root>');
  });

  it('decodes UTF-16 with a byte-order mark in either order, split anywhere', () => {
    const xml = '<?xml version="1.0" encoding="UTF-16"?>\n<person>Hi Jérôme</person>';
    for (const little of [true, false]) {
      for (const size of [1, 3, 7]) {
        const doc = utf16(xml, little, true);
        expect(verdict(split(doc, size))).toBe('accepted <person>Hi Jérôme</person>');
      }
    }
  });

  it('rejects UTF-16 with a byte-order mark that declares UTF-8 (§4.3.3)', () => {
    expect(verdict(utf16('<?xml version="1.0" encoding="UTF-8"?><a/>', true, true))).toBe('ENCODING_MISMATCH 1:1');
  });

  it('rejects UTF-16 with neither a byte-order mark nor a declaration', () => {
    expect(verdict(utf16('<a/>', true))).toBe('ENCODING_UNDECLARED 1:1');
  });

  it('accepts UTF-16 without a byte-order mark that declares its byte order', () => {
    expect(verdict(utf16('<?xml version="1.0" encoding="UTF-16BE"?><a/>', false))).toBe('accepted <a></a>');
  });

  it('reports UTF-16 without a byte-order mark declared as UTF-16 to the error handler, and reads on', () => {
    const doc = utf16('<?xml version="1.0" encoding="UTF-16"?><a/>', true);
    expect(verdict(doc)).toBe('ENCODING_UTF16_WITHOUT_BOM 1:1');
    const errors: string[] = [];
    expect(verdict(doc, { errorHandler: { error: (e: XMLError) => errors.push(e.code) } })).toBe('accepted <a></a>');
    expect(errors).toEqual(['ENCODING_UTF16_WITHOUT_BOM']);
  });

  it('rejects UTF-32 without a byte-order mark that declares no encoding', () => {
    expect(verdict(utf32('<a/>', '1234'))).toBe('ENCODING_UNDECLARED 1:1');
  });

  it('rejects bytes that are not legal in the encoding the declaration names', () => {
    expect(verdict(framed('<?xml version="1.0" encoding="UTF-8"?><a>', [0xe9], '</a>'))).toBe(
      'ENCODING_INVALID_BYTES 1:42'
    );
    expect(verdict(framed('<?xml version="1.0" encoding="US-ASCII"?><a>', [0x80], '</a>'))).toBe(
      'ENCODING_INVALID_BYTES 1:45'
    );
  });

  it('reads a euro EBCDIC page declared by its registered name (§4.3.3)', () => {
    const doc = singleByte('ibm1140', '<?xml version="1.0" encoding="IBM01140"?><a>€</a>');
    expect(verdict(doc)).toBe('accepted <a>€</a>');
    expect(verdict(utf8('<?xml version="1.0" encoding="IBM01140"?><a/>'))).toBe('ENCODING_MISMATCH 1:1');
  });

  it('reads IBM1026, which writes " as 0xFC where IBM037 has 0x7F (Appendix F.1)', () => {
    const doc = singleByte('ibm1026', '<?xml version="1.0" encoding="IBM1026"?><a b="c">d</a>');
    expect(verdict(doc)).toBe('accepted <a b="c">d</a>');
  });

  it('finds the encoding however far into the declaration it is, in chunks of any size (§4.3.3)', async () => {
    const doc = framed(`<?xml version="1.0"${' '.repeat(1100)} encoding="ISO-8859-1"?><a>`, [0xe9], '</a>');
    expect(verdict(doc)).toBe('accepted <a>é</a>');
    for (const size of [1, 7, 64, 1000]) {
      expect(verdict(split(doc, size)), `in chunks of ${size}`).toBe('accepted <a>é</a>');
      const read = new XMLInputFactory().createAsyncStreamReader(streamOf(split(doc, size)));
      expect(await canonicalOfAsync(read), `streamed in chunks of ${size}`).toBe('<a>é</a>');
    }
  });

  it('reads a long declaration that arrives a byte at a time in linear time', () => {
    const doc = utf8(`<?xml version="1.0"${' '.repeat(200_000)} encoding="ISO-8859-1"?><a/>`);
    expect(verdict(split(doc, 1))).toBe('accepted <a></a>');
  });

  it('decodes with an encoding supplied from outside, warning that it overrides the declaration', () => {
    const doc = framed('<?xml version="1.0" encoding="UTF-8"?><a>', [0xe9], '</a>');
    const warnings: string[] = [];
    const options = { errorHandler: { warning: (e: XMLError) => warnings.push(e.code) } };
    expect(verdict({ bytes: doc, encoding: 'ISO-8859-1' }, options)).toBe('accepted <a>é</a>');
    expect(warnings).toEqual(['ENCODING_CONFLICT']);
  });

  it('reports the encoding the declaration names, or else the one detected', () => {
    expect(reader(utf8('<?xml version="1.0" encoding="Latin1"?><a/>')).encoding()).toBe('Latin1');
    expect(reader(utf8('<a/>')).encoding()).toBe('utf-8');
    expect(reader(utf16('<a/>', false, true)).encoding()).toBe('utf-16be');
    expect(reader('<a/>').encoding()).toBeUndefined();
  });
});
