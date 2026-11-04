import { canonicalOfAsync } from '@test/helpers/canonical.ts';
import { canonical } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, type ResolveRequest, type Source, XMLInputFactory } from '@/index.ts';

const encoder = new TextEncoder();

/** A web stream of a document's bytes in chunks of one size. */
function stream(xml: string, size: number): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(xml);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(at, (at += size)));
    },
  });
}

/** An async iterable of a document's bytes in chunks of one size. */
async function* iterable(xml: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = encoder.encode(xml);
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** Reads a document with the async reader as a web stream and as an async iterable, in several chunk sizes. */
async function readAsync(xml: string, options: InputOptions = {}): Promise<string> {
  const factory = new XMLInputFactory(options);
  const results = new Set<string>();
  const read = (source: Source) => canonicalOfAsync(factory.createAsyncStreamReader(source));
  for (const size of [1, 3, 64, 4096]) {
    results.add(await read(stream(xml, size)));
    results.add(await read(iterable(xml, size)));
  }
  results.add(await read(xml));
  expect(results.size).toBe(1);
  return [...results][0] as string;
}

/** The events a fed reader gives until it needs input, by type. */
function drain(reader: ReturnType<XMLInputFactory['createAsyncStreamReader']>): number[] {
  const events: number[] = [];
  for (let e = reader.next(); e !== EventType.NEED_INPUT && e !== EventType.END_DOCUMENT; e = reader.next()) {
    events.push(e);
  }
  return events;
}

describe('the async cursor', () => {
  it('reads streams in chunks of any size, as the sync reader reads the same document', async () => {
    const xml =
      '<?xml version="1.0"?>\r\n<!DOCTYPE a [<!ENTITY e "<b>&#233;</b>">]><a x="1 &amp; 2">t\r\nx&e;<![CDATA[c]]><?p d?></a>';
    expect(await readAsync(xml)).toBe(canonical(xml));
  });

  it('reports START_DOCUMENT from next() once it has read the XML declaration', async () => {
    const reader = new XMLInputFactory().createAsyncStreamReader(
      stream('<?xml version="1.1" encoding="UTF-8"?><a/>', 4)
    );
    expect(reader.eventType()).toBe(EventType.NEED_INPUT);
    let event = reader.next();
    while (event === EventType.NEED_INPUT) {
      await reader.fill();
      event = reader.next();
    }
    expect([event, reader.version(), reader.encoding()]).toEqual([EventType.START_DOCUMENT, '1.1', 'UTF-8']);
  });

  it('gives events as soon as each is complete when fed', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(encoder.encode('<a><b>te'));
    expect(drain(reader)).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT, EventType.START_ELEMENT]);
    reader.feed(encoder.encode('xt</b'));
    expect(drain(reader)).toEqual([EventType.CHARACTERS]);
    reader.feed(encoder.encode('>'));
    expect(drain(reader)).toEqual([EventType.END_ELEMENT]);
    reader.feed(encoder.encode('</a>'));
    expect(drain(reader)).toEqual([EventType.END_ELEMENT]);
    reader.endOfInput();
    expect(reader.next()).toBe(EventType.END_DOCUMENT);
  });

  it('gives a short root, comments and the DOCTYPE as soon as each is complete when fed', () => {
    const short = new XMLInputFactory().createAsyncStreamReader();
    short.feed(encoder.encode('<a>'));
    expect(drain(short)).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT]);
    short.feed(encoder.encode('</a>'));
    expect(drain(short)).toEqual([EventType.END_ELEMENT]);
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(encoder.encode('<!DOCTYPE r>'));
    expect(drain(reader)).toEqual([EventType.START_DOCUMENT, EventType.DTD]);
    reader.feed(encoder.encode('<r><!--c-->'));
    expect(drain(reader)).toEqual([EventType.START_ELEMENT, EventType.COMMENT]);
    reader.feed(encoder.encode('<!---->'));
    expect(drain(reader)).toEqual([EventType.COMMENT]);
    reader.feed(encoder.encode('</r>'));
    expect(drain(reader)).toEqual([EventType.END_ELEMENT]);
  });

  it('resolves fill() for a fed reader when the next chunk is fed', async () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    const filled = reader.fill();
    reader.feed(encoder.encode('<a/>'));
    await filled;
    reader.endOfInput();
    expect(drain(reader)).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT, EventType.END_ELEMENT]);
  });

  // Long enough that rescanning the token on every piece would run far past the test's timeout.
  const long = 'x'.repeat(2_000_000);
  it.each([
    ['text', `<a>${long}</a>`],
    ['attribute value', `<a v="${long}"/>`],
    ['CDATA section', `<a><![CDATA[${long}]]></a>`],
    ['comment', `<a><!--${long}--></a>`],
  ])('reads a long %s fed in small pieces in linear time', (_kind, xml) => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    const bytes = encoder.encode(xml);
    let length = 0;
    for (let i = 0; i < bytes.length; i += 16) {
      reader.feed(bytes.subarray(i, i + 16));
      for (let e = reader.next(); e !== EventType.NEED_INPUT; e = reader.next()) {
        if (e === EventType.START_ELEMENT && reader.attributeCount() > 0) length += reader.attributeValue(0).length;
        else if (e === EventType.CHARACTERS || e === EventType.CDATA || e === EventType.COMMENT) {
          length += reader.text().length;
        }
      }
    }
    expect(length).toBe(long.length);
  });

  it('refuses to be fed when it reads a stream', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader(stream('<a/>', 1));
    expect(() => reader.feed(new Uint8Array(1))).toThrow(TypeError);
  });

  it('waits for resolvers that answer with promises or streams', async () => {
    const files: Record<string, string> = {
      'http://x/a.dtd': '<!ENTITY % p SYSTEM "p.ent"> %p; <!ATTLIST a d CDATA "default">',
      'http://x/p.ent': '<!ENTITY e SYSTEM "e.xml">',
      'http://x/e.xml': '<b>external</b>',
    };
    const asked: string[] = [];
    const entityResolver = {
      resolveEntity(request: ResolveRequest) {
        const uri = new URL(request.systemId ?? '', request.baseURI).href;
        asked.push(request.name);
        const text = files[uri];
        if (text === undefined) return undefined;
        return request.name === 'e'
          ? Promise.resolve({ systemId: uri, stream: stream(text, 2) })
          : Promise.resolve({ systemId: uri, text });
      },
    };
    const options: InputOptions = { entityResolver, accessExternalDTD: 'all', accessExternalEntities: 'all' };
    const factory = new XMLInputFactory(options);
    const xml = '<!DOCTYPE a SYSTEM "http://x/a.dtd"><a>&e;</a>';
    expect(await canonicalOfAsync(factory.createAsyncStreamReader(xml))).toBe('<a d="default"><b>external</b></a>');
    expect(asked).toEqual(['[dtd]', '%p', 'e']);
  });

  it('reports a DTD error once, though it reads the DTD again after each answer', async () => {
    const errors: string[] = [];
    const entityResolver = {
      resolveEntity: () => Promise.resolve({ text: '<!ENTITY x "1">' }),
    };
    const factory = new XMLInputFactory({
      entityResolver,
      accessExternalDTD: 'all',
      errorHandler: { error: (e) => errors.push(e.code) },
    });
    const xml = '<!DOCTYPE a SYSTEM "http://x/a.dtd" [%undeclared;]><a/>';
    await canonicalOfAsync(factory.createAsyncStreamReader(xml));
    expect(errors).toEqual(['VC_ENTITY_DECLARED']);
  });

  it('tells a sync reader to use an async one when a resolver answers with a promise', () => {
    const entityResolver = { resolveEntity: () => Promise.resolve({ text: '' }) };
    const xml = '<!DOCTYPE a SYSTEM "http://x/a.dtd"><a/>';
    expect(() => canonical(xml, { entityResolver, accessExternalDTD: 'all' })).toThrow(/asynchronous reader/);
  });
});

