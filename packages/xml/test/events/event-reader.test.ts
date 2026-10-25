import { describe, expect, it } from 'vitest';
import { type AsyncEventReader, EventType, type XMLEvent, XMLInputFactory } from '@/index.ts';

const xml = new XMLInputFactory();

/** A one-line summary of an event. */
function summary(event: XMLEvent): string {
  switch (event.type) {
    case EventType.START_ELEMENT: {
      const attributes = event.attributes.map((a) => ` ${a.name.toString()}=${a.value}`).join('');
      return `<${event.name.toString()}${attributes}>`;
    }
    case EventType.END_ELEMENT: {
      return `</${event.name.toString()}>`;
    }
    case EventType.CHARACTERS:
    case EventType.CDATA:
    case EventType.SPACE: {
      return `"${event.text}"`;
    }
    case EventType.COMMENT: {
      return `<!--${event.text}-->`;
    }
    case EventType.PROCESSING_INSTRUCTION: {
      return `<?${event.target} ${event.data}?>`;
    }
    case EventType.START_DOCUMENT: {
      return `start ${event.version ?? ''}`;
    }
    case EventType.END_DOCUMENT: {
      return 'end';
    }
    default: {
      return String(event.type);
    }
  }
}

const DOCUMENT = '<?xml version="1.0"?><p:a xmlns:p="urn:p" x="1"><!--c--><?t d?>text<![CDATA[x]]></p:a>';
const SUMMARIES = ['start 1.0', '<p:a x=1>', '<!--c-->', '<?t d?>', '"text"', '"x"', '</p:a>', 'end'];

describe('the event reader', () => {
  it('yields one object per event, START_DOCUMENT first and END_DOCUMENT last', () => {
    expect([...xml.createEventReader(DOCUMENT)].map((e) => summary(e))).toEqual(SUMMARIES);
  });

  it('gives names, namespaces and attributes', () => {
    const events = [...xml.createEventReader(DOCUMENT)];
    const start = events[1];
    if (start?.type !== EventType.START_ELEMENT) throw new Error('Expected a start tag');
    expect([start.name.namespaceURI, start.name.localName, start.name.prefix]).toEqual(['urn:p', 'a', 'p']);
    expect(start.namespaces).toEqual([{ prefix: 'p', namespaceURI: 'urn:p' }]);
    expect(start.attribute('x')?.value).toBe('1');
    expect(start.location).toMatchObject({ line: 1, column: 22 });
  });

  it('gives every event the same hidden class', () => {
    const events = [...xml.createEventReader(DOCUMENT)];
    const keys = new Set(events.map((e) => Object.keys(e).join(',')));
    expect(keys.size).toBe(1);
  });

  it('works out locations when asked, even after the reader has dropped the text', () => {
    const lines = Array.from(
      { length: 300 },
      (_, i) => `<e n="${i}">${'x'.repeat(i % 7)}</e>${i % 3 === 0 ? '\r' : '\n'}`
    );
    const doc = `<?xml version="1.0"?>\n<a>\n${lines.join('')}</a>`;
    const bytes = new TextEncoder().encode(doc);
    const chunked = function* () {
      for (let i = 0; i < bytes.length; i += 50) yield bytes.subarray(i, i + 50);
    };
    const events = [...xml.createEventReader(chunked())];
    const expected: string[] = [];
    const reader = xml.createStreamReader(doc);
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      expected.push(`${reader.location().line}:${reader.location().column}`);
    }
    const found = events.slice(1, -1).map((e) => `${e.location.line}:${e.location.column}`);
    expect(found).toEqual(expected);
  });

  it('peeks without consuming, and skips to tags', () => {
    const reader = xml.createEventReader('<a> <!--c--> <b>t</b></a>');
    expect(reader.peek()?.type).toBe(EventType.START_DOCUMENT);
    expect(reader.nextEvent().type).toBe(EventType.START_DOCUMENT);
    expect(summary(reader.nextTag())).toBe('<a>');
    expect(summary(reader.nextTag())).toBe('<b>');
    expect(reader.elementText()).toBe('t');
    expect(summary(reader.nextTag())).toBe('</a>');
  });

  it('applies event filters', () => {
    const reader = xml.createEventReader(DOCUMENT).addFilter((e) => e.type !== EventType.COMMENT);
    expect([...reader].map((e) => summary(e))).not.toContain('<!--c-->');
  });
});

