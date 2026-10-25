import { canonicalOfAsync } from '@test/helpers/canonical.ts';
import { bytes, framed, join, split, utf16, utf8, verdict } from '@test/helpers/lexical.ts';
import { canonical, errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { DecodeError } from '@/encodings/decoders.ts';
import { XMLInputFactory } from '@/index.ts';
import { type Decoder, DecoderRegistry } from '@/input/decoders.ts';
import {
  type Chunk,
  ChunkQueue,
  CountedSource,
  DecodingFailureError,
  PENDING,
  type TextSource,
  UnsupportedEncodingError,
  openAsyncSource,
  openSource,
  readStream,
  stringSource,
} from '@/input/source.ts';
import type { Source } from '@/input/source.ts';

const registry = new DecoderRegistry();
const BOM = bytes(0xef, 0xbb, 0xbf);

/** Everything a text source gives until its end, PENDING as null, or the error that stops it. */
function drain(text: TextSource): (string | null | Error)[] {
  const out: (string | null | Error)[] = [];
  try {
    for (let chunk = text.read(); chunk !== undefined; chunk = text.read()) out.push(chunk === PENDING ? null : chunk);
  } catch (error) {
    out.push(error as Error);
  }
  return out;
}

/** The text a source decodes to, joined, and the code of the error that stops it. */
function decoded(source: Source, decoders = registry): string {
  const parts = drain(openSource(source, decoders).text);
  return parts.map((part) => (part instanceof Error ? `!${(part as DecodingFailureError).code}` : part)).join('');
}

/** An async iterable over chunks. */
async function* streamOf(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

/** A web stream over chunks. */
function webStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('errors', () => {
  it('reports bad bytes with the code for them', () => {
    const error = new DecodingFailureError('bad');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'DecodingFailureError', code: 'ENCODING_INVALID_BYTES', message: 'bad' });
  });

  it('names the encoding no decoder is registered for', () => {
    expect(new UnsupportedEncodingError('x-none')).toMatchObject({
      name: 'UnsupportedEncodingError',
      encoding: 'x-none',
      message: 'The encoding x-none is not supported',
    });
  });
});

describe('opening a source', () => {
  it('reads a string as one chunk of text, with nothing detected', () => {
    for (const text of [openSource('<a/>', registry).text, stringSource('<a/>')]) {
      expect(text.detection).toBeUndefined();
      expect(drain(text)).toEqual(['<a/>']);
    }
  });

  it('skips a U+FEFF that starts a string as a byte-order mark is skipped, and keeps any after it (§4.3.3)', () => {
    expect(drain(openSource('﻿<a/>', registry).text)).toEqual(['<a/>']);
    expect(drain(openSource({ text: '﻿﻿<a/>' }, registry).text)).toEqual(['﻿<a/>']);
  });

  it('keeps a U+FEFF that starts replacement text, which is not a document', () => {
    expect(drain(stringSource('﻿x'))).toEqual(['﻿x']);
  });

  it('reads bytes, an iterable of chunks and a generator alike', () => {
    const doc = utf8('<a>é</a>');
    expect(decoded(doc)).toBe('<a>é</a>');
    expect(decoded(split(doc, 1))).toBe('<a>é</a>');
    const generator = (function* () {
      yield* split(doc, 2);
    })();
    expect(drain(openSource(generator, registry).text).join('')).toBe('<a>é</a>');
  });

  it('reads a source object by its text, bytes or chunks, with where it came from', () => {
    const where = { systemId: 'a.xml', publicId: '-//A//EN', baseURI: 'http://x/' };
    const text = openSource({ ...where, text: '<a/>' }, registry);
    expect(text).toMatchObject(where);
    expect(drain(text.text)).toEqual(['<a/>']);
    const doc = utf8('<a/>');
    expect(decoded({ ...where, bytes: doc })).toBe('<a/>');
    expect(decoded({ chunks: split(doc, 1) })).toBe('<a/>');
  });

  it('leaves out where a source object came from when it does not say', () => {
    const opened = openSource({ text: '<a/>' }, registry);
    expect(Object.keys(opened)).toEqual(['text']);
  });

  it('decodes bytes with an encoding the source object supplies from outside', () => {
    const opened = openSource({ bytes: framed('<a>', [0xe9], '</a>'), encoding: 'Latin1' }, registry);
    expect(drain(opened.text).join('')).toBe('<a>é</a>');
    expect(opened.text.detection).toMatchObject({ external: 'iso-8859-1', decoderName: 'iso-8859-1' });
  });

  it('refuses an asynchronous source, and a source object with nothing to read', () => {
    expect(() => openSource(streamOf(), registry)).toThrow(TypeError);
    expect(() => openSource(webStream(), registry)).toThrow(TypeError);
    expect(() => openSource({ stream: webStream() }, registry)).toThrow(TypeError);
    expect(() => openSource({ systemId: 'a.xml' }, registry)).toThrow(TypeError);
  });
});

