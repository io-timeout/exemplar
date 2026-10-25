import { type Files, MAIN, XI, XI_NS, factory, included, read } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import { DocumentBuilder } from '@exemplarjs/dom';
import { EventType, type StreamReader } from '@exemplarjs/xml';
import { XMLNS_NAMESPACE, XML_NAMESPACE } from '@exemplarjs/xml/internal';

const FILES: Files = {
  'file:///doc/part.xml': '<?xml version="1.0"?><!--c--><part xml:lang="fr"><p xml:id="a">A</p><p>B</p></part>',
  'file:///doc/plain.xml': '<plain><child/></plain>',
  'file:///doc/based.xml': '<based xml:base="sub/x.xml"><child/></based>',
  'file:///doc/sub/deep.xml': '<deep/>',
  'file:///doc/lang.xml': '<l xml:lang="EN"><m/><n xml:lang="de"/></l>',
  'file:///doc/ns.xml': '<n:x xmlns:n="urn:n" xmlns="urn:d"><n:y><z/></n:y></n:x>',
  'file:///doc/nons.xml': '<p><q/></p>',
  'http://example.com/remote.xml': '<remote/>',
  'file:///doc/dot.xml': '<dot xml:base="./"/>',
  'file:///doc/a:b.xml': '<colon/>',
};

describe('base URI fix-up (XInclude §4.5.5)', () => {
  it('adds xml:base to an included element whose base URI differs from the include parent’s', () => {
    expect(included(FILES, `<r ${XI} xml:lang="en"><xi:include href="part.xml"/></r>`)).toBe(
      '<r xml:lang="en"><part xml:base="part.xml" xml:lang="fr"><p xml:id="a">A</p><p>B</p></part></r>'
    );
  });

  it('writes it relative to the include parent’s base URI', () => {
    expect(included(FILES, `<r ${XI}><s xml:base="sub/"><xi:include href="../plain.xml"/></s></r>`)).toBe(
      '<r><s xml:base="sub/"><plain xml:base="../plain.xml"><child></child></plain></s></r>'
    );
    expect(included(FILES, `<r ${XI}><xi:include href="sub/deep.xml"/></r>`)).toBe(
      '<r><deep xml:base="sub/deep.xml"></deep></r>'
    );
  });

  it('writes it absolute when the scheme differs', () => {
    expect(included(FILES, `<r ${XI}><xi:include href="http://example.com/remote.xml"/></r>`)).toBe(
      '<r><remote xml:base="http://example.com/remote.xml"></remote></r>'
    );
  });

  it('replaces an xml:base the included element had with one that gives the same base URI', () => {
    expect(included(FILES, `<r ${XI}><xi:include href="based.xml"/></r>`)).toBe(
      '<r><based xml:base="sub/x.xml"><child></child></based></r>'
    );
    expect(read(FILES, `<r><xi:include ${XI} href="based.xml"/></r>`)).toBe(
      '<r><based xml:base="sub/x.xml"><child></child></based></r>'
    );
  });

  it('adds it to the top-level included elements only', () => {
    expect(included(FILES, `<r ${XI}><xi:include href="plain.xml"/></r>`)).toBe(
      '<r><plain xml:base="plain.xml"><child></child></plain></r>'
    );
  });

  it('adds none to an element whose base URI is the include parent’s', () => {
    expect(included(FILES, `<r ${XI}><s>S</s><xi:include xpointer="element(/1/1)"/></r>`)).toBe(
      '<r><s>S</s><s>S</s></r>'
    );
  });

  it('gives the DOM the included element’s base URI', () => {
    const doc = new DocumentBuilder(factory(FILES)).parse({
      text: `<r ${XI}><xi:include href="sub/deep.xml"/></r>`,
      systemId: MAIN,
    });
    expect(doc.getElementsByTagName('deep').item(0)?.baseURI).toBe('file:///doc/sub/deep.xml');
  });

  it('writes an xml:base that resolves to the included element’s base URI (RFC 3986 §4.2)', () => {
    const main = `<r ${XI}><xi:include href="dot.xml"/><xi:include href="./a:b.xml"/></r>`;
    expect(included(FILES, main)).toBe('<r><dot xml:base="./"></dot><colon xml:base="./a:b.xml"></colon></r>');
    const doc = new DocumentBuilder(factory(FILES)).parse({ text: main, systemId: MAIN });
    expect([doc.documentElement?.firstChild?.baseURI, doc.documentElement?.lastChild?.baseURI]).toEqual([
      'file:///doc/',
      'file:///doc/a:b.xml',
    ]);
  });

  it('leaves xml:base out, and keeps the included element’s own, when fixupBaseURIs is off', () => {
    const setup = { settings: { fixupBaseURIs: false } };
    expect(included(FILES, `<r ${XI}><xi:include href="plain.xml"/></r>`, setup)).toBe(
      '<r><plain><child></child></plain></r>'
    );
    expect(included(FILES, `<r ${XI}><xi:include href="based.xml"/></r>`, setup)).toBe(
      '<r><based xml:base="sub/x.xml"><child></child></based></r>'
    );
  });
});

