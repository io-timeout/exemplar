import { canonicalOf, write, writeEvent } from '@test/helpers/canonical.ts';
import {
  type AsyncStreamReader,
  EventType,
  type InputOptions,
  type Source,
  type StreamReader,
  XMLError,
  XMLInputFactory,
} from '@/index.ts';
import { CREATE_READER, type StreamReader as Cursor } from '@/internal.ts';

/** The chunk sizes `parseEveryWay` feeds bytes in. */
const CHUNK_SIZES = [1, 2, 3, 7, 64];

/** Creates a reader typed as `@exemplarjs/xml/internal` has it, with the members exemplar's own packages read. */
export function cursor(source: Source, options: InputOptions = {}): Cursor {
  return new XMLInputFactory(options)[CREATE_READER](source, {}, false);
}

/** Creates a reader over a source with the given options. */
export function reader(source: Source, options: InputOptions = {}): StreamReader {
  return new XMLInputFactory(options).createStreamReader(source);
}

/** Returns a document's canonical form, or throws the XMLError it raises. */
export function canonical(source: Source, options: InputOptions = {}): string {
  return canonicalOf(reader(source, options));
}

/** Splits bytes into chunks of one size. */
function* chunks(bytes: Uint8Array, size: number): Generator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** Feeds bytes to an async reader a chunk at a time, reading what each chunk completes; returns the canonical form. */
function fed(bytes: Uint8Array, size: number, options: InputOptions): string {
  const r = new XMLInputFactory(options).createAsyncStreamReader();
  let out = '';
  let at = 0;
  for (let event = r.next(); event !== EventType.END_DOCUMENT; event = r.next()) {
    if (event !== EventType.NEED_INPUT) out += write(r, event);
    else if (at < bytes.length) {
      r.feed(bytes.subarray(at, at + size));
      at += size;
    } else r.endOfInput();
  }
  return out;
}

/** Reads a document as event objects; returns the canonical form. */
function events(source: Source, options: InputOptions): string {
  let out = '';
  for (const event of new XMLInputFactory(options).createEventReader(source)) out += writeEvent(event);
  return out;
}

/** What one way of reading gave: the canonical form, or the error's code and location. */
function outcome(read: () => string): { summary: string; error?: XMLError } {
  try {
    return { summary: `accepted ${read()}` };
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    return { summary: `rejected ${error.code} at ${error.line}:${error.column}`, error };
  }
}

/**
 * Parses a document as a string, as UTF-8 bytes, in chunks, fed to an async reader and as events; all must agree.
 * Returns the canonical form or throws the XMLError.
 */
export function parseEveryWay(xml: string, options: InputOptions = {}): string {
  const bytes = new TextEncoder().encode(xml);
  const first = outcome(() => canonical(xml, options));
  const ways: [string, () => string][] = [
    ['bytes', () => canonical(bytes, options)],
    ...CHUNK_SIZES.map((size): [string, () => string] => [
      `chunks of ${size}`,
      () => canonical(chunks(bytes, size), options),
    ]),
    ...[1, 7].map((size): [string, () => string] => [`fed in chunks of ${size}`, () => fed(bytes, size, options)]),
    ['events', () => events(bytes, options)],
  ];
  for (const [way, read] of ways) {
    const { summary } = outcome(read);
    if (summary !== first.summary) throw new Error(`As ${way}: ${summary}, but as a string: ${first.summary}`);
  }
  if (first.error) throw first.error;
  return first.summary.slice('accepted '.length);
}

/** Describes one event with everything the accessors give for it, and where it starts. */
export function describeEvent(r: StreamReader | AsyncStreamReader, event: EventType): string {
  const { line, column, systemId = '' } = r.location();
  const at = `${event}@${line}:${column}${systemId}`;
  switch (event) {
    case EventType.START_ELEMENT: {
      const attributes = Array.from(
        { length: r.attributeCount() },
        (_, i) =>
          ` ${r.attributeName(i)}{${r.attributeNamespace(i)}}${r.attributeType(i)}${r.isAttributeSpecified(i) ? '' : '?'}=${JSON.stringify(r.attributeValue(i))}`
      );
      return `${at} <${r.name()}{${r.namespaceURI()}}${namespacesOf(r)}${attributes.join('')}>`;
    }
    case EventType.END_ELEMENT: {
      return `${at} </${r.name()}{${r.namespaceURI()}}${namespacesOf(r)}>`;
    }
    case EventType.CHARACTERS:
    case EventType.SPACE:
    case EventType.CDATA:
    case EventType.COMMENT: {
      return `${at} ${JSON.stringify(r.text())}`;
    }
    case EventType.PROCESSING_INSTRUCTION: {
      return `${at} ${r.piTarget()} ${JSON.stringify(r.piData())}`;
    }
    case EventType.DTD: {
      return `${at} ${JSON.stringify(r.doctype())}`;
    }
    case EventType.ENTITY_REFERENCE: {
      return `${at} &${r.name()}; ${JSON.stringify(r.text())}`;
    }
    case EventType.START_ENTITY:
    case EventType.END_ENTITY: {
      return `${at} ${r.name()}`;
    }
    default: {
      return at;
    }
  }
}

