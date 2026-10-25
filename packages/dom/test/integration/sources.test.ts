import { DOCUMENTS } from '@test/helpers/documents.ts';
import { build, buildAsync, serialize, streamOf, utf16, utf8 } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import type { Source } from '@exemplarjs/xml';
import { type Document, DocumentBuilder } from '@/index.ts';

/** Splits bytes into chunks of one size. */
function chunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

/** An async iterable of chunks, as a Node stream gives. */
async function* fed(parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

/** ISO-8859-1 bytes of a string whose characters all fit. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Checks that a tree is equal to the one built from the string, and serializes the same. */
function expectSame(document: Document, expected: Document, how: string): void {
  expect(document.isEqualNode(expected), how).toBe(true);
  expect(serialize(document), how).toBe(serialize(expected));
}

describe('the same tree from every kind of source', () => {
  it.each(Object.entries(DOCUMENTS))('builds %s alike from a string, bytes and chunks', (_name, xml) => {
    const expected = build(xml);
    const bytes = utf8(xml);
    expectSame(build(bytes), expected, 'bytes');
    expectSame(build({ text: xml }), expected, 'a source object with text');
    expectSame(build({ bytes }), expected, 'a source object with bytes');
    for (const size of [1, 2, 3, 7, 64]) {
      expectSame(build(chunks(bytes, size)), expected, `chunks of ${size}`);
      expectSame(build({ chunks: chunks(bytes, size) }), expected, `a source object with chunks of ${size}`);
    }
  });

  it.each(Object.entries(DOCUMENTS))('builds %s alike from streams', async (_name, xml) => {
    const expected = build(xml);
    const bytes = utf8(xml);
    for (const size of [1, 5, bytes.length]) {
      const parts = chunks(bytes, size);
      expectSame(await buildAsync(streamOf(bytes, size)), expected, `a stream in chunks of ${size}`);
      expectSame(await buildAsync({ stream: streamOf(bytes, size) }), expected, `a source object stream of ${size}`);
      expectSame(await buildAsync(fed(parts)), expected, `an async iterable of ${size}`);
    }
    expectSame(await buildAsync(xml), expected, 'a string, asynchronously');
    expectSame(await buildAsync(bytes), expected, 'bytes, asynchronously');
  });

  it.each(Object.entries(DOCUMENTS))('builds %s alike with entity references kept', async (_name, xml) => {
    const options = { replaceEntityReferences: false };
    const expected = build(xml, options);
    const bytes = utf8(xml);
    expectSame(build(chunks(bytes, 3), options), expected, 'chunks');
    expectSame(await buildAsync(streamOf(bytes, 2), options), expected, 'a stream');
  });
});

describe('the same tree from every encoding', () => {
  const text = '<r a="J\u{E9}r\u{F4}me">Hi J\u{E9}r\u{F4}me \u{1F525}</r>';
  const expected = build(text);

  it.each([
    ['UTF-8', utf8(text), 'UTF-8'],
    ['UTF-8 with a byte-order mark', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]), 'UTF-8'],
    ['UTF-16LE with a byte-order mark', utf16(text, true), 'UTF-16LE'],
    ['UTF-16BE with a byte-order mark', utf16(text, false), 'UTF-16BE'],
  ])('builds the same tree from %s, in whole and in single bytes', async (_name, bytes, encoding) => {
    const whole = build(bytes);
    expectSame(whole, expected, 'whole');
    expect(whole.inputEncoding).toBe(encoding);
    expectSame(build(chunks(bytes, 1)), expected, 'single bytes');
    expectSame(await buildAsync(streamOf(bytes, 1)), expected, 'a stream of single bytes');
  });

  it('builds the same tree from UTF-16 that declares its encoding', () => {
    const declared = '<?xml version="1.0" encoding="UTF-16"?>\n' + text;
    for (const littleEndian of [true, false]) {
      const document = build(utf16(declared, littleEndian));
      expect(document.xmlEncoding).toBe('UTF-16');
      expect(document.documentElement?.isEqualNode(expected.documentElement)).toBe(true);
      expect(document.childNodes).toHaveLength(1);
    }
  });

  it('builds the same tree from ISO-8859-1 that declares its encoding', () => {
    const declared = '<?xml version="1.0" encoding="ISO-8859-1"?>' + text.replace('\u{1F525}', '&#x1F525;');
    const document = build(latin1(declared));
    expect(document.documentElement?.isEqualNode(expected.documentElement)).toBe(true);
    expect([document.inputEncoding, document.xmlEncoding]).toEqual(['ISO-8859-1', 'ISO-8859-1']);
  });

  it('builds a stream split inside a character the same', async () => {
    const bytes = utf8('<d>\u{8BEF}\u{1F600}</d>');
    for (const size of [1, 2, 3]) {
      const document = await buildAsync(streamOf(bytes, size));
      expect(document.documentElement?.textContent).toBe('\u{8BEF}\u{1F600}');
    }
  });
});

describe('one builder for many documents', () => {
  it('builds each source on its own', async () => {
    const builder = new DocumentBuilder();
    const sources: Source[] = ['<a/>', utf8('<b/>'), { text: '<c/>' }];
    const names = sources.map((source) => builder.parse(source).documentElement?.nodeName);
    const streamed = await builder.parseAsync(streamOf(utf8('<d/>'), 1));
    names.push(streamed.documentElement?.nodeName);
    expect(names).toEqual(['a', 'b', 'c', 'd']);
  });
});