describe('language fix-up (XInclude §4.5.6)', () => {
  const noBase = { settings: { fixupBaseURIs: false } };

  it('adds xml:lang where the included element’s language differs from the include parent’s', () => {
    expect(
      included(FILES, `<r ${XI} xml:lang="en"><xi:include href="lang.xml" xpointer="element(/1/1)"/></r>`, noBase)
    ).toBe('<r xml:lang="en"><m></m></r>');
    expect(
      included(FILES, `<r ${XI} xml:lang="fr"><xi:include href="lang.xml" xpointer="element(/1/1)"/></r>`, noBase)
    ).toBe('<r xml:lang="fr"><m xml:lang="EN"></m></r>');
  });

  it('compares languages without regard to case', () => {
    expect(included(FILES, `<r ${XI} xml:lang="en"><xi:include href="lang.xml"/></r>`, noBase)).toBe(
      '<r xml:lang="en"><l xml:lang="EN"><m></m><n xml:lang="de"></n></l></r>'
    );
  });

  it('adds xml:lang="" to an element with no language under a parent that has one', () => {
    expect(included(FILES, `<r ${XI} xml:lang="en"><xi:include href="plain.xml"/></r>`, noBase)).toBe(
      '<r xml:lang="en"><plain xml:lang=""><child></child></plain></r>'
    );
  });

  it('adds none to an element with no language under a parent that has none', () => {
    expect(included(FILES, `<r ${XI}><xi:include href="plain.xml"/></r>`, noBase)).toBe(
      '<r><plain><child></child></plain></r>'
    );
  });

  it('keeps an included element’s own xml:lang', () => {
    expect(
      included(FILES, `<r ${XI} xml:lang="en"><xi:include href="lang.xml" xpointer="element(/1/2)"/></r>`, noBase)
    ).toBe('<r xml:lang="en"><n xml:lang="de"></n></r>');
  });

  it('leaves xml:lang out when fixupLanguage is off', () => {
    const setup = { settings: { fixupBaseURIs: false, fixupLanguage: false } };
    expect(
      included(FILES, `<r ${XI} xml:lang="fr"><xi:include href="lang.xml" xpointer="element(/1/1)"/></r>`, setup)
    ).toBe('<r xml:lang="fr"><m></m></r>');
    expect(included(FILES, `<r ${XI}><xi:include href="part.xml" xpointer="a"/></r>`, setup)).toBe(
      '<r><p xml:id="a">A</p></r>'
    );
  });

  it('keeps either fix-up when only the other is turned off', () => {
    expect(
      included(FILES, `<r ${XI} xml:lang="en"><xi:include href="plain.xml"/></r>`, {
        settings: { fixupLanguage: false },
      })
    ).toBe('<r xml:lang="en"><plain xml:base="plain.xml"><child></child></plain></r>');
  });
});