/** The namespace declarations of a start or end tag, as ` xmlns:p=uri`. */
function namespacesOf(r: StreamReader | AsyncStreamReader): string {
  return Array.from(
    { length: r.namespaceCount() },
    (_, i) => ` xmlns:${r.namespacePrefix(i)}=${r.namespaceURI(i)}`
  ).join('');
}

/** Every event a reader gives, described, then its error's code and location if it fails. */
function describedEvents(next: (out: string[]) => EventType | undefined): string[] {
  const out: string[] = [];
  try {
    while (next(out) !== EventType.END_DOCUMENT);
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    out.push(`${error.code} at ${error.line}:${error.column}`);
  }
  return out;
}

/** Reads bytes with the synchronous reader from the given chunks; describes every event. */
function eventsFrom(chunked: Iterable<Uint8Array>, options: InputOptions): string[] {
  let r: StreamReader | undefined;
  return describedEvents((out) => {
    r ??= reader(chunked, options);
    const event = r.next();
    if (event !== EventType.END_DOCUMENT) out.push(describeEvent(r, event));
    return event;
  });
}

/** Feeds bytes to an async reader a chunk at a time; describes every event but START_DOCUMENT, as the sync reader starts on it. */
function eventsFed(bytes: Uint8Array, size: number, options: InputOptions): string[] {
  const r = new XMLInputFactory(options).createAsyncStreamReader();
  let at = 0;
  return describedEvents((out) => {
    const event = r.next();
    if (event === EventType.NEED_INPUT) {
      if (at < bytes.length) r.feed(bytes.subarray(at, (at += size)));
      else r.endOfInput();
    } else if (event !== EventType.END_DOCUMENT && event !== EventType.START_DOCUMENT)
      out.push(describeEvent(r, event));
    return event;
  });
}

/**
 * Reads a document's UTF-8 bytes whole, in chunks, split in two at every offset, and fed to an async reader;
 * every event, its details and its location must agree. Returns the events, with the error last if it fails.
 */
export function eventsEveryWay(xml: string, options: InputOptions = {}): string[] {
  const bytes = new TextEncoder().encode(xml);
  const first = eventsFrom([bytes], options);
  const ways: [string, () => string[]][] = [
    ...CHUNK_SIZES.map((size): [string, () => string[]] => [
      `chunks of ${size}`,
      () => eventsFrom(chunks(bytes, size), options),
    ]),
    ...[1, 7].map((size): [string, () => string[]] => [
      `fed in chunks of ${size}`,
      () => eventsFed(bytes, size, options),
    ]),
  ];
  for (let at = 1; at < bytes.length; at++) ways.push([`split at ${at}`, () => eventsFrom(halves(bytes, at), options)]);
  for (const [way, read] of ways) {
    const got = read();
    const differs = got.findIndex((event, i) => event !== first[i]);
    if (differs !== -1 || got.length !== first.length) {
      const i = differs === -1 ? Math.min(got.length, first.length) : differs;
      throw new Error(`As ${way}, event ${i} is ${got[i]}, but read whole it is ${first[i]}`);
    }
  }
  return first;
}

/** Returns the XMLError a document raises, read every way. */
export function errorOf(xml: string, options: InputOptions = {}): XMLError {
  try {
    parseEveryWay(xml, options);
  } catch (error) {
    if (error instanceof XMLError) return error;
    throw error;
  }
  throw new Error('The document was accepted');
}

/** Splits bytes in two at one offset. */
function* halves(bytes: Uint8Array, at: number): Generator<Uint8Array> {
  yield bytes.subarray(0, at);
  yield bytes.subarray(at);
}

