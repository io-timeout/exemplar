import type { AsyncOpenedSource, ChunkQueue } from '../input/source.ts';
import { ErrorFactory } from '../util/errors.ts';
import { EventType } from './event-type.ts';

/**
 * An asynchronous reader's input. The reader returns NEED_INPUT when the bytes it has run out; the
 * caller then awaits `fill()`, which waits for the next chunk of a stream or a resolver's answer, or
 * hands it the next chunk with `feed()`. A synchronous reader has all its input from the start and never waits.
 */
export class AsyncInput {
  /** The queue chunks arrive in, and how to fetch more; undefined for a synchronous reader. */
  readonly #asyncSource: AsyncOpenedSource | undefined;
  /** Whether the last event was NEED_INPUT and no input has come since, so asking again would loop for ever. */
  #starved = false;

  constructor(input: AsyncOpenedSource | undefined) {
    this.#asyncSource = input;
  }

  /** Waits for more input: a resolver's `pending` answer, the stream's next chunk, or the next `feed`. */
  async fill(pending: Promise<void> | undefined): Promise<void> {
    this.#starved = false;
    if (pending !== undefined) {
      await pending;
      return;
    }
    const input = this.#asyncSource;
    await (input?.pump === undefined ? input?.queue?.wait() : input.pump());
  }

  /** Takes the next chunk of bytes, for a reader created without a source. */
  feed(chunk: Uint8Array): void {
    this.#fedQueue().push(chunk);
    this.#starved = false;
  }

  /** Notes that no more input will come, for a reader created without a source; ending again is not new input. */
  end(): void {
    if (this.#fedQueue().end()) this.#starved = false;
  }

  /** The queue of a reader created without a source, which `feed` adds to; throws for any other reader. */
  #fedQueue(): ChunkQueue {
    const input = this.#asyncSource;
    if (input?.queue === undefined || input.pump !== undefined) {
      throw ErrorFactory.create(TypeError, 'Only an asynchronous reader created without a source can be fed');
    }
    return input.queue;
  }

  /** Returns NEED_INPUT; if asked again before any input has come, throws instead, as returning NEED_INPUT again would loop for ever. */
  needInput(): EventType {
    if (this.#starved) {
      throw ErrorFactory.create(
        Error,
        'The reader needs more input: await fill(), or feed it, before calling next() again'
      );
    }
    this.#starved = true;
    return EventType.NEED_INPUT;
  }
}
