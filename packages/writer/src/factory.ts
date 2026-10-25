import { encoderFor } from './encoders.ts';
import { EventWriter } from './event-writer.ts';
import { type OutputOptions, type ResolvedOutputOptions, resolveOutputOptions } from './options.ts';
import { type ByteSink, type Sink, WritableStreamSink } from './sinks.ts';
import { StreamWriter } from './stream-writer.ts';

/** Where a writer writes: a text sink, a byte sink, or a web stream of bytes. */
export type Destination = Sink | ByteSink | WritableStream<Uint8Array>;

/** Creates writers that share one configuration, as JAXP's `XMLOutputFactory` does. */
export class XMLOutputFactory {
  readonly options: ResolvedOutputOptions;

  constructor(options: OutputOptions = {}) {
    this.options = resolveOutputOptions(options);
  }

  /** Creates a stream writer; `encoding` overrides the factory's for this writer. */
  createStreamWriter(destination: Destination, options: { readonly encoding?: string } = {}): StreamWriter {
    const encoding = options.encoding ?? this.options.encoding;
    const sink = destination instanceof WritableStream ? new WritableStreamSink(destination) : destination;
    return new StreamWriter(sink, { ...this.options, encoding }, encoderFor(encoding));
  }

  /** Creates an event writer. */
  createEventWriter(destination: Destination, options: { readonly encoding?: string } = {}): EventWriter {
    return new EventWriter(this.createStreamWriter(destination, options));
  }
}
