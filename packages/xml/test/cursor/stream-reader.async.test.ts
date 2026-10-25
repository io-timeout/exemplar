import { describe, expect, it } from 'vitest';
import { createFilteredReader } from '@/filters/index.ts';
import {
  type AsyncStreamReader,
  EventType,
  type InputOptions,
  type Source,
  XMLError,
  XMLInputFactory,
} from '@/index.ts';

const encoder = new TextEncoder();

/** Reads an asynchronous cursor to its end, awaiting input; returns each event as type and name or text, and NEED for each wait. */
async function drive(reader: AsyncStreamReader): Promise<string[]> {
  const out: string[] = [];
  try {
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      if (e === EventType.NEED_INPUT) {
        out.push('NEED');
        await reader.fill();
        continue;
      }
      const named = e === EventType.START_ELEMENT || e === EventType.END_ELEMENT || e === EventType.ENTITY_REFERENCE;
      out.push(`${e} ${named ? reader.name() : reader.text()}`);
    }
  } catch (error) {
    out.push(
      error instanceof XMLError ? `error ${error.code} ${error.line}:${error.column}` : `thrown ${String(error)}`
    );
  }
  return out;
}

/** An asynchronous cursor over a source. */
function asyncReader(source: Source, options: InputOptions = {}): AsyncStreamReader {
  return new XMLInputFactory(options).createAsyncStreamReader(source);
}

