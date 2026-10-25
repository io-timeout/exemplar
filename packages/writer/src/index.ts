/** @exemplarjs/writer: the stream and event writers, following StAX, and their sinks. */
export { type Encoder, encoderFor } from './encoders.ts';
export { WriterError } from './error.ts';
export { EventWriter } from './event-writer.ts';
export { type Destination, XMLOutputFactory } from './factory.ts';
export type { OutputOptions, ResolvedOutputOptions } from './options.ts';
export { type ByteSink, BytesSink, type Sink, StringSink, WritableStreamSink } from './sinks.ts';
export type { WritableNode } from './node.ts';
export { StreamWriter } from './stream-writer.ts';
