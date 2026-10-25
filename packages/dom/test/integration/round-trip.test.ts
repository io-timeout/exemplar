import { DOCUMENTS } from '@test/helpers/documents.ts';
import { build, newDocument, serialize } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { StringSink, XMLOutputFactory } from '@exemplarjs/writer';
import { type InputOptions } from '@exemplarjs/xml';
import { type Document, DOMParser, type Element, type Node, type Text } from '@/index.ts';

/** Parses, serializes and parses again; returns both trees and the text between. */
function roundTrip(xml: string, options: InputOptions = {}): { first: Document; second: Document; text: string } {
  const first = build(xml, options);
  const text = serialize(first);
  return { first, second: build(text, options), text };
}

describe('parse, serialize and parse again', () => {
  it.each(Object.entries(DOCUMENTS))('gives an equal tree for %s', (_name, xml) => {
    const { first, second, text } = roundTrip(xml);
    expect(second.isEqualNode(first)).toBe(true);
    expect(serialize(second)).toBe(text);
  });

  it.each(Object.entries(DOCUMENTS))('gives an equal tree for %s with entity references kept', (_name, xml) => {
    const { first, second } = roundTrip(xml, { replaceEntityReferences: false });
    expect(second.isEqualNode(first)).toBe(true);
  });

  it.each(Object.entries(DOCUMENTS))('gives an equal tree for %s without namespaces', (name, xml) => {
    const { first, second } = roundTrip(xml, { namespaceAware: false });
    expect(second.isEqualNode(first), name).toBe(true);
  });

  it('writes kept entity references and their declarations', () => {
    const { text } = roundTrip(DOCUMENTS['a document type'] as string, { replaceEntityReferences: false });
    expect(text).toBe(
      '<!DOCTYPE r PUBLIC "-//P//EN" "r.dtd" [<!ENTITY e "x"><!ATTLIST r d CDATA "dv">]><r d="dv">&e;</r>'
    );
  });

  it('goes through DOMParser and XMLSerializer the same way', () => {
    const parser = new DOMParser();
    for (const xml of Object.values(DOCUMENTS)) {
      const first = parser.parseFromString(xml, 'application/xml');
      const second = parser.parseFromString(serialize(first), 'application/xml');
      expect(second.isEqualNode(first), xml).toBe(true);
    }
  });

  it('keeps a CDATA section holding ]]> as split sections with the same text', () => {
    const document = newDocument();
    const r = document.appendChild(document.createElement('r'));
    r.appendChild(document.createCDATASection('a]]>b'));
    const back = build(serialize(document));
    expect(back.documentElement?.textContent).toBe('a]]>b');
    expect(back.documentElement?.childNodes.length).toBe(2);
  });

  it('gives back a tree changed through the DOM, once its text is normalized', () => {
    const document = build(DOCUMENTS.namespaces as string);
    const c = document.documentElement?.firstChild as Element;
    c.setAttributeNS('urn:p', 'p:new', '&<>"');
    c.appendChild(document.createTextNode('one'));
    (c.lastChild as Text).splitText(1);
    c.insertBefore(document.createComment('first'), c.firstChild);
    document.normalize();
    expect(build(serialize(document)).isEqualNode(document)).toBe(true);
  });

  it('gives back a tree built through the DOM once normalizeDocument has declared its namespaces', () => {
    const document = newDocument();
    const root = document.appendChild(document.createElementNS('urn:a', 'a:root'));
    root.setAttributeNS('urn:b', 'b:at', 'v');
    root.appendChild(document.createElementNS('urn:c', 'leaf')).setAttributeNS('urn:d', 'x', '1');
    document.normalizeDocument();
    expect(build(serialize(document)).isEqualNode(document)).toBe(true);
  });

  it('declares the namespaces a tree built through the DOM uses, so that they read back', () => {
    const document = newDocument();
    const root = document.appendChild(document.createElementNS('urn:a', 'a:root'));
    const leaf = root.appendChild(document.createElementNS('urn:c', 'leaf'));
    leaf.setAttributeNS('urn:d', 'x', '1');
    const back = build(serialize(document)).documentElement as Element;
    const backLeaf = back.firstChild as Element;
    expect([back.namespaceURI, backLeaf.namespaceURI, backLeaf.getAttributeNS('urn:d', 'x')]).toEqual([
      'urn:a',
      'urn:c',
      '1',
    ]);
  });

  it('serializes a subtree with the namespaces it inherits, so that it reads back alone', () => {
    const document = build(DOCUMENTS.namespaces as string);
    const c = document.documentElement?.firstChild as Node;
    const alone = build(serialize(c)).documentElement as Element;
    expect([
      alone.namespaceURI,
      alone.getAttributeNS('urn:p', 'a'),
      (alone.firstChild as Element).namespaceURI,
    ]).toEqual(['urn:d', '1', 'urn:q']);
  });
});

describe('writing a tree with the stream writer', () => {
  /** A tree written with writeNode, XML declaration included. */
  function written(document: Document): string {
    const sink = new StringSink();
    const writer = new XMLOutputFactory().createStreamWriter(sink);
    writer.writeNode(document);
    writer.flush();
    return sink.toString();
  }

  it('writes a DOM tree with writeNode', () => {
    const source = DOCUMENTS['a document type'] as string;
    const text = written(
      build(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${source}`, {
        replaceEntityReferences: false,
      })
    );
    expect(text).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE r PUBLIC "-//P//EN" "r.dtd" [<!ENTITY e "x"><!ATTLIST r d CDATA "dv">]><r d="dv">&e;</r>'
    );
  });

  it('keeps the XML version, which XMLSerializer leaves out', () => {
    const document = build('<?xml version="1.1"?><r>&#x85;</r>');
    const back = build(written(document));
    expect([back.xmlVersion, back.isEqualNode(document)]).toEqual(['1.1', true]);
  });
});
