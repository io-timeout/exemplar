import type { Encoder } from './encoders.ts';
import type { ByteSink, Sink } from './sinks.ts';

/** How much text the writer gathers before handing it to the sink. */
const CHUNK_LENGTH = 65_536;

/** Gathers written text and hands it to a sink in chunks, encoding it for a byte sink. */
export class Output {
  /** The sink, when it takes text; otherwise `#byteSink` is set. */
  readonly #textSink: Sink | undefined;
  readonly #byteSink: ByteSink | undefined;
  readonly #encoder: Encoder;
  /** The text written since the last flush, and its length. */
  readonly #parts: string[] = [];
  #length = 0;
  /** How much text has been written in all, flushed or not. */
  #writtenLength = 0;
  /** Whether bytes have been handed on, after which no byte order mark is written. */
  #wroteBytes = false;

  constructor(sink: Sink | ByteSink, encoder: Encoder) {
    if ('writeBytes' in sink) this.#byteSink = sink;
    else this.#textSink = sink;
    this.#encoder = encoder;
  }

  /** Whether the output is encoded to bytes, rather than handed on as text. */
  get isEncoded(): boolean {
    return this.#byteSink !== undefined;
  }

  /** How much text has been written in all, which tells whether anything was written since a moment noted. */
  get writtenLength(): number {
    return this.#writtenLength;
  }

  /** Adds text, handing it on once a chunk has gathered. */
  write(text: string): void {
    this.#parts.push(text);
    this.#length += text.length;
    this.#writtenLength += text.length;
    if (this.#length >= CHUNK_LENGTH) this.flush();
  }

  /** Hands what has gathered to the sink, encoded for a byte sink. */
  flush(): void {
    if (this.#parts.length === 0) return;
    const text = this.#parts.join('');
    this.#parts.length = 0;
    this.#length = 0;
    if (this.#textSink !== undefined) {
      this.#textSink.write(text);
      return;
    }
    const byteSink = this.#byteSink as ByteSink;
    if (!this.#wroteBytes && this.#encoder.byteOrderMark !== undefined)
      byteSink.writeBytes(this.#encoder.byteOrderMark);
    this.#wroteBytes = true;
    byteSink.writeBytes(this.#encoder.encode(text));
  }

  /** Resolves when the sink has room for more; at once for a sink that never fills. */
  async drain(): Promise<void> {
    await (this.#textSink ?? this.#byteSink)?.ready?.();
  }

  /** Flushes and closes the sink. */
  close(): void | Promise<void> {
    this.flush();
    return (this.#textSink ?? this.#byteSink)?.close?.();
  }
}
