import { utf16 } from '@test/helpers/agreement.ts';
import { canonicalHandler } from '@test/helpers/canonical.ts';
import { recorder } from '@test/helpers/recorder.ts';
import { describe, expect, it } from 'vitest';
import { XMLError } from '@exemplarjs/xml';
import { SAXParser } from '@/index.ts';

const UTF8 = new TextEncoder();

/** Yields the given chunks asynchronously. */
async function* yielding(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

/** Every call SAX makes for a document fed as the given chunks. */
async function callsOf(chunks: readonly Uint8Array[]): Promise<string[]> {
  const { handler, calls } = recorder();
  await new SAXParser().parseAsync(yielding(chunks), handler);
  return calls;
}

/** Every call SAX makes for a document read whole. */
function wholeCalls(bytes: Uint8Array): string[] {
  const { handler, calls } = recorder();
  new SAXParser().parse(bytes, handler);
  return calls;
}

/** Splits bytes at the given offsets. */
function split(bytes: Uint8Array, ...at: number[]): Uint8Array[] {
  const bounds = [0, ...at, bytes.length];
  return bounds.slice(1).map((end, i) => bytes.subarray(bounds[i], end));
}

describe('SAX gives the same events however the input is split', () => {
  it.each([
    [
      'an XML declaration and attributes',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root a = "x" b=\'y\'></root   >',
    ],
    [
      'a DOCTYPE with a comment holding [, ] and a quote',
      `<!DOCTYPE root [<!ENTITY x "a>b"><!-- [c] ' -->]><root>&x;</root>`,
    ],
    [
      'references, CDATA, comments and PIs',
      '<r v="A&amp;&#x42;">before&amp;&#67;after<![CDATA[x]]y]]><!--c--><?p d?></r>',
    ],
    ['multi-byte characters in names, values and text', '<тест a="误😀">한글😀é</тест>'],
    ['namespaces', '<p:r xmlns:p="urn:p" xmlns="urn:d"><c p:a="1"/></p:r>'],
    ['line ends of every kind', '<r a="1"\r\n b="2">\r  x\r\ny\n</r>'],
  ])('split once at every offset: %s', async (_title, xml) => {
    const bytes = UTF8.encode(xml);
    const whole = wholeCalls(bytes);
    for (let at = 0; at <= bytes.length; at++) {
      expect(await callsOf(split(bytes, at)), `split at ${at}`).toEqual(whole);
    }
  });

  it('reads a name split across four chunks as one', async () => {
    const chunks = ['<abcdefghijklmn', 'opqrstuvwxyzABC', 'DEFGHIJKLMNOPQR', 'STUVWXYZ/>'].map((c) => UTF8.encode(c));
    expect(await callsOf(chunks)).toContain(
      'startElement(, abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ, abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ, [])'
    );
  });

  it('reads text split across chunks as the same text', async () => {
    const { handler, written } = canonicalHandler();
    await new SAXParser().parseAsync(yielding([UTF8.encode('<T>fl'), UTF8.encode('ush</T>')]), handler);
    expect(written()).toBe('<T>flush</T>');
  });

  it.each([
    ['inside the content', ['<r><![CDATA[ this is ', 'character data  ', ']]></r>'], ' this is character data  '],
    ['inside the terminator', ['<r><![CDATA[ this is ]', ']>', '</r>'], ' this is '],
    ['after a bracket of the terminator', ['<r><![CDATA[a]]', '>', '</r>'], 'a'],
  ])('reads a CDATA section split %s', async (_title, chunks, text) => {
    const { handler, calls } = recorder(['characters', 'startCDATA', 'endCDATA']);
    await new SAXParser().parseAsync(yielding(chunks.map((c) => UTF8.encode(c))), handler);
    expect(calls[0]).toBe('startCDATA()');
    expect(calls.at(-1)).toBe('endCDATA()');
    expect(
      calls
        .slice(1, -1)
        .map((c) => c.slice('characters('.length, -1))
        .join('')
    ).toBe(text);
  });

  it('reads adjacent CDATA sections with the second opener split', async () => {
    const chunks = ['<r><![CDATA[a]]><![CDA', 'T', 'A[b]]></r>'].map((c) => UTF8.encode(c));
    expect(await callsOf(chunks)).toEqual(wholeCalls(UTF8.encode('<r><![CDATA[a]]><![CDATA[b]]></r>')));
  });

  it('reads a reference split across chunks', async () => {
    const { handler, written } = canonicalHandler();
    await new SAXParser().parseAsync(yielding([UTF8.encode('<r>a &am'), UTF8.encode('p; b</r>')]), handler);
    expect(written()).toBe('<r>a &amp; b</r>');
  });

  it.each([
    [1, 2],
    [2, 1],
  ])('reads 误 split %i|%i between chunks', async (first) => {
    const bytes = UTF8.encode('<d>误</d>');
    expect(await callsOf(split(bytes, 3 + first))).toEqual(wholeCalls(bytes));
  });

  it('reads 误 with markup in the same chunks', async () => {
    const chunks = [
      Uint8Array.from([...UTF8.encode('<d>'), 0xe8]),
      Uint8Array.from([0xaf, 0xaf, ...UTF8.encode('</d>')]),
    ];
    expect(await callsOf(chunks)).toContain('characters(误)');
  });

  it('reads a UTF-8 byte order mark split over three chunks, and an empty first chunk', async () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...UTF8.encode('<root/>')]);
    const whole = wholeCalls(bytes);
    expect(await callsOf(split(bytes, 1, 2))).toEqual(whole);
    expect(await callsOf([new Uint8Array(0), bytes])).toEqual(whole);
  });

  it.each([7, 34])('reads UTF-16LE split at byte %i, inside a code unit', async (at) => {
    const bytes = utf16('<?xml version="1.0" encoding="UTF-16"?><person>Hi Jérôme</person>', true);
    expect(await callsOf(split(bytes, at))).toEqual(wholeCalls(bytes));
  });

  it('reads UTF-16BE fed three bytes at a time, splitting every code unit', async () => {
    const bytes = utf16('<a b="😀">text</a>', false);
    const chunks = Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => bytes.subarray(i * 3, i * 3 + 3));
    expect(await callsOf(chunks)).toEqual(wholeCalls(bytes));
  });

  it('reads an astral character fed a byte at a time in a value and in text', async () => {
    const bytes = UTF8.encode('<r a="😀">😀</r>');
    expect(await callsOf(Array.from(bytes, (b) => Uint8Array.of(b)))).toEqual([
      'startDocument()',
      'startElement(, r, r, [a=😀])',
      'characters(😀)',
      'endElement(, r, r)',
      'endDocument()',
    ]);
  });

  it.each([
    ['text', (s: string) => `<r>${s}</r>`],
    ['CDATA', (s: string) => `<r><![CDATA[${s}]]></r>`],
    ['a comment', (s: string) => `<r><!--${s}--></r>`],
    ['a PI', (s: string) => `<r><?p ${s}?></r>`],
    ['an attribute value', (s: string) => `<r a="${s}"/>`],
  ])('reads 16 KiB of %s fed a byte at a time', async (_kind, wrap) => {
    const bytes = UTF8.encode(wrap('x'.repeat(16_384)));
    const fed = await callsOf(Array.from(bytes, (b) => Uint8Array.of(b)));
    const whole = wholeCalls(bytes);
    const isText = (call: string) => call.startsWith('characters(');
    const text = (calls: string[]) =>
      calls
        .filter((call) => isText(call))
        .map((call) => call.slice('characters('.length, -1))
        .join('');
    expect(text(fed)).toBe(text(whole));
    expect(fed.filter((call) => !isText(call))).toEqual(whole.filter((call) => !isText(call)));
  });

  it('reports events as soon as their markup is complete, before the rest arrives', async () => {
    const seen: string[] = [];
    const snapshots: string[][] = [];
    async function* source(): AsyncGenerator<Uint8Array> {
      yield UTF8.encode('<a><b/><c x="1">');
      snapshots.push([...seen]);
      yield UTF8.encode('</c></a>');
    }
    await new SAXParser().parseAsync(source(), { startElement: (_uri, localName) => seen.push(localName) });
    expect(snapshots[0]).toEqual(['a', 'b', 'c']);
  });

  /** Parses one chunk asynchronously. */
  function parseChunk(chunk: Uint8Array): Promise<void> {
    return new SAXParser().parseAsync(yielding([chunk]), {});
  }

  it('rejects a start tag left open only once the input ends', async () => {
    await expect(parseChunk(UTF8.encode('<root'))).rejects.toThrow(
      expect.objectContaining({ code: 'WF_UNEXPECTED_END' })
    );
    await expect(parseChunk(UTF8.encode('<root><child/>'))).rejects.toBeInstanceOf(XMLError);
    await expect(parseChunk(UTF8.encode('  \n '))).rejects.toThrow(
      expect.objectContaining({ code: 'WF_EMPTY_DOCUMENT' })
    );
  });

  it('rejects one byte that is not UTF-8 in the first chunk', async () => {
    await expect(parseChunk(Uint8Array.of(0xff))).rejects.toThrow(
      expect.objectContaining({ code: 'ENCODING_INVALID_BYTES' })
    );
  });
});