describe('reading bytes as text', () => {
  it('detects the encoding on the first read and strips the byte-order mark', () => {
    const text = openSource(join(bytes(0xef, 0xbb, 0xbf), utf8('<a/>')), registry).text;
    expect(text.detection).toBeUndefined();
    expect(text.read()).toBe('<a/>');
    expect(text.detection).toMatchObject({ byteOrderMark: 'utf-8', decoderName: 'utf-8' });
  });

  it('reads on until detection can decide, then gives everything read', () => {
    const doc = utf8('<?xml version="1.0" encoding="ISO-8859-1"?><a/>');
    const text = openSource(split(doc, 5), registry).text;
    const first = text.read() as string;
    expect(first.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
    expect(text.detection?.decoderName).toBe('iso-8859-1');
    expect(first + drain(text).join('')).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><a/>');
  });

  it('decodes a document shorter than four bytes, waiting for the end only while it may begin a wider form', () => {
    const waiting = openSource(utf8('<'), registry).text;
    expect(drain(waiting)).toEqual(['<']);
    const text = openSource(utf8('<a>'), registry).text;
    expect([text.read(), text.detection?.decoderName]).toEqual(['<a>', 'utf-8']);
  });

  it('gives the text before bad bytes first, then fails on every later read', () => {
    const text = openSource([utf8('<a>x'), bytes(0xff), utf8('</a>')], registry).text;
    expect(text.read()).toBe('<a>x');
    expect(text.read()).toBe('');
    expect(() => text.read()).toThrow(DecodingFailureError);
    expect(() => text.read()).toThrow(DecodingFailureError);
  });

  it('gives the UTF-8 text before bad bytes, including a character held back from an earlier chunk', () => {
    const third = join(bytes(0xaf), utf8('x'), bytes(0xc0), utf8('y'));
    expect(decoded([bytes(0xe8), bytes(0xaf), third])).toBe('误x!ENCODING_INVALID_BYTES');
    const second = bytes(0xaf, 0x78, 0xed, 0xa0, 0x80);
    expect(decoded([bytes(0xe8, 0xaf), second])).toBe('误x!ENCODING_INVALID_BYTES');
    expect(decoded([utf8('<a>'), bytes(0xf0, 0x9f), bytes(0x98)])).toBe('<a>!ENCODING_INVALID_BYTES');
  });

  it('decodes UTF-8 split anywhere across chunks', () => {
    const doc = utf8('<a>€𝄞é误</a>');
    for (let size = 1; size < 6; size++) expect(decoded(split(doc, size))).toBe('<a>€𝄞é误</a>');
  });

  it.each([
    ['a lone continuation byte', [0x80]],
    ['a lead byte the next does not continue', [0xc2, 0x41]],
    ['an overlong sequence', [0xc0, 0x80]],
    ['an overlong three-byte sequence', [0xe0, 0x80, 0x80]],
    ['an encoded surrogate', [0xed, 0xa0, 0x80]],
    ['a code point above U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
    ['a byte that never occurs', [0xf8]],
    ['a sequence cut short by the end', [0xe8, 0xaf]],
  ])('rejects %s in UTF-8, as Unicode §3.9 defines ill-formed', (_, bad) => {
    const doc = framed('<a>xy', bad);
    expect(decoded(doc)).toBe('<a>xy!ENCODING_INVALID_BYTES');
    expect(decoded(split(doc, 1))).toBe('<a>xy!ENCODING_INVALID_BYTES');
  });

  it('gives the text an exemplar decoder decoded before bad bytes', () => {
    const doc = framed('<?xml version="1.0" encoding="windows-1252"?><a>', [0x81]);
    expect(decoded(doc)).toBe('<?xml version="1.0" encoding="windows-1252"?><a>!ENCODING_INVALID_BYTES');
  });

  it('gives no text from a registered decoder that fails without saying what it decoded', () => {
    const failing = (): Decoder => ({
      decode: (data?: Uint8Array) => {
        if (data?.includes(0xff)) throw new TypeError('bad');
        return data ? String.fromCharCode(...data) : '';
      },
    });
    const doc = [utf8('<?xml version="1.0" encoding="x-failing"?><a>'), utf8('xy'), bytes(0x41, 0xff)];
    expect(decoded(doc, new DecoderRegistry({ 'x-failing': failing }))).toBe(
      '<?xml version="1.0" encoding="x-failing"?><a>xy!ENCODING_INVALID_BYTES'
    );
  });

  it('gives the well-formed UTF-8 text when a decoder registered for UTF-8 fails on it', () => {
    const picky = (): Decoder => ({
      decode: (data?: Uint8Array) => {
        if (data?.includes(0x7e)) throw new TypeError('no tildes');
        return data ? new TextDecoder().decode(data) : '';
      },
    });
    expect(decoded([utf8('<a>'), utf8('x~é</a>')], new DecoderRegistry({ 'utf-8': picky }))).toBe(
      '<a>x~é</a>!ENCODING_INVALID_BYTES'
    );
  });

  it('fails with UnsupportedEncodingError when no decoder is registered, or the factory fails', () => {
    const doc = utf8('<?xml version="1.0" encoding="x-none"?><a/>');
    expect(() => openSource(doc, registry).text.read()).toThrow(
      expect.objectContaining({ name: 'UnsupportedEncodingError', encoding: 'x-none' })
    );
    const broken = new DecoderRegistry({
      'x-none': () => {
        throw new RangeError('unavailable');
      },
    });
    expect(() => openSource(doc, broken).text.read()).toThrow(UnsupportedEncodingError);
  });

  it('turns a DecodeError into a failure on the next read', () => {
    const failing = (): Decoder => ({
      decode: () => {
        throw new DecodeError('x', 'partial');
      },
    });
    const text = openSource(utf8('<?xml version="1.0" encoding="x"?><a/>'), new DecoderRegistry({ x: failing })).text;
    expect(text.read()).toBe('partial');
    expect(() => text.read()).toThrow(DecodingFailureError);
  });
});

describe('ChunkQueue', () => {
  it('gives chunks in order, PENDING while empty, and undefined once ended and drained', () => {
    const queue = new ChunkQueue();
    expect(queue.next()).toBe(PENDING);
    const [a, b] = [bytes(1), bytes(2)];
    for (const chunk of [a, b]) queue.push(chunk);
    queue.end();
    expect([queue.next(), queue.next(), queue.next(), queue.next()]).toEqual([a, b, undefined, undefined]);
  });

  it('refuses a chunk after the end', () => {
    const queue = new ChunkQueue();
    queue.end();
    expect(() => queue.push(bytes(1))).toThrow('Input has already ended');
  });

  it('resolves a wait at once when a chunk or the end is there, and otherwise when one arrives', async () => {
    const queue = new ChunkQueue();
    let woken = 0;
    const waiting = queue.wait().then(() => woken++);
    await Promise.resolve();
    expect(woken).toBe(0);
    queue.push(bytes(1));
    await waiting;
    expect(woken).toBe(1);
    await queue.wait();
    queue.next();
    const ending = queue.wait();
    queue.end();
    await ending;
    await queue.wait();
  });
});

describe('streams', () => {
  it('reads a whole web stream or async iterable into one array', async () => {
    const web = webStream(bytes(1, 2), bytes(3));
    expect([...(await readStream(web))]).toEqual([1, 2, 3]);
    const iterable = streamOf(bytes(1), bytes(), bytes(2, 3));
    expect([...(await readStream(iterable))]).toEqual([1, 2, 3]);
    expect(await readStream(streamOf())).toHaveLength(0);
  });

  it('opens a reader to feed when there is no source', () => {
    const { opened, queue, pump } = openAsyncSource(undefined, registry);
    expect(pump).toBeUndefined();
    expect(opened.text.read()).toBe(PENDING);
    queue?.push(utf8('<a/>'));
    expect(opened.text.read()).toBe('<a/>');
    expect(opened.text.read()).toBe(PENDING);
    queue?.end();
    expect(drain(opened.text)).toEqual(['']);
  });

  it.each([
    ['an async iterable', () => streamOf(utf8('<a>'), utf8('</a>'))],
    ['a web stream', () => webStream(utf8('<a>'), utf8('</a>'))],
  ])('pumps %s into the queue a chunk per call', async (_, stream) => {
    const { opened, pump } = openAsyncSource(stream(), registry);
    const out: (string | null)[] = [];
    for (let chunk = opened.text.read(); chunk !== undefined; chunk = opened.text.read()) {
      if (chunk === PENDING) await pump?.();
      out.push(chunk === PENDING ? null : chunk);
    }
    expect(out.join('')).toBe('<a></a>');
    expect(out.filter((chunk) => chunk === null)).toHaveLength(3);
  });

  it('opens a source object with a stream, with where it came from and its encoding', async () => {
    const stream = streamOf(framed('<a>', [0xe9], '</a>'));
    const { opened, queue, pump } = openAsyncSource({ stream, systemId: 'a.xml', encoding: 'latin1' }, registry);
    expect(opened.systemId).toBe('a.xml');
    expect(queue).toBeDefined();
    await pump?.();
    await pump?.();
    expect(drain(opened.text).join('')).toBe('<a>é</a>');
    expect(opened.text.detection?.external).toBe('iso-8859-1');
  });

  it('opens anything the synchronous reader takes without a queue', () => {
    for (const source of ['<a/>', utf8('<a/>'), [utf8('<a/>')], { bytes: utf8('<a/>') }, { text: '<a/>' }]) {
      const { opened, queue, pump } = openAsyncSource(source, registry);
      expect(queue).toBeUndefined();
      expect(pump).toBeUndefined();
      expect(drain(opened.text).join('')).toBe('<a/>');
    }
  });
});

describe('sources through the readers', () => {
  it('reads a string, bytes, chunks and a source object alike', () => {
    const xml = '<a>é</a>';
    expect(canonical(xml)).toBe('<a>é</a>');
    expect(canonical(utf8(xml))).toBe('<a>é</a>');
    expect(canonical([utf8('<a>'), bytes(0xc3), bytes(0xa9), utf8('</a>')])).toBe('<a>é</a>');
    expect(canonical({ bytes: utf8(xml), systemId: 'a.xml' })).toBe('<a>é</a>');
  });

  it('does not report the byte-order mark as content', () => {
    const doc = join(BOM, utf8('<a/>'));
    expect(canonical(doc)).toBe('<a></a>');
  });

  it('keeps U+FEFF after the start as a character, in text and attribute values', () => {
    const doc = join(BOM, utf8('<a b="\uFEFF">\uFEFF</a>'));
    expect(verdict(doc)).toBe('accepted <a b="\uFEFF">\uFEFF</a>');
  });

  it('rejects a second byte-order mark as text before the root (§2.1, §4.3.3)', () => {
    const doc = join(BOM, utf8('\uFEFF<a/>'));
    expect(verdict(doc)).toBe('WF_CONTENT_OUTSIDE_ROOT 1:1');
  });

  it('skips a leading U+FEFF in a string as in its bytes, with the same locations (§4.3.3, Appendix F)', () => {
    expect(parseEveryWay('﻿<a/>')).toBe('<a></a>');
    expect(canonical({ text: '﻿<a/>', systemId: 'a.xml' })).toBe('<a></a>');
    const xml = '﻿<a>\n<b></a>';
    expect(errorOf(xml)).toMatchObject({ code: 'WF_END_TAG_MISMATCH', line: 2, column: 6, offset: 9 });
    expect(() => canonical(utf8(xml))).toThrow(expect.objectContaining({ line: 2, column: 6, offset: 9 }));
  });

  it('rejects a second U+FEFF at the start of a string as text before the root (§2.1, §4.3.3)', () => {
    expect(errorOf('﻿﻿<a/>')).toMatchObject({ code: 'WF_CONTENT_OUTSIDE_ROOT', line: 1, column: 1 });
  });

  it('rejects bytes that are not legal in the encoding, after the text before them', () => {
    const r = reader(framed('<a><b/>', [0xff], '</a>'));
    expect([r.next(), r.next(), r.next()]).toEqual([1, 1, 2]);
    expect(() => r.next()).toThrow(expect.objectContaining({ code: 'ENCODING_INVALID_BYTES', line: 1, column: 8 }));
  });

  it('reports the same first error however bytes with bad ones in them arrive', () => {
    const documents: [Uint8Array, string][] = [
      [join(utf16('<a>&</a>', false, true), bytes(0xd8, 0x00, 0x41)), 'WF_REFERENCE 1:4'],
      [framed('<a>', [0xc2], 'P</a>'), 'ENCODING_INVALID_BYTES 1:4'],
      [framed('<a>text \u0010 more', [0xb0], '</a>'), 'WF_INVALID_CHARACTER 1:9'],
      [framed('<a>', [0xc0]), 'ENCODING_INVALID_BYTES 1:4'],
      [framed('<r>', [0xe8], '</r>'), 'ENCODING_INVALID_BYTES 1:4'],
      [utf16('<a/>', true, true).subarray(0, -1), 'ENCODING_INVALID_BYTES 1:4'],
      [bytes(0xff), 'ENCODING_INVALID_BYTES 1:1'],
    ];
    for (const [doc, error] of documents) {
      expect(verdict(doc)).toBe(error);
      for (const size of [1, 2, 3, 7]) expect(verdict(split(doc, size)), `in chunks of ${size}`).toBe(error);
    }
  });

  it('rejects an encoding with no decoder at the start of the document', () => {
    expect(() => reader(utf8('<?xml version="1.0" encoding="EBCDIC-XYZ"?><a/>'))).toThrow(
      expect.objectContaining({ code: 'ENCODING_UNSUPPORTED', line: 1, column: 1 })
    );
  });

  it('uses a decoder the caller registers', () => {
    const latin1 = (): TextDecoder => new TextDecoder('latin1');
    const doc = framed('<?xml version="1.0" encoding="ISO-8859-1"?><a>', [0xe9], '</a>');
    expect(canonical(doc, { decoders: { 'iso-8859-1': latin1 } })).toBe('<a>é</a>');
  });

  it('refuses an asynchronous source in the synchronous reader', () => {
    expect(() => reader(streamOf(utf8('<a/>')))).toThrow(TypeError);
    expect(() => reader({ stream: webStream() })).toThrow(TypeError);
    expect(() => reader({ systemId: 'a.xml' })).toThrow(TypeError);
  });

  it('reads a web stream, an async iterable and a source object with a stream asynchronously', async () => {
    const factory = new XMLInputFactory();
    const read = (source: Source): Promise<string> => canonicalOfAsync(factory.createAsyncStreamReader(source));
    const doc = split(utf8('<a>é</a>'), 3);
    expect(await read(webStream(...doc))).toBe('<a>é</a>');
    expect(await read(streamOf(...doc))).toBe('<a>é</a>');
    expect(await read({ stream: streamOf(...doc), systemId: 's.xml' })).toBe('<a>é</a>');
  });

  it('gives the system id to errors', () => {
    expect(() => canonical({ text: '<a>', systemId: 'file:///a.xml' })).toThrow(
      expect.objectContaining({ systemId: 'file:///a.xml', code: 'WF_UNCLOSED_ELEMENT' })
    );
  });
});

describe('CountedSource', () => {
  it('reports the size of each chunk read and how much has been read, passing every chunk on', () => {
    const chunks: Chunk<string>[] = ['ab', PENDING, 'cde', undefined];
    const inner: TextSource = { read: () => chunks.shift(), detection: undefined };
    const counts: [number, number][] = [];
    const source = new CountedSource(inner, (size, length) => counts.push([size, length]));
    expect([source.read(), source.read(), source.read(), source.read()]).toEqual(['ab', PENDING, 'cde', undefined]);
    expect(counts).toEqual([
      [2, 2],
      [3, 5],
    ]);
  });
});
