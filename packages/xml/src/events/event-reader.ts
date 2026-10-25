import { EventType } from '../cursor/event-type.ts';
import type { AsyncStreamReader, StreamReader as PublicStreamReader } from '../cursor/readers.ts';
import type { StreamReader } from '../cursor/stream-reader.ts';
import { ErrorFactory } from '../util/errors.ts';
import { isAllWhitespace } from '../util/whitespace.ts';
import { EventBuilder, type XMLEvent } from './events.ts';

/** Decides whether a filtered event reader yields an event, as StAX's `EventFilter` does. */
export type EventFilter = (event: XMLEvent) => boolean;

/** Whether every filter accepts an event; END_DOCUMENT always passes. */
function accepts(filters: readonly EventFilter[], event: XMLEvent): boolean {
  if (filters.length === 0 || event.type === EventType.END_DOCUMENT) return true;
  for (const accept of filters) if (!accept(event)) return false;
  return true;
}

/** The cursor's first event: a sync reader starts at START_DOCUMENT, an async one has to read to it. */
function firstEvent(reader: StreamReader): EventType {
  const type = reader.eventType();
  return type === EventType.NEED_INPUT ? reader.next() : type;
}

/** Whether `nextTag()` may skip an event: whitespace, a comment or a PI, and START_DOCUMENT too, which the cursor's `nextTag()` also moves past. */
function nextTagMaySkip(event: XMLEvent): boolean {
  if (event.type === EventType.CHARACTERS) return isAllWhitespace(event.text);
  return (
    event.type === EventType.COMMENT ||
    event.type === EventType.PROCESSING_INSTRUCTION ||
    event.type === EventType.SPACE ||
    event.type === EventType.START_DOCUMENT
  );
}

/** Reads a cursor's events as objects, one at a time, skipping those the filters reject; both event readers use it. */
class EventPump {
  readonly reader: StreamReader;
  readonly filters: EventFilter[] = [];
  readonly #builder = new EventBuilder();
  /** Whether the cursor's first event has been read. */
  #readFirstEvent = false;
  /** Whether END_DOCUMENT has been read, after which there are no more events. */
  ended = false;

  constructor(reader: StreamReader) {
    this.reader = reader;
  }

  /** The next event that passes the filters, if the input buffered so far holds one; undefined when the cursor needs input or has ended. */
  poll(): XMLEvent | undefined {
    const reader = this.reader;
    while (!this.ended) {
      let type: EventType;
      if (this.#readFirstEvent) {
        type = reader.next();
      } else {
        type = firstEvent(reader);
        this.#readFirstEvent = type !== EventType.NEED_INPUT;
      }
      if (type === EventType.NEED_INPUT) return undefined;
      if (type === EventType.END_DOCUMENT) this.ended = true;
      const event = this.#builder.build(reader, type);
      if (accepts(this.filters, event)) return event;
    }
    return undefined;
  }
}

/**
 * Reads a document as event objects, following StAX's `XMLEventReader`. Each event is an object of
 * its own that stays valid after the reader moves on, unlike the cursor's accessors, which describe
 * only the current event. It reads through a cursor, and is its own iterator:
 * `for (const event of reader)` visits every event.
 */
export class EventReader implements IterableIterator<XMLEvent> {
  readonly #pump: EventPump;
  #peeked: XMLEvent | undefined;

  constructor(reader: PublicStreamReader) {
    this.#pump = new EventPump(reader as StreamReader);
  }

  [Symbol.iterator](): this {
    return this;
  }

  /** The iterator protocol's next: the next event, or done after END_DOCUMENT. */
  next(): IteratorResult<XMLEvent, undefined> {
    const event = this.#take();
    return event === undefined ? { done: true, value: undefined } : { done: false, value: event };
  }

  /** Whether there is another event. */
  hasNext(): boolean {
    return this.peek() !== undefined;
  }

  /** The next event; throws after END_DOCUMENT. */
  nextEvent(): XMLEvent {
    const event = this.#take();
    if (event === undefined) throw ErrorFactory.create(Error, 'There are no more events');
    return event;
  }

  /** The next event without consuming it, or undefined after END_DOCUMENT. */
  peek(): XMLEvent | undefined {
    this.#peeked ??= this.#readNext();
    return this.#peeked;
  }