/** The start tags and end tags of a document, with the declarations each reports. */
function tags(reader: StreamReader): string[] {
  const out: string[] = [];
  for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
    if (e !== EventType.START_ELEMENT && e !== EventType.END_ELEMENT) continue;
    const declared = Array.from(
      { length: reader.namespaceCount() },
      (_, i) => `${reader.namespacePrefix(i)}=${reader.namespaceURI(i)}`
    );
    out.push(
      `${e === EventType.START_ELEMENT ? '' : '/'}${reader.name()}{${reader.namespaceURI()}}[${declared.join(' ')}]`
    );
  }
  return out;
}

describe('namespace fix-up (XInclude §4.5.4)', () => {
  const noFixups = { settings: { fixupBaseURIs: false, fixupLanguage: false } };

  it('re-declares on a selected element the prefixes its ancestors bound, at its start and end tags', () => {
    const reader = factory(FILES, noFixups).createStreamReader({
      text: `<r ${XI}><xi:include href="ns.xml" xpointer="element(/1/1)"/></r>`,
      systemId: MAIN,
    });
    expect(tags(reader)).toEqual([
      `r{}[xi=${XI_NS}]`,
      'n:y{urn:n}[n=urn:n =urn:d]',
      'z{urn:d}[]',
      '/z{urn:d}[]',
      '/n:y{urn:n}[n=urn:n =urn:d]',
      `/r{}[xi=${XI_NS}]`,
    ]);
  });

  it('declares xmlns="" on an included element in no namespace under a default namespace', () => {
    expect(included(FILES, `<r xmlns="urn:r" ${XI}><xi:include href="part.xml" xpointer="a"/></r>`, noFixups)).toBe(
      '<r xmlns="urn:r"><p xmlns="" xml:id="a">A</p></r>'
    );
    expect(read(FILES, `<r xmlns="urn:r" ${XI}><xi:include href="nons.xml"/></r>`, noFixups)).toBe(
      `<r xmlns="urn:r" ${XI}><p xmlns=""><q></q></p></r>`
    );
  });

  it('declares nothing the include parent already binds the same way', () => {
    expect(
      read(
        FILES,
        `<r xmlns:n="urn:n" xmlns="urn:d" ${XI}><xi:include href="ns.xml" xpointer="element(/1/1)"/></r>`,
        noFixups
      )
    ).toBe(`<r xmlns:n="urn:n" xmlns="urn:d" ${XI}><n:y><z></z></n:y></r>`);
  });

  it('re-declares a prefix the include parent binds differently', () => {
    expect(
      read(FILES, `<r xmlns:n="urn:other" ${XI}><xi:include href="ns.xml" xpointer="element(/1/1)"/></r>`, noFixups)
    ).toBe(`<r xmlns:n="urn:other" ${XI}><n:y xmlns:n="urn:n" xmlns="urn:d"><z></z></n:y></r>`);
  });

  it('keeps on a fallback’s elements the namespaces the xi: elements around them declare', () => {
    const main = `<r ${XI}><xi:include href="missing.xml" xmlns:a="urn:a"><xi:fallback xmlns:b="urn:b"><a:x><b:y/></a:x></xi:fallback></xi:include></r>`;
    const reader = factory(FILES, noFixups).createStreamReader({ text: main, systemId: MAIN });
    expect(tags(reader)).toEqual([
      `r{}[xi=${XI_NS}]`,
      'a:x{urn:a}[a=urn:a b=urn:b]',
      'b:y{urn:b}[]',
      '/b:y{urn:b}[]',
      '/a:x{urn:a}[a=urn:a b=urn:b]',
      `/r{}[xi=${XI_NS}]`,
    ]);
  });

  it('reports added declarations as xmlns attributes too when namespacePrefixes is on', () => {
    const setup = { ...noFixups, options: { namespacePrefixes: true } };
    expect(read(FILES, `<r xmlns="urn:r" ${XI}><xi:include href="ns.xml" xpointer="element(/1/1)"/></r>`, setup)).toBe(
      `<r xmlns="urn:r" ${XI} xmlns="urn:r" ${XI}><n:y xmlns:n="urn:n" xmlns="urn:d" xmlns="urn:d" xmlns:n="urn:n"><z></z></n:y></r>`
    );
    const reader = factory(FILES, setup).createStreamReader({
      text: `<r ${XI}><xi:include href="nons.xml"/></r>`,
      systemId: MAIN,
    });
    while (reader.next() !== EventType.START_ELEMENT || reader.localName() !== 'p');
    expect(reader.attributeCount()).toBe(0);
    const prefixed = factory(FILES, setup).createStreamReader({
      text: `<r xmlns="urn:r" ${XI}><xi:include href="nons.xml"/></r>`,
      systemId: MAIN,
    });
    while (prefixed.next() !== EventType.START_ELEMENT || prefixed.localName() !== 'p');
    expect([prefixed.attributeName(0), prefixed.attributeLocalName(0), prefixed.attributePrefix(0)]).toEqual([
      'xmlns',
      'xmlns',
      '',
    ]);
    expect([prefixed.attributeNamespace(0), prefixed.attributeValue(0)]).toEqual([XMLNS_NAMESPACE, '']);
  });
});

