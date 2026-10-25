import type { EventType } from './event-type.ts';
import type { DTD_COMPLETE, EVENT_OFFSET, INPUT_ENCODING, XML_ENCODING } from './internal.ts';
import type { StreamReader as Cursor } from './stream-reader.ts';

/** The members only an asynchronous reader has. */
type AsyncMembers = 'fill' | 'feed' | 'endOfInput' | 'nextTagAsync' | 'elementTextAsync' | 'forEachEvent';

/** The getters other exemplar packages read, left out as `Omit` drops their `@internal` tags. */
type InternalGetters = typeof DTD_COMPLETE | typeof EVENT_OFFSET | typeof INPUT_ENCODING | typeof XML_ENCODING;

/** A pull reader over input that arrives over time: `next()` returns NEED_INPUT when it has to wait for `fill()`. */
export interface AsyncStreamReader extends Cursor {
  /** Moves to the next event and returns its type; NEED_INPUT when it has to wait for `fill()`. */
  next(): EventType;
}

/** A pull reader over a document it has whole, following StAX's `XMLStreamReader`. */
export interface StreamReader extends Omit<Cursor, AsyncMembers | InternalGetters | 'next' | 'eventType'> {
  /** Moves to the next event and returns its type. */
  next(): Exclude<EventType, typeof EventType.NEED_INPUT>;
  /** The current event's type. */
  eventType(): Exclude<EventType, typeof EventType.NEED_INPUT>;
}
