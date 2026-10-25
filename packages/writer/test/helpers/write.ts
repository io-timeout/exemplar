import {
  BytesSink,
  type OutputOptions,
  type StreamWriter,
  StringSink,
  WriterError,
  XMLOutputFactory,
} from '@/index.ts';

/** Writes with a fresh string writer and returns the output. */
export function written(write: (w: StreamWriter) => void, options: OutputOptions = {}): string {
  const sink = new StringSink();
  const w = new XMLOutputFactory(options).createStreamWriter(sink);
  write(w);
  w.flush();
  return sink.toString();
}

/** Writes with a fresh byte writer in an encoding and returns the bytes. */
export function writtenBytes(write: (w: StreamWriter) => void, options: OutputOptions = {}): Uint8Array {
  const sink = new BytesSink();
  const w = new XMLOutputFactory(options).createStreamWriter(sink);
  write(w);
  w.flush();
  return sink.toBytes();
}

/** The error code a write throws, or `none`. */
export function codeOf(write: (w: StreamWriter) => void, options: OutputOptions = {}): string {
  try {
    written(write, options);
  } catch (error) {
    if (error instanceof WriterError) return error.code;
    throw error;
  }
  return 'none';
}

/** Writes the start of a root element, then whatever follows. */
export function inRoot(write: (w: StreamWriter) => void): (w: StreamWriter) => void {
  return (w) => {
    w.writeStartElement('r');
    write(w);
  };
}