describe('the async event reader', () => {
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of new TextEncoder().encode(DOCUMENT)) controller.enqueue(new Uint8Array([c]));
        controller.close();
      },
    });

  it('yields the same events per event and per chunk', async () => {
    const perEvent: string[] = [];
    for await (const event of xml.createAsyncEventReader(stream())) perEvent.push(summary(event));
    const perChunk: string[] = [];
    for await (const batch of xml.createAsyncEventReader(stream()).batches()) {
      for (const event of batch) perChunk.push(summary(event));
    }
    expect(perEvent).toEqual(SUMMARIES);
    expect(perChunk).toEqual(SUMMARIES);
  });

  it('gives a web stream of events', async () => {
    const events: string[] = [];
    for await (const event of xml.createEventStream(stream())) events.push(summary(event));
    expect(events).toEqual(SUMMARIES);
  });

  it('reads a sync cursor too', async () => {
    const events: string[] = [];
    for await (const event of xml.createAsyncEventReader(xml.createStreamReader(DOCUMENT))) events.push(summary(event));
    expect(events).toEqual(SUMMARIES);
  });
});

describe('coalescing and copying strings', () => {
  it('merges adjacent text, CDATA and entity text into one CHARACTERS event', () => {
    const factory = new XMLInputFactory({ coalescing: true });
    const doc = '<!DOCTYPE a [<!ENTITY e "E"><!ENTITY m "<i/>">]><a>x<![CDATA[y]]>&e;&amp;z&m;w</a>';
    expect([...factory.createEventReader(doc)].map((e) => summary(e))).toEqual([
      'start ',
      '11',
      '<a>',
      '"xyE&z"',
      '<i>',
      '</i>',
      '"w"',
      '</a>',
      'end',
    ]);
  });

  it('merges text arriving in chunks of an async stream', async () => {
    const factory = new XMLInputFactory({ coalescing: true });
    const doc = '<a>one<![CDATA[two]]>three</a>';
    const chunks = async function* () {
      for (const c of new TextEncoder().encode(doc)) yield new Uint8Array([c]);
    };
    const texts: string[] = [];
    for await (const event of factory.createAsyncEventReader(chunks())) {
      if (event.type === EventType.CHARACTERS) texts.push(event.text);
    }
    expect(texts).toEqual(['onetwothree']);
  });

  it('reports the location where merged text starts', () => {
    const reader = new XMLInputFactory({ coalescing: true }).createStreamReader('<a>\nx<![CDATA[y]]></a>');
    reader.next();
    expect([reader.next(), reader.text(), reader.location().line, reader.location().column]).toEqual([
      EventType.CHARACTERS,
      '\nxy',
      1,
      4,
    ]);
    expect(reader.next()).toBe(EventType.END_ELEMENT);
  });

  it('returns equal strings with copyStrings on', () => {
    const long = 'a long attribute value';
    const reader = new XMLInputFactory({ copyStrings: true }).createStreamReader(`<a x="${long}">${long}</a>`);
    reader.next();
    expect(reader.attributeValue(0)).toBe(long);
    reader.next();
    expect(reader.text()).toBe(long);
  });
});

