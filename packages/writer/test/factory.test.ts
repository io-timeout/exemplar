import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { BytesSink, EventWriter, type Sink, StreamWriter, StringSink, XMLOutputFactory } from '@/index.ts';

describe('XMLOutputFactory', () => {
  it('resolves its options once, with the defaults filled in', () => {
    const factory = new XMLOutputFactory({ indent: '  ' });
    expect(factory.options).toMatchObject({ indent: '  ', encoding: 'UTF-8', checkWellFormedness: true });
    expect(new XMLOutputFactory().options.version).toBe('1.0');
  });

  it('creates stream writers to a text sink', () => {
    const sink = new StringSink();
    const w = new XMLOutputFactory().createStreamWriter(sink);
    expect(w).toBeInstanceOf(StreamWriter);
    w.writeEmptyElement('a');
    w.flush();
    expect(sink.toString()).toBe('<a/>');
  });

  it('creates stream writers to any object with write, close being optional', () => {
    const chunks: string[] = [];
    const sink: Sink = { write: (chunk) => void chunks.push(chunk) };
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeEmptyElement('a');
    w.flush();
    expect(chunks).toEqual(['<a/>']);
  });

  it('encodes for a byte sink in the factory encoding, or the one given for this writer', () => {
    const factory = new XMLOutputFactory({ encoding: 'UTF-16LE' });
    const own = new BytesSink();
    const w = factory.createStreamWriter(own);
    w.writeEmptyElement('a');
    w.flush();
    expect([...own.toBytes()]).toEqual([0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0]);
    const given = new BytesSink();
    const v = factory.createStreamWriter(given, { encoding: 'ISO-8859-1' });
    v.writeStartDocument();
    v.writeEmptyElement('a');
    v.flush();
    expect(new TextDecoder('latin1').decode(given.toBytes())).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><a/>');
    expect(factory.options.encoding).toBe('UTF-16LE');
  });

  it('writes to a web WritableStream through a stream sink', async () => {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({ write: (chunk) => void chunks.push(chunk) });
    const w = new XMLOutputFactory().createStreamWriter(stream, { encoding: 'UTF-8' });
    w.writeEmptyElement('a');
    await w.close();
    expect(new TextDecoder().decode(chunks[0])).toBe('<a/>');
    expect(stream.locked).toBe(true);
  });

  it('throws a RangeError for an encoding it has no encoder for', () => {
    expect(() => new XMLOutputFactory({ encoding: 'UTF-32' }).createStreamWriter(new BytesSink())).toThrow(RangeError);
    expect(() => new XMLOutputFactory().createStreamWriter(new BytesSink(), { encoding: 'x-none' })).toThrow(
      RangeError
    );
  });

  it('creates event writers with the same options and the encoding given', () => {
    const sink = new BytesSink();
    const w = new XMLOutputFactory({ omitXMLDeclaration: true }).createEventWriter(sink, { encoding: 'US-ASCII' });
    expect(w).toBeInstanceOf(EventWriter);
    w.add(new XMLInputFactory().createEventReader('<?xml version="1.0"?><a>é</a>'));
    w.flush();
    expect(new TextDecoder().decode(sink.toBytes())).toBe('<a>&#233;</a>');
  });

  it('gives each writer state of its own', () => {
    const factory = new XMLOutputFactory();
    const one = new StringSink();
    const two = new StringSink();
    const a = factory.createStreamWriter(one);
    const b = factory.createStreamWriter(two);
    a.writeStartElement('a');
    b.writeEmptyElement('b');
    a.writeEndElement();
    a.flush();
    b.flush();
    expect([one.toString(), two.toString()]).toEqual(['<a/>', '<b/>']);
  });
});
