import { tree } from '@test/helpers/c14n.ts';
import { describe, expect, it } from 'vitest';
import { StringSink, XMLOutputFactory } from '@exemplarjs/writer';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';
import { canonicalize } from '@/index.ts';

const DOCUMENTS = [
  '<?xml version="1.0"?>\n<!--c--><?p d?><r xmlns="urn:d" xmlns:p="urn:p" a="1&#9;2"><p:x p:b="&lt;&amp;"/>\r\n<![CDATA[t]]></r><?q?>',
  '<!DOCTYPE r [<!ATTLIST r d CDATA "x"><!ENTITY e "<i>e</i>">]><r>&e;&#xD;</r>',
  '<r xmlns:a="urn:a"><s xmlns:a="urn:b" xmlns="urn:c"><t xmlns=""/></s></r>',
];

/** Writes a DOM tree with the stream writer and returns the text. */
function written(xml: string): string {
  const sink = new StringSink();
  const writer = new XMLOutputFactory().createStreamWriter(sink);
  writer.writeNode(tree(xml));
  writer.flush();
  return sink.toString();
}

/** Copies a document event by event through the event writer and returns the text. */
function copied(xml: string): string {
  const sink = new StringSink();
  const writer = new XMLOutputFactory().createEventWriter(sink);
  for (const event of new XMLInputFactory().createEventReader(xml)) {
    if (event.type !== EventType.DTD) writer.add(event);
  }
  writer.flush();
  return sink.toString();
}

describe('the canonical form survives writing and reading again', () => {
  it.each(DOCUMENTS)('through the DOM and the stream writer: %s', (xml) => {
    for (const method of ['c14n', 'c14n11', 'exc-c14n'] as const) {
      expect(canonicalize(written(xml), { method, comments: true })).toBe(
        canonicalize(xml, { method, comments: true })
      );
    }
  });

  it.each(DOCUMENTS)('through the event reader and the event writer: %s', (xml) => {
    for (const method of ['c14n', 'c14n11', 'exc-c14n'] as const) {
      expect(canonicalize(copied(xml), { method, comments: true })).toBe(canonicalize(xml, { method, comments: true }));
    }
  });
});