/** Reads an async cursor over a source to its end; returns each event with its location, or the error last. */
async function drive(source: Source, options: InputOptions = {}): Promise<string[]> {
  const r = new XMLInputFactory(options).createAsyncStreamReader(source);
  const out: string[] = [];
  try {
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.NEED_INPUT) {
        await r.fill();
        continue;
      }
      const { line, column, systemId = '' } = r.location();
      let detail = '';
      if (e === EventType.START_ELEMENT) detail = r.name();
      else if (e === EventType.CHARACTERS) detail = r.text();
      out.push(`${e}${detail}@${line}:${column}${systemId}`);
    }
  } catch (error) {
    const { code, line, column } = error as { code?: string; line?: number; column?: number };
    out.push(code === undefined ? `thrown ${String(error)}` : `${code}@${line}:${column}`);
  }
  return out;
}

/** An async iterable of the given byte chunks. */
async function* bytesOf(...chunks: (string | number[])[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield typeof chunk === 'string' ? encoder.encode(chunk) : new Uint8Array(chunk);
}

/** UTF-16BE bytes of a string, after a byte-order mark. */
const utf16be = (text: string) => [
  0xfe,
  0xff,
  ...Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)).flatMap((unit) => [unit >> 8, unit & 0xff]),
];

describe('the async cursor over streams', () => {
  it('reads every kind of source: strings, bytes, iterables, source objects and streams', async () => {
    const expected = ['7@1:1', '1a@1:1', '2@1:4'];
    const sources: Source[] = [
      '<a></a>',
      encoder.encode('<a></a>'),
      [encoder.encode('<a>'), encoder.encode('</a>')],
      { chunks: [encoder.encode('<a></a>')] },
      bytesOf('<a>', '</a>'),
      stream('<a></a>', 2),
      { stream: stream('<a></a>', 3) },
    ];
    for (const source of sources) expect(await drive(source)).toEqual(expected);
  });

  it('gives events the system id of a source object with a stream', async () => {
    expect(await drive({ systemId: 'urn:s', stream: bytesOf('<a>', '</a>') })).toEqual([
      '7@1:1urn:s',
      '1a@1:1urn:s',
      '2@1:4urn:s',
    ]);
  });

  it('skips empty chunks', async () => {
    expect(await drive(bytesOf([], '<a>', [], [], '</a>', []))).toEqual(['7@1:1', '1a@1:1', '2@1:4']);
  });

  it('decodes with an encoding given from outside, and with a byte-order mark split over chunks', async () => {
    expect(
      await drive({ encoding: 'ISO-8859-1', stream: bytesOf([0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e]) })
    ).toEqual(['7@1:1', '1a@1:1', '4é@1:4', '2@1:5']);
    expect(await drive(bytesOf([0xef], [0xbb], [0xbf], '<a/>'))).toEqual(['7@1:1', '1a@1:1', '2@1:1']);
    expect(await drive(bytesOf([], [0xef, 0xbb, 0xbf], '<a/>'))).toEqual(['7@1:1', '1a@1:1', '2@1:1']);
  });

  it('reads UTF-16 whose code units every chunk boundary splits', async () => {
    const bytes = utf16be('<?xml version="1.0" encoding="UTF-16"?><a>é𝄞</a>');
    const chunks = Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => bytes.slice(i * 3, i * 3 + 3));
    expect(await drive(bytesOf(...chunks))).toEqual(['7@1:1', '1a@1:40', '4é𝄞@1:43', '2@1:46']);
  });

  it('reads UTF-8 characters split over chunks in every way', async () => {
    const xml = '<d p="误😀">误😀</d>';
    const bytes = [...encoder.encode(xml)];
    const expected = await drive(xml);
    for (let at = 1; at < bytes.length; at++) {
      const split = bytesOf(bytes.slice(0, at), bytes.slice(at));
      expect(await drive(split)).toEqual(expected);
    }
  });

  it('rejects input that ends in the middle of a character, or bytes that are not UTF-8', async () => {
    const truncated = [0xff, 0xfe, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e];
    expect(await drive(bytesOf(truncated))).toEqual(['7@1:1', 'ENCODING_INVALID_BYTES@1:4']);
    expect(await drive(bytesOf([0xff]))).toEqual(['ENCODING_INVALID_BYTES@1:1']);
    const cut = await drive(bytesOf('<d>', [0xe8], '</d>'));
    expect(cut.at(-1)).toBe('ENCODING_INVALID_BYTES@1:4');
  });

  it('passes on the error a stream fails with', async () => {
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(encoder.encode('<a>'));
        else controller.error(new RangeError('broken'));
      },
    });
    expect(await drive(failing)).toEqual(['7@1:1', '1a@1:1', 'thrown RangeError: broken']);
    /** A chunk, then a failure. */
    async function* breaking() {
      yield encoder.encode('<a>');
      throw new RangeError('broken too');
    }
    expect(await drive(breaking())).toEqual(['7@1:1', '1a@1:1', 'thrown RangeError: broken too']);
  });

  it('reports content after the root as soon as a chunk shows it', async () => {
    expect(await drive(bytesOf('<r/> ', 'tail'))).toEqual(['7@1:1', '1r@1:1', '2@1:1', 'WF_CONTENT_OUTSIDE_ROOT@1:5']);
  });

  it('reads a long name, text and CDATA section spread over many chunks', async () => {
    const name = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR';
    const xml = `<${name} v="${'v'.repeat(5000)}">${'t'.repeat(20_000)}<![CDATA[${'c'.repeat(20_000)}]]></${name}>`;
    expect(await readAsync(xml)).toBe(canonical(xml));
  });

  it('reads the edge cases of CDATA split at its delimiters', async () => {
    /** The canonical form of a document read from the given chunks. */
    const read = (...chunks: string[]) =>
      canonicalOfAsync(new XMLInputFactory().createAsyncStreamReader(bytesOf(...chunks)));
    expect(await read('<r><![CDATA[ this is ]', ']>', '</r>')).toBe('<r> this is </r>');
    expect(await read('<r><![CDATA[ this is ', 'character data  ', ']]></r>')).toBe('<r> this is character data  </r>');
    expect(await read('<r><![CDATA[a]]><![CDA', 'T', 'A[b]]></r>')).toBe('<r>ab</r>');
    expect(await readAsync('<r><![CDATA[[[[[[[[[]]]]]]]]]]></r>')).toBe('<r>[[[[[[[[]]]]]]]]</r>');
  });

  it('reads a document whose XML declaration a chunk boundary splits', async () => {
    const reader = new XMLInputFactory().createAsyncStreamReader(
      bytesOf('<?xml', ' version="1.0" encoding="UTF-8" st', 'andalone="yes"?><root a = "x"></root   >')
    );
    let event = reader.next();
    while (event === EventType.NEED_INPUT) {
      await reader.fill();
      event = reader.next();
    }
    expect([event, reader.version(), reader.encoding(), reader.standalone()]).toEqual([
      EventType.START_DOCUMENT,
      '1.0',
      'UTF-8',
      true,
    ]);
  });
});
