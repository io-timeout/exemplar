import { bytes, hex } from '@test/helpers/bytes.ts';
import {
  type AsyncStreamReader,
  EventType,
  type Source,
  type StreamReader,
  XMLError,
  XMLInputFactory,
} from '@exemplarjs/xml';
import { cjkDecoders } from '@/index.ts';

/** A factory with the CJK decoders registered. */
export const cjkFactory = new XMLInputFactory({ decoders: cjkDecoders });

/** A document's events as text: start tags with their attributes, text, and end tags. */
export function eventsOf(reader: StreamReader): string[] {
  const out: string[] = [];
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    out.push(...eventsAt(reader, event));
  }
  return out;
}

/** Reads a source with the CJK decoders; returns its events. */
export function read(source: Source, factory = cjkFactory): string[] {
  return eventsOf(factory.createStreamReader(source));
}

/** Feeds bytes to an async reader one at a time; returns its events. */
export function readFed(data: Uint8Array, factory = cjkFactory): string[] {
  const reader = factory.createAsyncStreamReader();
  const out: string[] = [];
  let at = 0;
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event !== EventType.NEED_INPUT) out.push(...eventsAt(reader, event));
    else if (at < data.length) reader.feed(data.subarray(at, ++at));
    else reader.endOfInput();
  }
  return out;
}

/** What one event writes: a start tag with its attributes, an end tag, or text. */
function eventsAt(reader: StreamReader | AsyncStreamReader, event: EventType): string[] {
  if (event === EventType.START_ELEMENT) {
    const attributes = Array.from(
      { length: reader.attributeCount() },
      (_, i) => ` ${reader.attributeName(i)}=${reader.attributeValue(i)}`
    );
    return [`<${reader.name()}${attributes.join('')}>`];
  }
  if (event === EventType.END_ELEMENT) return [`</${reader.name()}>`];
  return event === EventType.CHARACTERS || event === EventType.CDATA ? [reader.text()] : [];
}

/** The XMLError reading a source raises. */
export function errorOf(source: Source, factory = cjkFactory): XMLError {
  try {
    read(source, factory);
  } catch (error) {
    if (error instanceof XMLError) return error;
    throw error;
  }
  throw new Error('The document was read without an error');
}

/** A document declaring an encoding, with a root element named in it, one attribute and text, all given in hex. */
export function documentIn(encoding: string, name: string, value: string, text: string): Uint8Array {
  return bytes(
    `<?xml version="1.0" encoding="${encoding}"?>\n<`,
    hex(name),
    ' a="',
    hex(value),
    '">',
    hex(text),
    '</',
    hex(name),
    '>'
  );
}
