import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, XMLInputFactory } from '@exemplarjs/xml';
import type { StreamReader } from '@exemplarjs/xml/internal';
import { NoXmlnsURIAttributes, ReaderAttributes } from '@/attributes.ts';
import { type Attributes, SAXParser } from '@/index.ts';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** The attributes of a document's first start tag, read through a cursor stopped there. */
function attributesOf(xml: string, options: InputOptions = {}, Kind = ReaderAttributes): ReaderAttributes {
  const reader = new XMLInputFactory(options).createStreamReader(xml);
  while (reader.next() !== EventType.START_ELEMENT);
  return new Kind(reader as StreamReader, options.namespaceAware ?? true);
}

/** Each attribute as `qName|localName|uri`. */
function namesOf(a: Attributes): string[] {
  return Array.from({ length: a.length }, (_, i) => `${a.qName(i)}|${a.localName(i)}|${a.uri(i)}`);
}

/** Calls a function with the Attributes of each start tag SAX reports. */
function eachStartTag(xml: string, read: (attributes: Attributes) => void): void {
  new SAXParser().parse(xml, { startElement: (_uri, _localName, _qName, attributes) => read(attributes) });
}

describe('ReaderAttributes (SAX2 Attributes2)', () => {
  const xml =
    '<!DOCTYPE r [<!ATTLIST r id ID #IMPLIED e (x|y) "y" p:q CDATA "pq">]><r xmlns:p="urn:p" id="i1" xml:lang="en" p:z="1"/>';

  it('counts the attributes, defaults included and namespace declarations left out', () => {
    expect(attributesOf(xml)).toHaveLength(5);
  });

  it('gives each attribute its qualified name, local name and namespace URI', () => {
    const a = attributesOf(xml);
    const names = Array.from({ length: a.length }, (_, i) => `${a.qName(i)}|${a.localName(i)}|${a.uri(i)}`);
    expect(names).toEqual(['id|id|', `xml:lang|lang|${XML_NS}`, 'p:z|z|urn:p', 'e|e|', 'p:q|q|urn:p']);
  });

  it('gives each value by index', () => {
    const a = attributesOf(xml);
    expect(Array.from({ length: a.length }, (_, i) => a.value(i))).toEqual(['i1', 'en', '1', 'y', 'pq']);
  });

  it('gives a value by namespace URI and local name, or undefined', () => {
    const a = attributesOf(xml);
    expect(a.value('urn:p', 'q')).toBe('pq');
    expect(a.value(XML_NS, 'lang')).toBe('en');
    expect(a.value('', 'id')).toBe('i1');
    expect(a.value('urn:p', 'id')).toBeUndefined();
    expect(a.value('', 'missing')).toBeUndefined();
  });

  it('gives a value by qualified name, or undefined, as SAX getValue(qName) does', () => {
    const a = attributesOf(xml);
    expect([a.value('id'), a.value('xml:lang'), a.value('p:q'), a.value('q'), a.value('missing')]).toEqual([
      'i1',
      'en',
      'pq',
      undefined,
      undefined,
    ]);
  });

  it('gives the declared type, NMTOKEN for an enumeration and CDATA when undeclared (Attributes.getType)', () => {
    const a = attributesOf(xml);
    expect(Array.from({ length: a.length }, (_, i) => a.type(i))).toEqual(['ID', 'CDATA', 'CDATA', 'NMTOKEN', 'CDATA']);
  });

  it('tells written attributes from defaulted ones (Attributes2.isSpecified)', () => {
    const a = attributesOf(xml);
    expect(Array.from({ length: a.length }, (_, i) => a.isSpecified(i))).toEqual([true, true, true, false, false]);
  });

  it('finds an attribute by qualified name, or -1', () => {
    const a = attributesOf(xml);
    expect(a.index('id')).toBe(0);
    expect(a.index('p:q')).toBe(4);
    expect(a.index('q')).toBe(-1);
    expect(a.index('missing')).toBe(-1);
  });

  it('finds an attribute by namespace URI and local name, or -1', () => {
    const a = attributesOf(xml);
    expect(a.index('urn:p', 'z')).toBe(2);
    expect(a.index(XML_NS, 'lang')).toBe(1);
    expect(a.index('', 'z')).toBe(-1);
    expect(a.index('urn:other', 'z')).toBe(-1);
  });

  it('gives empty local names and URIs without namespace processing, as SAX2 does', () => {
    const a = attributesOf('<r xmlns:p="urn:p" p:z="1" b="2"/>', { namespaceAware: false });
    const names = Array.from({ length: a.length }, (_, i) => `${a.qName(i)}|${a.localName(i)}|${a.uri(i)}`);
    expect(names).toEqual(['xmlns:p||', 'p:z||', 'b||']);
    expect(a.index('p:z')).toBe(1);
  });

  it('has no attributes for a tag without them', () => {
    const a = attributesOf('<r/>');
    expect(a).toHaveLength(0);
    expect(a.index('x')).toBe(-1);
    expect(a.value('', 'x')).toBeUndefined();
  });

  it('reads the current start tag as SAX reports each one', () => {
    const seen: string[] = [];
    eachStartTag('<a x="1"><b y="2" z="3"/><c/></a>', (attributes) =>
      seen.push(`${attributes.length}:${attributes.index('z')}`)
    );
    expect(seen).toEqual(['1:-1', '2:1', '0:-1']);
  });

  it('keeps names that are Object.prototype members ordinary (no prototype lookups)', () => {
    const seen: string[] = [];
    eachStartTag('<a __proto__="1" constructor="2" toString="3" hasOwnProperty="4"/>', (attributes) => {
      for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
        seen.push(`${name}=${attributes.index(name)}:${attributes.value('', name)}`);
      }
    });
    expect(seen).toEqual([
      '__proto__=0:1',
      'constructor=1:2',
      'toString=2:3',
      'hasOwnProperty=3:4',
      'valueOf=-1:undefined',
    ]);
  });
});

describe('NoXmlnsURIAttributes (SAX2 namespace-prefixes on, xmlns-uris off)', () => {
  const xml = '<r xmlns="urn:d" xmlns:p="urn:p" p:z="1" b="2"/>';
  const prefixes = { namespacePrefixes: true };

  it('gives xmlns attributes an empty namespace URI and local name, as the JDK does, where the cursor gives them the xmlns namespace', () => {
    expect(namesOf(attributesOf(xml, prefixes))).toEqual([
      `xmlns|xmlns|${XMLNS}`,
      `xmlns:p|p|${XMLNS}`,
      'p:z|z|urn:p',
      'b|b|',
    ]);
    expect(namesOf(attributesOf(xml, prefixes, NoXmlnsURIAttributes))).toEqual([
      'xmlns||',
      'xmlns:p||',
      'p:z|z|urn:p',
      'b|b|',
    ]);
  });

  it('finds xmlns attributes only by qualified name, as they have no namespace name', () => {
    const a = attributesOf(xml, prefixes, NoXmlnsURIAttributes);
    expect(a.index('', 'p')).toBe(-1);
    expect(a.index(XMLNS, 'p')).toBe(-1);
    expect(a.value('', 'xmlns')).toBeUndefined();
    expect(a.value(XMLNS, 'xmlns')).toBeUndefined();
    expect(a.value(a.index('xmlns'))).toBe('urn:d');
    expect(a.index('urn:p', 'z')).toBe(2);
    expect(a.value('', 'b')).toBe('2');
    expect(a.index('xmlns:p')).toBe(1);
    expect(a.index('', 'missing')).toBe(-1);
  });
});