describe('the asynchronous cursor (Aalto’s non-blocking reader)', () => {
  it('starts at NEED_INPUT and reports START_DOCUMENT from next()', async () => {
    const reader = asyncReader('<a/>');
    expect([reader.eventType(), reader.hasNext()]).toEqual([EventType.NEED_INPUT, true]);
    expect(await drive(reader)).toEqual(['7 ', '1 a', '2 a']);
  });

  it('returns NEED_INPUT until a fed chunk completes the XML declaration', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(encoder.encode('<?xml version="1.0" encod'));
    expect(reader.next()).toBe(EventType.NEED_INPUT);
    reader.feed(encoder.encode('ing="UTF-8"?><a/>'));
    expect([reader.next(), reader.encoding()]).toEqual([EventType.START_DOCUMENT, 'UTF-8']);
  });

  it('reports NEED_INPUT whenever a fed reader runs out of input, and the rest once fed', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    expect(reader.next()).toBe(EventType.NEED_INPUT);
    reader.feed(encoder.encode('<?xml version="1.0"?><a'));
    expect([reader.next(), reader.version(), reader.next()]).toEqual([
      EventType.START_DOCUMENT,
      '1.0',
      EventType.NEED_INPUT,
    ]);
    reader.feed(encoder.encode('/>'));
    expect([reader.next(), reader.next(), reader.next()]).toEqual([
      EventType.START_ELEMENT,
      EventType.END_ELEMENT,
      EventType.NEED_INPUT,
    ]);
    reader.endOfInput();
    expect(reader.next()).toBe(EventType.END_DOCUMENT);
  });

  it('can be fed empty chunks', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(new Uint8Array(0));
    reader.feed(encoder.encode('<a/>'));
    reader.feed(new Uint8Array(0));
    reader.endOfInput();
    const types: EventType[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) types.push(e);
    expect(types).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT, EventType.END_ELEMENT]);
  });

  it('reports a document that ends early when told no more input will come', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(encoder.encode('<a><b>'));
    reader.endOfInput();
    expect(() => {
      while (reader.next() !== EventType.END_DOCUMENT);
    }).toThrow(expect.objectContaining({ code: 'WF_UNCLOSED_ELEMENT' }));
  });

  it('waits for more input after an unfinished tag, failing only when told the input has ended', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(encoder.encode('<root><child/'));
    const seen: EventType[] = [];
    for (let e = reader.next(); e !== EventType.NEED_INPUT; e = reader.next()) seen.push(e);
    expect(seen).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT]);
    reader.endOfInput();
    expect(() => reader.next()).toThrow(expect.objectContaining({ code: 'WF_UNEXPECTED_END', line: 1, column: 13 }));
  });

  it('reads long tokens fed a byte at a time as single events', () => {
    const big = 'x'.repeat(16_384);
    const xml = `<r a="${big}"><![CDATA[${big}]]><!--${big}--><?p ${big}?>${big}</r>`;
    const reader = new XMLInputFactory().createAsyncStreamReader();
    const bytes = encoder.encode(xml);
    const lengths: number[] = [];
    for (let i = 0; i <= bytes.length; i++) {
      if (i < bytes.length) reader.feed(bytes.subarray(i, i + 1));
      else reader.endOfInput();
      for (let e = reader.next(); e !== EventType.NEED_INPUT && e !== EventType.END_DOCUMENT; e = reader.next()) {
        if (e === EventType.START_ELEMENT) lengths.push(reader.attributeValue(0).length);
        else if (e === EventType.PROCESSING_INSTRUCTION) lengths.push(reader.piData().length);
        else if (e !== EventType.START_DOCUMENT && e !== EventType.END_ELEMENT) lengths.push(reader.text().length);
      }
    }
    expect(lengths).toEqual([16_384, 16_384, 16_384, 16_384, 16_384]);
  });

  it('reports an error in a fed chunk as soon as the chunk shows it, without waiting for the end', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    reader.feed(encoder.encode('<r/><second>'));
    expect(() => {
      while (reader.next() !== EventType.NEED_INPUT);
    }).toThrow(expect.objectContaining({ code: 'WF_SECOND_ROOT', line: 1, column: 5 }));
  });

  it('refuses feed() and endOfInput() on a reader that reads a source, or a synchronous one', () => {
    const streaming = asyncReader(encoder.encode('<a/>'));
    expect(() => streaming.feed(new Uint8Array(1))).toThrow(TypeError);
    expect(() => streaming.endOfInput()).toThrow(TypeError);
    const sync = new XMLInputFactory().createStreamReader('<a/>');
    // @ts-expect-error -- a synchronous reader has no feed(), and refuses one called anyway
    expect(() => sync.feed(new Uint8Array(1))).toThrow(TypeError);
    // @ts-expect-error -- nor endOfInput()
    expect(() => sync.endOfInput()).toThrow('Only an asynchronous reader created without a source can be fed');
  });

  it('resolves fill() at once for a synchronous reader, which never waits', async () => {
    // @ts-expect-error -- a synchronous reader has no fill(); called anyway, it does not wait
    await expect(new XMLInputFactory().createStreamReader('<a/>').fill()).resolves.toBeUndefined();
  });

  it('runs filters only on events, never on NEED_INPUT, and always passes END_DOCUMENT', async () => {
    const seen: EventType[] = [];
    /** The document's bytes, two at a time. */
    async function* pairs() {
      const bytes = encoder.encode('<a><!--c--><b/></a>');
      for (let i = 0; i < bytes.length; i += 2) yield bytes.subarray(i, i + 2);
    }
    const reader = createFilteredReader(asyncReader(pairs()), (r) => {
      seen.push(r.eventType());
      return r.eventType() !== EventType.COMMENT;
    });
    const events = await drive(reader);
    expect(events.filter((e) => e !== 'NEED')).toEqual(['7 ', '1 a', '1 b', '2 b', '2 a']);
    expect(seen).not.toContain(EventType.NEED_INPUT);
    expect(seen).not.toContain(EventType.END_DOCUMENT);
  });

  it('gives the same error code and location as the synchronous reader', async () => {
    for (const xml of ['<a></b>', '<a>\n<b x="1" x="2"/></a>', '<a>&e;</a>', '<a/><!DOCTYPE a>']) {
      let expected = '';
      try {
        const sync = new XMLInputFactory().createStreamReader(xml);
        while (sync.next() !== EventType.END_DOCUMENT);
      } catch (error) {
        expected = `error ${(error as XMLError).code} ${(error as XMLError).line}:${(error as XMLError).column}`;
      }
      const bytes = encoder.encode(xml);
      const events = await drive(asyncReader(bytes));
      expect(events.at(-1)).toBe(expected);
    }
  });
});