describe('attributes the fix-ups add', () => {
  it('are specified CDATA attributes in the XML namespace, after the element’s own', () => {
    const reader = factory(FILES).createStreamReader({
      text: `<r ${XI} xml:lang="en"><xi:include href="part.xml" xpointer="a"/></r>`,
      systemId: MAIN,
    });
    while (reader.next() !== EventType.START_ELEMENT || reader.localName() !== 'p');
    const attributes = Array.from({ length: reader.attributeCount() }, (_, i) => [
      reader.attributeName(i),
      reader.attributeLocalName(i),
      reader.attributePrefix(i),
      reader.attributeNamespace(i),
      reader.attributeType(i),
      reader.isAttributeSpecified(i),
      reader.attributeValue(i),
    ]);
    expect(attributes).toEqual([
      ['xml:id', 'id', 'xml', XML_NAMESPACE, 'ID', true, 'a'],
      ['xml:base', 'base', 'xml', XML_NAMESPACE, 'CDATA', true, 'part.xml'],
      ['xml:lang', 'lang', 'xml', XML_NAMESPACE, 'CDATA', true, 'fr'],
    ]);
    expect([reader.attributeValue(XML_NAMESPACE, 'base'), reader.attributeValue(XML_NAMESPACE, 'id')]).toEqual([
      'part.xml',
      'a',
    ]);
  });

  it('throw a RangeError for an index past the last attribute or declaration', () => {
    const reader = factory(FILES).createStreamReader({
      text: `<r xmlns="urn:r" ${XI}><xi:include href="plain.xml"/></r>`,
      systemId: MAIN,
    });
    while (reader.next() !== EventType.START_ELEMENT || reader.localName() !== 'plain');
    expect([reader.attributeCount(), reader.namespaceCount()]).toEqual([1, 1]);
    expect(() => reader.attributeName(9)).toThrow(RangeError);
    expect(() => reader.attributeType(9)).toThrow(RangeError);
    expect(() => reader.attributeValue(1)).toThrow(RangeError);
    expect(() => reader.namespacePrefix(1)).toThrow(RangeError);
    expect(() => reader.namespaceURI(-1)).toThrow('Namespace index -1 is out of range for the current event');
  });
});

