import { describe, expect, it } from 'vitest';
import { BytesSink, StringSink, WritableStreamSink } from '@/sinks.ts';

describe('StringSink', () => {
  it('joins the chunks it is given', () => {
    const sink = new StringSink();
    expect(sink.toString()).toBe('');
    sink.write('<a>');
    sink.write('');
    sink.write('</a>');
    expect(sink.toString()).toBe('<a></a>');
    expect(String(sink)).toBe('<a></a>');
  });
});

describe('BytesSink', () => {
  it('joins the byte chunks it is given', () => {
    const sink = new BytesSink();
    expect(sink.toBytes()).toEqual(new Uint8Array(0));
    sink.writeBytes(Uint8Array.of(1, 2));
    sink.writeBytes(new Uint8Array(0));
    sink.writeBytes(Uint8Array.of(3));
    expect(sink.toBytes()).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('gives a new array each time, which it does not share', () => {
    const sink = new BytesSink();
    sink.writeBytes(Uint8Array.of(1));
    const first = sink.toBytes();
    first[0] = 9;
    expect(sink.toBytes()).toEqual(Uint8Array.of(1));
  });
});

describe('WritableStreamSink', () => {
  it('writes each chunk to the stream and waits for them all on close', async () => {
    const chunks: number[][] = [];
    const stream = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await Promise.resolve();
        chunks.push([...chunk]);
      },
    });
    const sink = new WritableStreamSink(stream);
    sink.writeBytes(Uint8Array.of(1));
    sink.writeBytes(Uint8Array.of(2, 3));
    await sink.close();
    expect(chunks).toEqual([[1], [2, 3]]);
  });

  it('resolves ready() only once the stream has room, as its writer does', async () => {
    const releases: (() => void)[] = [];
    const stream = new WritableStream<Uint8Array>(
      { write: () => new Promise<void>((resolve) => void releases.push(resolve)) },
      { highWaterMark: 1 }
    );
    const sink = new WritableStreamSink(stream);
    await sink.ready();
    sink.writeBytes(Uint8Array.of(1));
    sink.writeBytes(Uint8Array.of(2));
    let ready = false;
    const waiting = sink.ready().then(() => (ready = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ready).toBe(false);
    while (!ready) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waiting;
    expect(ready).toBe(true);
  });

  it('rejects ready() with the error a write failed with', async () => {
    const failure = new Error('disk full');
    const stream = new WritableStream<Uint8Array>({
      write: () => {
        throw failure;
      },
    });
    const sink = new WritableStreamSink(stream);
    sink.writeBytes(Uint8Array.of(1));
    await expect(sink.ready()).rejects.toBe(failure);
    await expect(sink.ready()).rejects.toBe(failure);
  });

  it('locks the stream it writes to', () => {
    const stream = new WritableStream<Uint8Array>();
    void new WritableStreamSink(stream);
    expect(stream.locked).toBe(true);
  });

  it('rejects close with the error a write failed with', async () => {
    const failure = new Error('disk full');
    const stream = new WritableStream<Uint8Array>({
      write: () => {
        throw failure;
      },
    });
    const sink = new WritableStreamSink(stream);
    sink.writeBytes(Uint8Array.of(1));
    await expect(sink.close()).rejects.toBe(failure);
  });

  it('throws on a write after an earlier write failed', async () => {
    const failure = new Error('disk full');
    let fail = false;
    const stream = new WritableStream<Uint8Array>({
      write: () => {
        if (fail) throw failure;
      },
      close: () => {},
    });
    const sink = new WritableStreamSink(stream);
    fail = true;
    sink.writeBytes(Uint8Array.of(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => sink.writeBytes(Uint8Array.of(2))).toThrow(failure);
  });

  it('rejects close with a write failure even when the stream itself closes', async () => {
    const failure = new Error('lost');
    const stream = {
      getWriter: () => ({ write: () => Promise.reject(failure), close: () => Promise.resolve() }),
    } as unknown as WritableStream<Uint8Array>;
    const sink = new WritableStreamSink(stream);
    sink.writeBytes(Uint8Array.of(1));
    await expect(sink.close()).rejects.toBe(failure);
  });

  it('rejects close when the stream fails to close', async () => {
    const failure = new Error('cannot close');
    const stream = new WritableStream<Uint8Array>({
      close: () => {
        throw failure;
      },
    });
    await expect(new WritableStreamSink(stream).close()).rejects.toBe(failure);
  });
});