/** A stream of the document's bytes, a few at a time, so that most tokens cross a chunk boundary. */
async function* trickle(xml: string, size = 3): AsyncGenerator<Uint8Array> {
  const bytes = encoder.encode(xml);
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

describe('waiting for input', () => {
  it('throws, rather than return NEED_INPUT for ever, when next() is called again without fill()', () => {
    const reader = asyncReader(trickle('<a/>'));
    expect(reader.next()).toBe(EventType.NEED_INPUT);
    expect(() => reader.next()).toThrow(
      'The reader needs more input: await fill(), or feed it, before calling next() again'
    );
  });

  it('counts a feed or the end of input as new input, as fill() is', () => {
    const reader = new XMLInputFactory().createAsyncStreamReader();
    expect(reader.next()).toBe(EventType.NEED_INPUT);
    reader.feed(encoder.encode('<a'));
    expect([reader.next(), reader.next()]).toEqual([EventType.START_DOCUMENT, EventType.NEED_INPUT]);
    reader.feed(new Uint8Array(0));
    expect(reader.next()).toBe(EventType.NEED_INPUT);
    reader.endOfInput();
    expect(() => reader.next()).toThrow('Unexpected end in a start tag');
  });

  it('throws when next() is called again while a resolver has yet to answer', () => {
    const reader = asyncReader('<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;</a>', {
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => new Promise(() => undefined) },
    });
    let event = reader.next();
    while (event !== EventType.NEED_INPUT) event = reader.next();
    expect(() => reader.next()).toThrow('await fill()');
  });

  it('does not count the end of input again as new input', () => {
    const reader = new XMLInputFactory({
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => new Promise(() => undefined) },
    }).createAsyncStreamReader();
    reader.feed(encoder.encode('<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;</a>'));
    reader.endOfInput();
    let event = reader.next();
    while (event !== EventType.NEED_INPUT) event = reader.next();
    reader.endOfInput();
    expect(() => reader.next()).toThrow('await fill()');
  });

  it('reads through a document a few bytes at a time with fill() between', async () => {
    const reader = asyncReader(trickle('<a>xy<b/></a>'));
    expect(await drive(reader)).toEqual(expect.arrayContaining(['1 a', '1 b', '2 b', '2 a']));
  });
});

describe('nextTagAsync and elementTextAsync', () => {
  const XML = '<doc>\n  <!-- c -->\n  <title>Dune &amp; <![CDATA[Children]]></title>\n  <year>1976</year>\n</doc>';

  it('read across chunk boundaries what nextTag and elementText read from a whole document', async () => {
    const whole = new XMLInputFactory().createStreamReader(XML);
    const expected = [whole.nextTag(), whole.name(), whole.nextTag(), whole.name(), whole.elementText()];
    const reader = asyncReader(trickle(XML));
    const read = [
      await reader.nextTagAsync(),
      reader.name(),
      await reader.nextTagAsync(),
      reader.name(),
      await reader.elementTextAsync(),
    ];
    expect(read).toEqual(expected);
    expect(read).toEqual([EventType.START_ELEMENT, 'doc', EventType.START_ELEMENT, 'title', 'Dune & Children']);
    expect([await reader.nextTagAsync(), reader.name(), await reader.elementTextAsync()]).toEqual([
      EventType.START_ELEMENT,
      'year',
      '1976',
    ]);
    expect([await reader.nextTagAsync(), reader.name()]).toEqual([EventType.END_ELEMENT, 'doc']);
  });

  it('fail as nextTag and elementText do on content they cannot skip or keep', async () => {
    const text = asyncReader(trickle('<a>x<b/></a>'));
    await text.nextTagAsync();
    await expect(text.nextTagAsync()).rejects.toThrow('Expected a start or end tag');
    const child = asyncReader(trickle('<a>x<b/></a>'));
    await child.nextTagAsync();
    await expect(child.elementTextAsync()).rejects.toThrow('elementText() found a child element');
    const notStart = asyncReader('<a/>');
    await expect(notStart.elementTextAsync()).rejects.toThrow('elementTextAsync() needs a START_ELEMENT');
  });

  it('are what nextTag and elementText name when an asynchronous reader has to wait', async () => {
    const tag = asyncReader(trickle('<a> <b/></a>'));
    await tag.nextTagAsync();
    expect(() => tag.nextTag()).toThrow(
      'nextTag() cannot wait for input; use nextTagAsync() with an asynchronous reader'
    );
    const text = asyncReader(trickle('<a>some text</a>'));
    await text.nextTagAsync();
    expect(() => text.elementText()).toThrow(
      'elementText() cannot wait for input; use elementTextAsync() with an asynchronous reader'
    );
  });
});

describe('forEachEvent', () => {
  it('calls back for every event, START_DOCUMENT to END_DOCUMENT, awaiting input between', async () => {
    const reader = asyncReader(trickle('<a x="1">t<b/></a>'));
    const seen: string[] = [];
    await reader.forEachEvent((type, r) => {
      seen.push(type === EventType.START_ELEMENT ? `${type} ${r.name()} ${r.attributeCount()}` : String(type));
    });
    expect(seen).toEqual(['7', '1 a 1', '4', '1 b 0', '2', '2', '8']);
    expect(reader.hasNext()).toBe(false);
  });

  it('goes on from the current event, and stops with what the callback throws', async () => {
    const reader = asyncReader(trickle('<a><b/><c/></a>'));
    await reader.nextTagAsync();
    const names: string[] = [];
    const stop = new Error('stop');
    await expect(
      reader.forEachEvent((type, r) => {
        if (type !== EventType.START_ELEMENT) return;
        names.push(r.name());
        if (r.name() === 'c') throw stop;
      })
    ).rejects.toBe(stop);
    expect(names).toEqual(['b', 'c']);
  });

  it('rejects with the error that ends the document', async () => {
    const reader = asyncReader(trickle('<a></b>'));
    await expect(reader.forEachEvent(() => undefined)).rejects.toMatchObject({ code: 'WF_END_TAG_MISMATCH' });
  });
});