  /** Skips whitespace, comments and PIs to the next start or end tag. */
  nextTag(): XMLEvent {
    for (;;) {
      const event = this.nextEvent();
      if (event.type === EventType.START_ELEMENT || event.type === EventType.END_ELEMENT) return event;
      if (!nextTagMaySkip(event)) throw ErrorFactory.create(Error, 'Expected a start or end tag');
    }
  }

  /** After a START_ELEMENT, reads a text-only element's text and consumes its end tag. */
  elementText(): string {
    let text = '';
    for (;;) {
      const event = this.nextEvent();
      if (event.type === EventType.END_ELEMENT) return text;
      if (event.type === EventType.START_ELEMENT)
        throw ErrorFactory.create(Error, 'elementText() found a child element');
      if (event.type === EventType.CHARACTERS || event.type === EventType.CDATA || event.type === EventType.SPACE) {
        text += event.text;
      }
    }
  }

  /** Adds a filter that every event must pass; END_DOCUMENT always passes. */
  addFilter(filter: EventFilter): this {
    this.#pump.filters.push(filter);
    return this;
  }

  /** The next event, the one `peek()` read if it read one; undefined after END_DOCUMENT. */
  #take(): XMLEvent | undefined {
    const event = this.#peeked ?? this.#readNext();
    this.#peeked = undefined;
    return event;
  }

  /** Reads the next event that passes the filters; an asynchronous cursor that runs out of input is an error here. */
  #readNext(): XMLEvent | undefined {
    const event = this.#pump.poll();
    if (event === undefined && !this.#pump.ended) {
      throw ErrorFactory.create(Error, 'An asynchronous reader needs an asynchronous event reader');
    }
    return event;
  }
}

/**
 * Reads a document as event objects from an asynchronous cursor, waiting for input as it is needed.
 * It is an async iterator, `for await (const event of reader)`, and also gives the events in
 * batches, one per chunk of input, or as a web stream.
 */
export class AsyncEventReader implements AsyncIterableIterator<XMLEvent> {
  readonly #pump: EventPump;

  constructor(reader: PublicStreamReader | AsyncStreamReader) {
    this.#pump = new EventPump(reader as StreamReader);
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  /** Gives a reader created without a source its next chunk of bytes, as the fed cursor's `feed` does. */
  feed(chunk: Uint8Array): void {
    this.#pump.reader.feed(chunk);
  }

  /** Tells a reader created without a source that no more input will come. */
  endOfInput(): void {
    this.#pump.reader.endOfInput();
  }

  /** The next event, awaiting input when the cursor needs it; a promise per event. */
  async next(): Promise<IteratorResult<XMLEvent, undefined>> {
    const pump = this.#pump;
    for (;;) {
      const event = pump.poll();
      if (event !== undefined) return { done: false, value: event };
      if (pump.ended) return { done: true, value: undefined };
      await pump.reader.fill();
    }
  }

  /** Yields the events each chunk of input completes, as an array; a promise per chunk. */
  async *batches(): AsyncGenerator<XMLEvent[], void, undefined> {
    const pump = this.#pump;
    while (!pump.ended) {
      const batch: XMLEvent[] = [];
      for (let event = pump.poll(); event !== undefined; event = pump.poll()) batch.push(event);
      if (batch.length > 0) yield batch;
      if (!pump.ended) await pump.reader.fill();
    }
  }

  /** A web stream of the events. */
  stream(): ReadableStream<XMLEvent> {
    const pump = this.#pump;
    // Whether the last pull stopped where the cursor needs input, which the next must wait for first.
    let starved = false;
    return new ReadableStream<XMLEvent>({
      pull: async (controller) => {
        for (;;) {
          if (starved) await pump.reader.fill();
          let pushed = false;
          for (let event = pump.poll(); event !== undefined; event = pump.poll()) {
            controller.enqueue(event);
            pushed = true;
          }
          if (pump.ended) {
            controller.close();
            return;
          }
          starved = true;
          if (pushed) return;
        }
      },
    });
  }

  /** Adds a filter that every event must pass; END_DOCUMENT always passes. */
  addFilter(filter: EventFilter): this {
    this.#pump.filters.push(filter);
    return this;
  }
}
