import { latin1, readEveryWay, utf16 } from '@test/helpers/agreement.ts';
import { describe, expect, it } from 'vitest';

const UTF8 = new TextEncoder();

/** Concatenates byte arrays. */
function bytes(...parts: (Uint8Array | readonly number[])[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

describe('SAX agrees with the cursor on documents given as bytes (§4.3.3, appendix F)', () => {
  it('reads UTF-8 without a declaration', async () => {
    expect(await readEveryWay({ xml: UTF8.encode('<d>误 é 😀</d>') })).toBe('<d>误 é 😀</d>');
  });

  it('skips a UTF-8 byte order mark, keeping a later U+FEFF as a character', async () => {
    const xml = bytes([0xef, 0xbb, 0xbf], UTF8.encode('<div>\uFEFF</div>'));
    expect(await readEveryWay({ xml })).toBe('<div>\uFEFF</div>');
  });

  it('reads a UTF-8 BOM before the XML declaration', async () => {
    const xml = bytes([0xef, 0xbb, 0xbf], UTF8.encode('<?xml version="1.0"?><root xml:lang="en"/>'));
    expect(await readEveryWay({ xml })).toBe('<root xml:lang="en"></root>');
  });

  it.each([
    ['UTF-16LE', true],
    ['UTF-16BE', false],
  ])('reads %s with a byte order mark and encoding="UTF-16"', async (_name, littleEndian) => {
    const xml = utf16('<?xml version="1.0" encoding="UTF-16"?>\n<person>Hi Jérôme 😀</person>', littleEndian);
    expect(await readEveryWay({ xml })).toBe('<person>Hi Jérôme 😀</person>');
  });

  it.each([
    ['UTF-16LE', true],
    ['UTF-16BE', false],
  ])('detects %s from its byte order mark without a declaration', async (_name, littleEndian) => {
    expect(await readEveryWay({ xml: utf16('<a b="ü">€</a>', littleEndian) })).toBe('<a b="ü">€</a>');
  });

  it('reads ISO-8859-1 as declared', async () => {
    const xml = latin1('<?xml version="1.0" encoding="ISO-8859-1"?><a v="é">ÿ\u00A0</a>');
    expect(await readEveryWay({ xml })).toBe('<a v="é">ÿ\u00A0</a>');
  });

  it('reads windows-1252 as declared', async () => {
    const xml = bytes(
      UTF8.encode('<?xml version="1.0" encoding="windows-1252"?><a>'),
      [0x80, 0x93, 0x94],
      UTF8.encode('</a>')
    );
    expect(await readEveryWay({ xml })).toBe('<a>€“”</a>');
  });

  it('reads US-ASCII as declared', async () => {
    expect(await readEveryWay({ xml: UTF8.encode('<?xml version="1.0" encoding="US-ASCII"?><a>&#xE9;</a>') })).toBe(
      '<a>é</a>'
    );
  });

  it('reads a long mixed run of CJK, astral and Latin text the same as bytes and as a string', async () => {
    const text = '한글😀é'.repeat(4096);
    expect(await readEveryWay({ xml: UTF8.encode(`<r a="${text}">${text}</r>`) })).toBe(`<r a="${text}">${text}</r>`);
    expect(await readEveryWay(`<r>${text}</r>`)).toBe(`<r>${text}</r>`);
  });

  it('reads a document whose encoding comes with the source, as from HTTP', async () => {
    const xml = latin1('<a>é</a>');
    const { SAXParser } = await import('@/index.ts');
    const seen: string[] = [];
    new SAXParser().parse({ bytes: xml, encoding: 'ISO-8859-1' }, { characters: (t) => seen.push(t) });
    expect(seen).toEqual(['é']);
  });
});