describe('resolvers in the asynchronous cursor', () => {
  const ENTITY = '<!DOCTYPE a [<!ENTITY x SYSTEM "x.xml">]>';

  /** Options whose resolver answers every request with what `answer` gives. */
  const resolving = (answer: () => unknown): InputOptions => ({
    accessExternalDTD: 'all',
    accessExternalEntities: 'all',
    entityResolver: { resolveEntity: answer as never },
  });

  it('waits for a promise, then expands what it gives', async () => {
    const options = resolving(() => Promise.resolve({ text: '<b/>' }));
    expect(await drive(asyncReader(`${ENTITY}<a>&x;&x;</a>`, options))).toEqual([
      '7 ',
      `11 ${ENTITY}`,
      '1 a',
      'NEED',
      '1 b',
      '2 b',
      '1 b',
      '2 b',
      '2 a',
    ]);
  });

  it('uses a resolver that answers at once without waiting', async () => {
    const options = resolving(() => ({ text: '<b/>' }));
    expect(await drive(asyncReader(`${ENTITY}<a>&x;</a>`, options))).not.toContain('NEED');
  });

  it('reads a stream a resolver answers with in full', async () => {
    /** A web stream of an element's bytes, one at a time. */
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of encoder.encode('<b>streamed</b>')) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      });
    const options = resolving(() => ({ stream: stream() }));
    expect(await drive(asyncReader(`${ENTITY}<a>&x;</a>`, options))).toEqual([
      '7 ',
      `11 ${ENTITY}`,
      '1 a',
      'NEED',
      '1 b',
      '4 streamed',
      '2 b',
      '2 a',
    ]);
  });

  it('reports a skipped entity when the promise gives nothing, inside an internal entity too', async () => {
    const options = resolving(() => Promise.resolve(undefined));
    const xml = '<!DOCTYPE a [<!ENTITY i "[&x;]"><!ENTITY x SYSTEM "x.xml">]><a>&i;</a>';
    const events = await drive(asyncReader(xml, options));
    expect(events.slice(2)).toEqual(['1 a', '4 [', 'NEED', '9 x', '4 ]', '2 a']);
  });

  it('throws what a rejected promise failed with, at the reference', async () => {
    const options = resolving(() => Promise.reject(new RangeError('refused')));
    const inContent = await drive(asyncReader(`${ENTITY}<a>&x;</a>`, options));
    const inDtd = await drive(asyncReader('<!DOCTYPE a SYSTEM "a.dtd"><a/>', options));
    expect([inContent.at(-1), inDtd.at(-1)]).toEqual(['thrown RangeError: refused', 'thrown RangeError: refused']);
  });

  it('reads the DTD again after each answer, reporting its recoverable errors once', async () => {
    const errors: string[] = [];
    const options: InputOptions = {
      ...resolving(() => Promise.resolve({ text: '<!ELEMENT a ANY>' })),
      errorHandler: { error: (e) => errors.push(e.code) },
    };
    const xml = '<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY % p SYSTEM "p.ent">%undeclared;%p;]><a/>';
    const events = await drive(asyncReader(xml, options));
    expect(events.filter((e) => e === 'NEED')).toHaveLength(2);
    expect(errors).toEqual(['VC_ENTITY_DECLARED']);
  });

  it('reports the held-back recoverable errors before a fatal error in the DTD', async () => {
    const heard: string[] = [];
    const options: InputOptions = {
      ...resolving(() => Promise.resolve({ text: '<!ELEMENT a ANY><!BAD>' })),
      errorHandler: { error: (e) => heard.push(`error ${e.code}`), fatalError: (e) => heard.push(`fatal ${e.code}`) },
    };
    const result = await drive(asyncReader('<!DOCTYPE a SYSTEM "a.dtd" [%u;]><a/>', options));
    expect(heard).toEqual(['error VC_ENTITY_DECLARED', 'fatal WF_DECLARATION']);
    expect(result.at(-1)).toMatch(/^error WF_DECLARATION/);
  });
});