const INDEXED: readonly (readonly [string, 'attribute' | 'namespace', (reader: StreamReader, i: number) => unknown])[] =
  [
    ['attributeName', 'attribute', (r, i) => r.attributeName(i)],
    ['attributeLocalName', 'attribute', (r, i) => r.attributeLocalName(i)],
    ['attributePrefix', 'attribute', (r, i) => r.attributePrefix(i)],
    ['attributeNamespace', 'attribute', (r, i) => r.attributeNamespace(i)],
    ['attributeType', 'attribute', (r, i) => r.attributeType(i)],
    ['isAttributeSpecified', 'attribute', (r, i) => r.isAttributeSpecified(i)],
    ['attributeValue', 'attribute', (r, i) => r.attributeValue(i)],
    ['namespacePrefix', 'namespace', (r, i) => r.namespacePrefix(i)],
    ['namespaceURI', 'namespace', (r, i) => r.namespaceURI(i)],
  ];

/** Whether a call throws a RangeError; anything else it throws is thrown again. */
function throwsRange(call: () => unknown): boolean {
  try {
    call();
    return false;
  } catch (error) {
    if (error instanceof RangeError) return true;
    throw error;
  }
}

/** Each event's type and counts, then any indexed call that throws a RangeError in range or does not past it. */
function indexing(reader: StreamReader): string[] {
  const out: string[] = [];
  for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
    const counts = { attribute: reader.attributeCount(), namespace: reader.namespaceCount() };
    const past = Array.from({ length: Math.max(counts.attribute, counts.namespace) + 2 }, (_, k) => k);
    const indexes = [-1, 0.5, Number.NaN, 2 ** 32, ...past];
    const wrong = INDEXED.flatMap(([name, kind, call]) =>
      indexes
        .filter((i) => throwsRange(() => call(reader, i)) === (Number.isInteger(i) && i >= 0 && i < counts[kind]))
        .map((i) => `${name}(${i})`)
    );
    out.push([e, counts.attribute, counts.namespace, ...wrong].join(' '));
  }
  return out;
}

describe('indexed accessors (as the cursor’s)', () => {
  it.each([
    ['an included element with fix-ups', `<r xml:lang="en" ${XI}><xi:include href="part.xml"/></r>`],
    ['a selected element given declarations', `<r ${XI}><xi:include href="ns.xml" xpointer="element(/1/1)"/></r>`],
    [
      'a fallback element given declarations',
      `<r ${XI}><xi:include href="missing.xml" xmlns:a="urn:a"><xi:fallback><a:x b="1"/></xi:fallback></xi:include></r>`,
    ],
    ['included text', `<r ${XI} a="1"><xi:include href="note.txt" parse="text"/></r>`],
    ['included documents in included documents', `<r ${XI}><xi:include href="nested.xml"/></r>`],
  ])('throw a RangeError for every index out of range, at every event, for %s', (_what, main) => {
    const files = {
      ...FILES,
      'file:///doc/note.txt': 'note',
      'file:///doc/nested.xml': `<n xmlns:m="urn:m" ${XI}><xi:include href="ns.xml"/></n>`,
    };
    for (const prefixes of [false, true]) {
      const reader = factory(files, { options: { namespacePrefixes: prefixes } }).createStreamReader({
        text: main,
        systemId: MAIN,
      });
      const seen = indexing(reader);
      expect(seen.filter((line) => line.includes('('))).toEqual([]);
      expect(seen.length).toBeGreaterThan(2);
    }
  });

  it('count no attributes or declarations at included text', () => {
    const reader = factory({ ...FILES, 'file:///doc/note.txt': 'note' }).createStreamReader({
      text: `<r ${XI} a="1"><xi:include href="note.txt" parse="text"/></r>`,
      systemId: MAIN,
    });
    expect(indexing(reader)).toEqual([
      `${EventType.START_ELEMENT} 1 1`,
      `${EventType.CHARACTERS} 0 0`,
      `${EventType.END_ELEMENT} 0 1`,
    ]);
  });
});
