/** Where a writer's output goes, as text in chunks. */
export interface Sink {
  write(chunk: string): void;
  /** Resolves when the sink has room for more; a sink that never fills need not have it. */
  ready?(): Promise<void>;
  close?(): void | Promise<void>;
}

/** Where a writer's encoded output goes, in byte chunks. */
export interface ByteSink {
  writeBytes(chunk: Uint8Array): void;
  /** Resolves when the sink has room for more; a sink that never fills need not have it. */
  ready?(): Promise<void>;
  close?(): void | Promise<void>;
}

/** Collects text; `toString()` joins it. */
export class StringSink implements Sink {
  readonly #chunks: string[] = [];

  write(chunk: string): void {
    this.#chunks.push(chunk);
  }

  toString(): string {
    return this.#chunks.join('');
  }
}

/** Collects bytes; `toBytes()` joins them. */
export class BytesSink implements ByteSink {
  readonly #chunks: Uint8Array[] = [];
  #length = 0;

  writeBytes(chunk: Uint8Array): void {
    this.#chunks.push(chunk);
    this.#length += chunk.length;
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(this.#length);
    let at = 0;
    for (const chunk of this.#chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return bytes;
  }
}

/** Writes byte chunks to a web `WritableStream`; `close()` waits for every write. */
export class WritableStreamSink implements ByteSink {
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  #failure: unknown;
  #failed = false;

  constructor(stream: WritableStream<Uint8Array>) {
    this.#writer = stream.getWriter();
  }

  writeBytes(chunk: Uint8Array): void {
    if (this.#failed) throw this.#failure;
    this.#writer.write(chunk).catch((error: unknown) => {
      this.#failed = true;
      this.#failure = error;
    });
  }

  /** Resolves when the stream has room for more, as its writer's `ready` does; rejects once a write has failed. */
  async ready(): Promise<void> {
    if (this.#failed) throw this.#failure;
    await this.#writer.ready;
  }

  async close(): Promise<void> {
    await this.#writer.close();
    if (this.#failed) throw this.#failure;
  }
}
