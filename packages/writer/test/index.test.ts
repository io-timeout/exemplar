import { describe, expect, it } from 'vitest';
import * as writer from '@/index.ts';

describe('@exemplarjs/writer', () => {
  it('exports the factory, the writers, the sinks, the encoder lookup and the error, and nothing else at run time', () => {
    expect(Object.keys(writer).toSorted()).toEqual([
      'BytesSink',
      'EventWriter',
      'StreamWriter',
      'StringSink',
      'WritableStreamSink',
      'WriterError',
      'XMLOutputFactory',
      'encoderFor',
    ]);
  });
});
