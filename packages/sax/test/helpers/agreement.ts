import { canonicalHandler, canonicalOf, namesHandler, namesOf } from '@test/helpers/canonical.ts';
import { type InputOptions, type Source, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { SAXParser } from '@/index.ts';

/** A document as text or bytes, with an optional system id, and an encoding given from outside as HTTP gives one. */
export interface Document {
  readonly xml: string | Uint8Array;
  readonly systemId?: string;
  readonly encoding?: string;
}

/** The chunk sizes SAX is fed bytes in asynchronously. */
const CHUNK_SIZES = [1, 7];

const ENCODER = new TextEncoder();

/** Splits bytes into chunks of one size, yielded asynchronously. */
// eslint-disable-next-line require-await -- an async source with nothing to await, so the reader takes its asynchronous path
async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** The system id and encoding a document carries, as source object fields. */
function about(doc: Document): { systemId?: string; encoding?: string } {
  return {
    ...(doc.systemId !== undefined && { systemId: doc.systemId }),
    ...(doc.encoding !== undefined && { encoding: doc.encoding }),
  };
}

/** A document given as a string or bytes, as a source. */
function sourceOf(doc: Document, content: string | Uint8Array = doc.xml): Source {
  if (doc.systemId === undefined && doc.encoding === undefined) return content;
  return typeof content === 'string' ? { ...about(doc), text: content } : { ...about(doc), bytes: content };
}

/** A document's bytes in chunks, as a source for `parseAsync`. */
function streamOf(doc: Document, bytes: Uint8Array, size: number): Source {
  const stream = chunks(bytes, size);
  return doc.systemId === undefined && doc.encoding === undefined ? stream : { ...about(doc), stream };
}

/** What reading gave: `accepted` and the output, or `rejected` and the error's code and location. */
function outcome(read: () => string): string {
  try {
    return `accepted ${read()}`;
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    return `rejected ${error.code} at ${error.line}:${error.column}`;
  }
}

/** `outcome` for asynchronous reading. */
async function outcomeAsync(read: () => Promise<string>): Promise<string> {
  try {
    return `accepted ${await read()}`;
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    return `rejected ${error.code} at ${error.line}:${error.column}`;
  }
}

/** Reads a document with SAX into the canonical form. */
function saxCanonical(source: Source, options: InputOptions): string {
  const { handler, written } = canonicalHandler();
  new SAXParser(new XMLInputFactory(options)).parse(source, handler);
  return written();
}

/** Reads a document with SAX's `parseAsync` into the canonical form. */
async function saxCanonicalAsync(source: Source, options: InputOptions): Promise<string> {
  const { handler, written } = canonicalHandler();
  await new SAXParser(new XMLInputFactory(options)).parseAsync(source, handler);
  return written();
}

/** Every way SAX reads a document: as given, and as bytes fed in chunks unless the text has lone surrogates. */
function saxWays(doc: Document, options: InputOptions): [string, () => Promise<string>][] {
  const ways: [string, () => Promise<string>][] = [
    ['SAX', () => Promise.resolve(outcome(() => saxCanonical(sourceOf(doc), options)))],
    ['SAX async', () => outcomeAsync(() => saxCanonicalAsync(sourceOf(doc), options))],
  ];
  if (typeof doc.xml === 'string' && !doc.xml.isWellFormed()) return ways;
  const bytes = typeof doc.xml === 'string' ? ENCODER.encode(doc.xml) : doc.xml;
  for (const size of CHUNK_SIZES) {
    ways.push([
      `SAX async in chunks of ${size}`,
      () => outcomeAsync(() => saxCanonicalAsync(streamOf(doc, bytes, size), options)),
    ]);
  }
  if (typeof doc.xml === 'string') {
    ways.push(['SAX as bytes', () => Promise.resolve(outcome(() => saxCanonical(sourceOf(doc, bytes), options)))]);
  }
  return ways;
}

/** Reads a document with the cursor and every way with SAX; all must agree. Returns the cursor's outcome. */
export async function agreed(doc: Document | string, options: InputOptions = {}): Promise<string> {
  const d = typeof doc === 'string' ? { xml: doc } : doc;
  const cursor = outcome(() => canonicalOf(new XMLInputFactory(options).createStreamReader(sourceOf(d))));
  for (const [way, read] of saxWays(d, options)) {
    const result = await read();
    if (result !== cursor) throw new Error(`${way} gave ${result}, but the cursor ${cursor}`);
  }
  return cursor;
}

/** Reads a well-formed document every way; returns its canonical form. */
export async function readEveryWay(doc: Document | string, options: InputOptions = {}): Promise<string> {
  const result = await agreed(doc, options);
  if (!result.startsWith('accepted ')) throw new Error(`The document was ${result}`);
  return result.slice('accepted '.length);
}

/** Reads a malformed document every way; returns its error's code and location, as `CODE at line:column`. */
export async function errorEveryWay(doc: Document | string, options: InputOptions = {}): Promise<string> {
  const result = await agreed(doc, options);
  if (!result.startsWith('rejected ')) throw new Error(`The document was ${result}`);
  return result.slice('rejected '.length);
}

/** Reads a document's expanded names with the cursor and with SAX; both must agree. Returns them. */
export function namesEveryWay(doc: Document | string, options: InputOptions = {}): string[] {
  const d = typeof doc === 'string' ? { xml: doc } : doc;
  const cursor = namesOf(new XMLInputFactory(options).createStreamReader(sourceOf(d)));
  const { handler, names } = namesHandler();
  new SAXParser(new XMLInputFactory(options)).parse(sourceOf(d), handler);
  if (names.join(' ') !== cursor.join(' ')) {
    throw new Error(`SAX gave ${names.join(' ')}, but the cursor ${cursor.join(' ')}`);
  }
  return cursor;
}

/** Encodes text as UTF-16 code units in one byte order, with or without a byte order mark. */
export function utf16(text: string, littleEndian: boolean, bom = true): Uint8Array {
  const units = (bom ? '\uFEFF' : '') + text;
  const bytes = new Uint8Array(units.length * 2);
  const view = new DataView(bytes.buffer);
  // eslint-disable-next-line prefer-code-point -- UTF-16 is code units
  for (let i = 0; i < units.length; i++) view.setUint16(i * 2, units.charCodeAt(i), littleEndian);
  return bytes;
}

/** Encodes text one byte per character; every character must be below U+0100. */
export function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.codePointAt(0) as number);
}
