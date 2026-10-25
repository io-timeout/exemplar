import { ErrorFactory } from '../util/errors.ts';
import { EventType, isCharacterData } from './event-type.ts';

/** The part of a reader the navigation helpers use. */
interface Navigable {
  next(): EventType;
  eventType(): EventType;
  fill(): Promise<void>;
  text(): string;
  isWhitespace(): boolean;
}

/** Skips whitespace, comments and PIs to the next start or end tag. */
export function nextTag(reader: Navigable): EventType {
  for (;;) {
    const event = reader.next();
    if (event === EventType.START_ELEMENT || event === EventType.END_ELEMENT) return event;
    passOver(reader, event, 'nextTag');
  }
}

/** Like `nextTag()`, awaiting input when an asynchronous reader needs it. */
export async function nextTagAsync(reader: Navigable): Promise<EventType> {
  for (;;) {
    const event = reader.next();
    if (event === EventType.START_ELEMENT || event === EventType.END_ELEMENT) return event;
    if (event === EventType.NEED_INPUT) await reader.fill();
    else passOver(reader, event, 'nextTag');
  }
}

/** Checks that `nextTag()` may skip an event: whitespace, a comment, a PI, or an async reader's START_DOCUMENT. */
function passOver(reader: Navigable, event: EventType, method: string): void {
  if (event === EventType.NEED_INPUT) throw cannotWait(method);
  const skippable =
    event === EventType.START_DOCUMENT ||
    event === EventType.COMMENT ||
    event === EventType.PROCESSING_INSTRUCTION ||
    event === EventType.SPACE ||
    (event === EventType.CHARACTERS && reader.isWhitespace());
  if (!skippable) throw ErrorFactory.create(Error, 'Expected a start or end tag');
}

/** Reads a text-only element's text and stops at its end tag. */
export function elementText(reader: Navigable): string {
  if (reader.eventType() !== EventType.START_ELEMENT)
    throw ErrorFactory.create(Error, 'elementText() needs a START_ELEMENT');
  let text = '';
  for (;;) {
    const event = reader.next();
    if (event === EventType.END_ELEMENT) return text;
    if (event === EventType.NEED_INPUT) throw cannotWait('elementText');
    text += elementTextPart(reader, event);
  }
}

/** Like `elementText()`, awaiting input when an asynchronous reader needs it. */
export async function elementTextAsync(reader: Navigable): Promise<string> {
  if (reader.eventType() !== EventType.START_ELEMENT)
    throw ErrorFactory.create(Error, 'elementTextAsync() needs a START_ELEMENT');
  let text = '';
  for (;;) {
    const event = reader.next();
    if (event === EventType.END_ELEMENT) return text;
    if (event === EventType.NEED_INPUT) await reader.fill();
    else text += elementTextPart(reader, event);
  }
}

/** The text an event inside a text-only element adds; a child element fails. */
function elementTextPart(reader: Navigable, event: EventType): string {
  if (event === EventType.START_ELEMENT) throw ErrorFactory.create(Error, 'elementText() found a child element');
  if (isCharacterData(event)) return reader.text();
  return '';
}

/** The error a synchronous helper throws when the reader has to wait for input. */
function cannotWait(method: string): Error {
  return ErrorFactory.create(
    Error,
    `${method}() cannot wait for input; use ${method}Async() with an asynchronous reader`
  );
}

/** Calls `handle` for each event to the end of the document, awaiting input as it is needed. */
export async function forEachEvent<R extends Navigable>(
  reader: R,
  handle: (type: Exclude<EventType, typeof EventType.NEED_INPUT>, reader: R) => void
): Promise<void> {
  for (let type = reader.next(); ; type = reader.next()) {
    if (type === EventType.NEED_INPUT) {
      await reader.fill();
      continue;
    }
    handle(type, reader);
    if (type === EventType.END_DOCUMENT) return;
  }
}