describe('the event reader as an iterator (StAX XMLEventReader)', () => {
  it('is its own iterator, done after END_DOCUMENT', () => {
    const reader = xml.createEventReader('<a/>');
    expect(reader[Symbol.iterator]()).toBe(reader);
    const types: EventType[] = [];
    for (let step = reader.next(); !step.done; step = reader.next()) types.push(step.value.type);
    expect(types).toEqual([
      EventType.START_DOCUMENT,
      EventType.START_ELEMENT,
      EventType.END_ELEMENT,
      EventType.END_DOCUMENT,
    ]);
    expect(reader.next()).toEqual({ done: true, value: undefined });
  });

  it('says whether there is another event, and has none after END_DOCUMENT', () => {
    const reader = xml.createEventReader('<a/>');
    const seen: EventType[] = [];
    while (reader.hasNext()) seen.push(reader.nextEvent().type);
    expect(seen.at(-1)).toBe(EventType.END_DOCUMENT);
    expect(reader.peek()).toBeUndefined();
    expect(() => reader.nextEvent()).toThrow('There are no more events');
  });

  it('gives the peeked event itself next', () => {
    const reader = xml.createEventReader('<a/>');
    reader.nextEvent();
    const peeked = reader.peek();
    expect(reader.peek()).toBe(peeked);
    expect(reader.nextEvent()).toBe(peeked);
  });

  it('skips whitespace text, SPACE, comments and PIs in nextTag, and fails on anything else', () => {
    const reader = new XMLInputFactory({ reportPrologWhitespace: true }).createEventReader(
      ' <a>\r\n\t<?p?><!--c--><b/>x</a>'
    );
    reader.nextEvent();
    expect(summary(reader.nextTag())).toBe('<a>');
    expect(summary(reader.nextTag())).toBe('<b>');
    expect(summary(reader.nextTag())).toBe('</b>');
    expect(() => reader.nextTag()).toThrow('Expected a start or end tag');
  });

  it('skips START_DOCUMENT in nextTag, as the cursor and StAX’s XMLEventReader do', () => {
    expect(summary(xml.createEventReader('<?xml version="1.0"?><!--c--> <a/>').nextTag())).toBe('<a>');
    const peeked = xml.createEventReader('<a/>');
    expect(peeked.peek()?.type).toBe(EventType.START_DOCUMENT);
    expect(summary(peeked.nextTag())).toBe('<a>');
    // @ts-expect-error -- an event reader takes a synchronous cursor, but reads an asynchronous one whose input is all there
    const fed = xml.createEventReader(xml.createAsyncStreamReader(new TextEncoder().encode('<a/>')));
    expect(summary(fed.nextTag())).toBe('<a>');
    expect(() => xml.createEventReader('<!DOCTYPE a><a/>').nextTag()).toThrow('Expected a start or end tag');
  });

  it('reads text, CDATA and references in elementText, skipping comments and PIs', () => {
    const reader = xml.createEventReader('<a>x<!--c-->&amp;<?p?><![CDATA[y]]></a>');
    reader.nextEvent();
    reader.nextTag();
    expect(reader.elementText()).toBe('x&y');
    expect(reader.next().value?.type).toBe(EventType.END_DOCUMENT);
  });

  it('refuses a child element in elementText', () => {
    const reader = xml.createEventReader('<a>x<b/></a>');
    reader.nextEvent();
    reader.nextTag();
    expect(() => reader.elementText()).toThrow('elementText() found a child element');
  });

  it('includes whitespace a validator reports as SPACE in elementText', () => {
    const validator = {
      create: () => ({
        dtd: () => undefined,
        startElement: () => undefined,
        endElement: () => undefined,
        text: () => true,
        markup: () => undefined,
        entity: () => undefined,
        endDocument: () => undefined,
      }),
    };
    const reader = new XMLInputFactory({ validator }).createEventReader('<a> </a>');
    reader.nextEvent();
    reader.nextTag();
    expect(reader.elementText()).toBe(' ');
  });

  it('applies every filter, and always passes END_DOCUMENT', () => {
    const reader = xml
      .createEventReader('<a><b/><c/></a>')
      .addFilter((e) => e.type === EventType.START_ELEMENT)
      .addFilter((e) => e.type !== EventType.START_ELEMENT || e.name.localName !== 'b');
    expect([...reader].map((e) => summary(e))).toEqual(['<a>', '<c>', 'end']);
  });

  it('throws the reader’s errors from nextEvent and iteration', () => {
    expect(() => [...xml.createEventReader('<a></b>')]).toThrow(
      expect.objectContaining({ code: 'WF_END_TAG_MISMATCH' })
    );
  });

  it('needs an asynchronous event reader for an asynchronous cursor that is waiting for input', () => {
    // @ts-expect-error -- an event reader takes a synchronous cursor, and fails on an asynchronous one that has to wait
    const reader = xml.createEventReader(xml.createAsyncStreamReader());
    expect(() => reader.nextEvent()).toThrow('An asynchronous reader needs an asynchronous event reader');
  });

  it('reads an asynchronous cursor whose input is all there', () => {
    // @ts-expect-error -- an event reader takes a synchronous cursor, but reads an asynchronous one whose input is all there
    const reader = xml.createEventReader(xml.createAsyncStreamReader(new TextEncoder().encode('<a/>')));
    expect([...reader].map((e) => summary(e))).toEqual(['start ', '<a>', '</a>', 'end']);
  });
});

