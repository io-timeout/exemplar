/** @exemplarjs/xml/filters: filtered readers, following StAX's `StreamFilter` and `EventFilter`, and a forwarding delegate. */
import { ADD_FILTER } from '../cursor/internal.ts';
import type { AsyncStreamReader, StreamReader as PublicStreamReader } from '../cursor/readers.ts';
import { type StreamFilter, isReader } from '../cursor/stream-reader.ts';
import type { AsyncEventReader, EventFilter, EventReader } from '../events/event-reader.ts';

export type { StreamFilter } from '../cursor/stream-reader.ts';
export type { EventFilter } from '../events/event-reader.ts';
export { StreamReaderDelegate } from './delegate.ts';

/** Makes a reader report only the events a filter accepts; the filter runs inside the reader's own `next()`. */
export function createFilteredReader<T extends PublicStreamReader | AsyncStreamReader>(
  reader: T,
  filter: StreamFilter
): T;
export function createFilteredReader<T extends EventReader | AsyncEventReader>(reader: T, filter: EventFilter): T;
export function createFilteredReader(
  reader: PublicStreamReader | AsyncStreamReader | EventReader | AsyncEventReader,
  filter: StreamFilter | EventFilter
): PublicStreamReader | AsyncStreamReader | EventReader | AsyncEventReader {
  if (isReader(reader)) reader[ADD_FILTER](filter as StreamFilter);
  else reader.addFilter(filter as EventFilter);
  return reader;
}
