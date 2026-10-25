import { describe, expect, it } from 'vitest';
import { BytesSink, encoderFor } from '@/index.ts';
import { Output } from '@/output.ts';

describe('Output', () => {
  it('hands text to a sink once about 64 K characters gather, and the rest when flushed', () => {
    const chunks: string[] = [];
    const out = new Output({ write: (chunk) => chunks.push(chunk) }, encoderFor('UTF-8'));
    out.write('a'.repeat(40_000));
    expect(chunks).toEqual([]);
    out.write('b'.repeat(30_000));
    out.write('c');
    out.flush();
    out.flush();
    expect(chunks.map((chunk) => chunk.length)).toEqual([70_000, 1]);
    expect(out.isEncoded).toBe(false);
  });

  it('encodes each chunk for a byte sink, a byte order mark first when the encoding has one', () => {
    const sink = new BytesSink();
    const out = new Output(sink, encoderFor('UTF-16'));
    out.write('a');
    out.flush();
    out.write('b');
    out.flush();
    expect([...sink.toBytes()]).toEqual([0xfe, 0xff, 0, 0x61, 0, 0x62]);
    expect(out.isEncoded).toBe(true);
  });

  it('flushes and closes the sink when closed', async () => {
    const chunks: string[] = [];
    let closed = false;
    const sink = {
      write: (chunk: string) => chunks.push(chunk),
      close: () => {
        closed = true;
      },
    };
    const out = new Output(sink, encoderFor('UTF-8'));
    out.write('x');
    await out.close();
    expect([chunks, closed]).toEqual([['x'], true]);
  });
});