describe('the async event reader, further', () => {
  /** A stream of a document's bytes, `size` at a time. */
  const chunked = (doc: string, size: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(doc);
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.subarray(i, i + size));
        controller.close();
      },
    });

  it('is its own async iterator, done after END_DOCUMENT', async () => {
    const reader = xml.createAsyncEventReader(chunked('<a/>', 2));
    expect(reader[Symbol.asyncIterator]()).toBe(reader);
    const types: EventType[] = [];
    for (let step = await reader.next(); !step.done; step = await reader.next()) types.push(step.value.type);
    expect(types).toEqual([
      EventType.START_DOCUMENT,
      EventType.START_ELEMENT,
      EventType.END_ELEMENT,
      EventType.END_DOCUMENT,
    ]);
    expect(await reader.next()).toEqual({ done: true, value: undefined });
  });

  it('yields each chunk’s events together in batches, and no empty batch', async () => {
    const batches: number[] = [];
    for await (const batch of xml.createAsyncEventReader(chunked('<a><b/><c/></a>', 4)).batches())
      batches.push(batch.length);
    expect(batches.every((n) => n > 0)).toBe(true);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it('gives one batch for a source that is all there', async () => {
    const batches: XMLEvent[][] = [];
    for await (const batch of xml.createAsyncEventReader(xml.createStreamReader('<a/>')).batches()) batches.push(batch);
    expect(batches.map((b) => b.length)).toEqual([4]);
  });

  it('applies filters per event, per batch and in streams', async () => {
    const onlyTags = (e: XMLEvent) => e.type === EventType.START_ELEMENT || e.type === EventType.END_ELEMENT;
    const doc = '<a><!--c--><b/></a>';
    const perEvent: string[] = [];
    for await (const event of xml.createAsyncEventReader(chunked(doc, 3)).addFilter(onlyTags))
      perEvent.push(summary(event));
    const perBatch: string[] = [];
    for await (const batch of xml.createAsyncEventReader(chunked(doc, 3)).addFilter(onlyTags).batches()) {
      perBatch.push(...batch.map((e) => summary(e)));
    }
    const streamed: string[] = [];
    for await (const event of xml.createAsyncEventReader(chunked(doc, 3)).addFilter(onlyTags).stream())
      streamed.push(summary(event));
    const expected = ['<a>', '<b>', '</b>', '</a>', 'end'];
    expect([perEvent, perBatch, streamed]).toEqual([expected, expected, expected]);
  });

  it('streams events as they come, across chunks', async () => {
    const events: string[] = [];
    for await (const event of xml.createEventStream(chunked(DOCUMENT, 1))) events.push(summary(event));
    expect(events).toEqual(SUMMARIES);
  });

  it('rejects with the reader’s error, per event, per batch and in streams', async () => {
    const bad = '<a><b></a>';
    const code = expect.objectContaining({ code: 'WF_END_TAG_MISMATCH' });
    await expect(
      (async () => {
        for await (const event of xml.createAsyncEventReader(chunked(bad, 2))) void event;
      })()
    ).rejects.toThrow(code);
    await expect(
      (async () => {
        for await (const batch of xml.createAsyncEventReader(chunked(bad, 2)).batches()) void batch;
      })()
    ).rejects.toThrow(code);
    await expect(
      (async () => {
        for await (const event of xml.createEventStream(chunked(bad, 2))) void event;
      })()
    ).rejects.toThrow(code);
  });

  it('reads a fed cursor as it is fed', async () => {
    const cursor = xml.createAsyncStreamReader();
    const reader = xml.createAsyncEventReader(cursor);
    const done = (async () => {
      const out: string[] = [];
      for await (const event of reader) out.push(summary(event));
      return out;
    })();
    cursor.feed(new TextEncoder().encode('<a>'));
    await Promise.resolve();
    cursor.feed(new TextEncoder().encode('t</a>'));
    cursor.endOfInput();
    expect(await done).toEqual(['start ', '<a>', '"t"', '</a>', 'end']);
  });

  it('is fed itself when created without a source, per event, per batch and in streams', async () => {
    /** Feeds a document in two chunks, letting the reader run between them. */
    const feedTo = async (reader: AsyncEventReader) => {
      reader.feed(new TextEncoder().encode('<a>'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      reader.feed(new TextEncoder().encode('t</a>'));
      reader.endOfInput();
    };
    const perEvent = xml.createAsyncEventReader();
    const events = (async () => {
      const out: string[] = [];
      for await (const event of perEvent) out.push(summary(event));
      return out;
    })();
    await feedTo(perEvent);
    const perBatch = xml.createAsyncEventReader();
    const batches = (async () => {
      const out: string[] = [];
      for await (const batch of perBatch.batches()) out.push(...batch.map((e) => summary(e)));
      return out;
    })();
    await feedTo(perBatch);
    const streamed = xml.createAsyncEventReader();
    const stream = (async () => {
      const out: string[] = [];
      for await (const event of streamed.stream()) out.push(summary(event));
      return out;
    })();
    await feedTo(streamed);
    const expected = ['start ', '<a>', '"t"', '</a>', 'end'];
    expect(await Promise.all([events, batches, stream])).toEqual([expected, expected, expected]);
  });

  it('can be fed only when created without a source', () => {
    const reader = xml.createAsyncEventReader(xml.createStreamReader('<a/>'));
    const refusal = 'Only an asynchronous reader created without a source can be fed';
    expect(() => reader.feed(new Uint8Array(0))).toThrow(refusal);
    expect(() => reader.endOfInput()).toThrow(refusal);
  });
});