/**
 * Parses a document's UTF-8 bytes split in two at every offset, as the synchronous and the fed reader read them;
 * all must agree with the string. Returns the canonical form or throws the XMLError.
 */
export function parseAtEverySplit(xml: string, options: InputOptions = {}): string {
  const bytes = new TextEncoder().encode(xml);
  const first = outcome(() => canonical(xml, options));
  for (let at = 1; at < bytes.length; at++) {
    const split = outcome(() => canonical(halves(bytes, at), options)).summary;
    const fedSplit = outcome(() => fedAt(bytes, at, options)).summary;
    for (const [way, summary] of [
      ['bytes', split],
      ['fed', fedSplit],
    ]) {
      if (summary !== first.summary)
        throw new Error(`As ${way} split at ${at}: ${summary}, but as a string: ${first.summary}`);
    }
  }
  if (first.error) throw first.error;
  return first.summary.slice('accepted '.length);
}

/** Feeds bytes to an async reader in two chunks split at one offset; returns the canonical form. */
function fedAt(bytes: Uint8Array, at: number, options: InputOptions): string {
  const r = new XMLInputFactory(options).createAsyncStreamReader();
  const pieces = [...halves(bytes, at)];
  let out = '';
  for (let event = r.next(); event !== EventType.END_DOCUMENT; event = r.next()) {
    if (event !== EventType.NEED_INPUT) out += write(r, event);
    else if (pieces.length > 0) r.feed(pieces.shift() as Uint8Array);
    else r.endOfInput();
  }
  return out;
}

/** A web stream of bytes in chunks of one size. */
function byteStream(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(at, at + size));
      at += size;
    },
  });
}

/** An async iterable of bytes in chunks of one size. */
// eslint-disable-next-line require-await -- an async source with nothing to await, so the reader takes its asynchronous path
async function* byteIterable(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** What one way of reading asynchronously gave: the canonical form, or the error's code and location. */
async function outcomeAsync(read: () => Promise<string>): Promise<string> {
  try {
    return `accepted ${await read()}`;
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    return `rejected ${error.code} at ${error.line}:${error.column}`;
  }
}

/** Reads an asynchronous cursor to its end, awaiting input; returns the canonical form. */
async function cursorAsync(source: Source, options: InputOptions): Promise<string> {
  const r = new XMLInputFactory(options).createAsyncStreamReader(source);
  let out = '';
  for (let event = r.next(); event !== EventType.END_DOCUMENT; event = r.next()) {
    if (event === EventType.NEED_INPUT) await r.fill();
    else out += write(r, event);
  }
  return out;
}

/**
 * Reads a document asynchronously from streams and async iterables, with the cursor and as event objects; all must
 * agree with the synchronous reader. Returns `accepted <canonical form>` or `rejected <code> at <line>:<column>`.
 */
export async function parseAsyncEveryWay(xml: string, options: InputOptions = {}): Promise<string> {
  const bytes = new TextEncoder().encode(xml);
  const first = outcome(() => canonical(xml, options)).summary;
  const factory = new XMLInputFactory(options);
  const ways: [string, () => Promise<string>][] = [];
  for (const size of [1, 5, 4096]) {
    ways.push(
      [`a stream in chunks of ${size}`, () => cursorAsync(byteStream(bytes, size), options)],
      [`an async iterable in chunks of ${size}`, () => cursorAsync(byteIterable(bytes, size), options)]
    );
  }
  ways.push(
    [
      'async events',
      async () => {
        let out = '';
        for await (const event of factory.createAsyncEventReader(byteStream(bytes, 3))) out += writeEvent(event);
        return out;
      },
    ],
    [
      'batches of events',
      async () => {
        let out = '';
        for await (const batch of factory.createAsyncEventReader(byteIterable(bytes, 3)).batches()) {
          for (const event of batch) out += writeEvent(event);
        }
        return out;
      },
    ],
    [
      'a stream of events',
      async () => {
        let out = '';
        for await (const event of factory.createEventStream(byteStream(bytes, 2))) out += writeEvent(event);
        return out;
      },
    ]
  );
  for (const [way, read] of ways) {
    const summary = await outcomeAsync(read);
    if (summary !== first) throw new Error(`As ${way}: ${summary}, but synchronously: ${first}`);
  }
  return first;
}
