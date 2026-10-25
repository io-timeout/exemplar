import { canonical } from '@test/helpers/canonical.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, XMLInputFactory, type XMLEvent } from '@exemplarjs/xml';
import { EventWriter, type OutputOptions, StringSink, WriterError, XMLOutputFactory } from '@/index.ts';

/** Copies a document through an event reader and an event writer; returns the output. */
function copied(xml: string, input: InputOptions = {}, output: OutputOptions = {}): string {
  const sink = new StringSink();
  const writer = new XMLOutputFactory(output).createEventWriter(sink);
  writer.add(new XMLInputFactory(input).createEventReader(xml));
  writer.flush();
  return sink.toString();
}

/** The events of a document, as an array. */
function eventsOf(xml: string, input: InputOptions = {}): XMLEvent[] {
  return [...new XMLInputFactory(input).createEventReader(xml)];
}

const NO_DECLARATION = { omitXMLDeclaration: true };

describe('EventWriter (XMLEventWriter)', () => {
  it('copies a document an event reader reads', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "E">]><r xmlns="urn:d" xmlns:p="urn:p" p:a="1">t&e;<![CDATA[c]]><!--x--><?pi d?><p:q/></r>';
    expect(canonical(copied(xml))).toBe(canonical(xml));
  });

  it('writes each kind of event as the stream writer would', () => {
    const xml =
      '<?xml version="1.0" standalone="yes"?><!DOCTYPE r><r a="1" xml:lang="en"><!--c--><?p d?>t<![CDATA[<c>]]><e/></r>';
    expect(copied(xml)).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE r><r a="1" xml:lang="en"><!--c--><?p d?>t<![CDATA[<c>]]><e/></r>'
    );
  });

  it('writes an XML declaration of version 1.0 for a document that has none', () => {
    expect(copied('<a/>')).toBe('<?xml version="1.0" encoding="UTF-8"?><a/>');
  });

  it('keeps the version of an XML 1.1 document, escaping for it', () => {
    expect(copied('<?xml version="1.1"?><a>&#x1;</a>')).toBe('<?xml version="1.1" encoding="UTF-8"?><a>&#1;</a>');
  });

  it('writes the namespaces each start tag declares, and the attributes in them', () => {
    expect(copied('<p:a xmlns:p="urn:p" xmlns="urn:d" p:x="1" y="2"><b/></p:a>', {}, NO_DECLARATION)).toBe(
      '<p:a xmlns:p="urn:p" xmlns="urn:d" p:x="1" y="2"><b/></p:a>'
    );
  });

  it('writes namespace declarations once when the reader also reports them as attributes', () => {
    expect(copied('<p:a xmlns:p="urn:p" xmlns="urn:d" x="1"/>', { namespacePrefixes: true }, NO_DECLARATION)).toBe(
      '<p:a xmlns:p="urn:p" xmlns="urn:d" x="1"/>'
    );
  });

  it('writes the expanded text of an entity, and nothing for its boundaries', () => {
    const xml = '<!DOCTYPE a [<!ENTITY t "text">]><a>&t;</a>';
    expect(copied(xml, { reportEntityBoundaries: true }, NO_DECLARATION)).toBe(
      '<!DOCTYPE a [<!ENTITY t "text">]><a>text</a>'
    );
    expect(eventsOf(xml, { reportEntityBoundaries: true }).map((e) => e.type)).toContain(EventType.START_ENTITY);
  });

  it('writes entity references the reader does not replace', () => {
    expect(copied('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', { replaceEntityReferences: false }, NO_DECLARATION)).toBe(
      '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'
    );
  });

  it('writes whitespace outside the root element the reader reports', () => {
    expect(copied('<?xml version="1.0"?>\n<!--c-->\n<a/>\n', { reportPrologWhitespace: true }, NO_DECLARATION)).toBe(
      '\n<!--c-->\n<a/>\n'
    );
  });

  it('writes whitespace in element content the same as text', () => {
    expect(copied('<a>\n  <b/>\n</a>', {}, NO_DECLARATION)).toBe('<a>\n  <b/>\n</a>');
  });

  it('takes events one at a time, and a filtering loop copies what it keeps', () => {
    const sink = new StringSink();
    const writer = new XMLOutputFactory(NO_DECLARATION).createEventWriter(sink);
    for (const event of new XMLInputFactory().createEventReader('<a><!--drop-->t<?p?></a>')) {
      if (event.type !== EventType.COMMENT) writer.add(event);
    }
    writer.flush();
    expect(sink.toString()).toBe('<a>t<?p?></a>');
  });

  it('ends the document at END_DOCUMENT, handing everything to the sink', () => {
    const sink = new StringSink();
    const writer = new XMLOutputFactory(NO_DECLARATION).createEventWriter(sink);
    writer.add(new XMLInputFactory().createEventReader('<a>t</a>'));
    expect(sink.toString()).toBe('<a>t</a>');
  });

  it('copies an async event reader, a chunk of events at a time', async () => {
    const bytes = new TextEncoder().encode('<a x="1"><b>text</b><!--c--></a>');
    const stream = async function* () {
      for (let i = 0; i < bytes.length; i += 4) yield bytes.subarray(i, i + 4);
    };
    const sink = new StringSink();
    const writer = new XMLOutputFactory(NO_DECLARATION).createEventWriter(sink);
    await writer.addAsync(new XMLInputFactory().createAsyncEventReader(stream()));
    expect(sink.toString()).toBe('<a x="1"><b>text</b><!--c--></a>');
  });

  it('waits for the destination to have room after each batch of an async copy', async () => {
    const bytes = new TextEncoder().encode('<a x="1"><b>text</b><!--c--></a>');
    const stream = async function* () {
      for (let i = 0; i < bytes.length; i += 4) yield bytes.subarray(i, i + 4);
    };
    let waits = 0;
    const chunks: string[] = [];
    const writer = new XMLOutputFactory(NO_DECLARATION).createEventWriter({
      write: (chunk) => void chunks.push(chunk),
      ready: async () => void waits++,
    });
    await writer.addAsync(new XMLInputFactory().createAsyncEventReader(stream()));
    await writer.drain();
    writer.flush();
    expect(chunks.join('')).toBe('<a x="1"><b>text</b><!--c--></a>');
    expect(waits).toBeGreaterThan(1);
  });

  it('flushes and closes the sink', async () => {
    const seen: string[] = [];
    const writer = new XMLOutputFactory().createEventWriter({
      write: (chunk) => void seen.push(chunk),
      close: () => void seen.push('closed'),
    });
    const [start, element] = eventsOf('<a/>');
    writer.add(element as XMLEvent);
    expect(start?.type).toBe(EventType.START_DOCUMENT);
    writer.flush();
    expect(seen).toEqual(['<a>']);
    await writer.close();
    expect(seen).toEqual(['<a>', 'closed']);
  });

  it('can be built on any stream writer', () => {
    const sink = new StringSink();
    const writer = new EventWriter(new XMLOutputFactory({ indent: ' ' }).createStreamWriter(sink));
    writer.add(new XMLInputFactory().createEventReader('<a><b/></a>'));
    expect(sink.toString()).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<a>\n <b/>\n</a>');
  });

  it('copies a document read without namespaces when the writer is not namespace-aware either', () => {
    const xml = '<!DOCTYPE p:a [<!ENTITY e:f "x">]><p:a xmlns:p="u" q:x="1"><:c/><?p:i d?>&e:f;</p:a>';
    const input = { namespaceAware: false, replaceEntityReferences: false };
    const out = copied(xml, input, { ...NO_DECLARATION, namespaceAware: false });
    expect(out).toBe(xml);
    expect(canonical(out, { namespaceAware: false })).toBe(canonical(xml, { namespaceAware: false }));
  });

  it('refuses events that would not be well-formed where they are put', () => {
    const writer = new XMLOutputFactory().createEventWriter(new StringSink());
    const [, a, end] = eventsOf('<a/>');
    writer.add(a as XMLEvent);
    writer.add(end as XMLEvent);
    expect(() => writer.add(a as XMLEvent)).toThrow(WriterError);
  });
});
