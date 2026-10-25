import { recorder } from '@test/helpers/recorder.ts';
import { describe, expect, it } from 'vitest';
import { type EntityResolver, type ResolveRequest, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { type Validator, accessAllows, accessRefusedError } from '@exemplarjs/xml/internal';
import { type Attributes, SAXParser, type SAXHandler } from '@/index.ts';

const BASE = 'http://example.org/docs/';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** A resolver serving texts by absolute URI, recording what it was asked; a reading one keeps to the access list. */
function memory(files: Record<string, string>, asked: ResolveRequest[] = [], reading = false): EntityResolver {
  return {
    resolveEntity(request) {
      asked.push(request);
      const uri = new URL(request.systemId ?? '', request.baseURI).href;
      if (reading && request.access !== undefined && !accessAllows(request.access, uri)) throw accessRefusedError(uri);
      const text = files[uri];
      return text === undefined ? undefined : { systemId: uri, text };
    },
  };
}

/** A validator that finds whitespace-only text in element content, as a DTD validator does for element-only content. */
const WHITESPACE_VALIDATOR: Validator = {
  create: (context) => ({
    dtd: () => {},
    startElement: () => {},
    endElement: () => {},
    text: () => context.reader.isWhitespace(),
    markup: () => {},
    entity: () => {},
    endDocument: () => {},
  }),
};

/** Parses a document with a fresh parser and a recorder; returns the calls. */
function calls(xml: string, factory = new XMLInputFactory(), only?: readonly string[]): string[] {
  const { handler, calls: out } = recorder(only);
  new SAXParser(factory).parse(xml, handler);
  return out;
}

describe('SAXParser options', () => {
  it('keeps the factory and options it was given', () => {
    const factory = new XMLInputFactory();
    const options = { xmlnsURIs: true };
    const parser = new SAXParser(factory, options);
    expect(parser.factory).toBe(factory);
    expect(parser.options).toBe(options);
    expect(new SAXParser().options).toEqual({});
  });

  it('reads without namespaces as SAX2 does with its namespaces feature off: no URI, no local name, no prefix mappings', () => {
    const parser = new SAXParser(new XMLInputFactory({ namespaceAware: false }));
    const { handler, calls: out } = recorder(['startElement', 'endElement', 'startPrefixMapping', 'endPrefixMapping']);
    parser.parse('<p:a xmlns:p="urn:p" p:x="1"><b/></p:a>', handler);
    expect(out).toEqual([
      'startElement(, , p:a, [xmlns:p=urn:p p:x=1])',
      'startElement(, , b, [])',
      'endElement(, , b)',
      'endElement(, , p:a)',
    ]);
  });

  it('reports namespace declarations among the attributes with namespacePrefixes on (SAX2 namespace-prefixes)', () => {
    const parser = new SAXParser(new XMLInputFactory({ namespacePrefixes: true }));
    const { handler, calls: out } = recorder(['startElement']);
    parser.parse('<a xmlns="urn:d" xmlns:p="urn:p" p:x="1"/>', handler);
    expect(out).toEqual(['startElement(urn:d, a, a, [xmlns=urn:d xmlns:p=urn:p p:x=1])']);
  });

  it('puts xmlns attributes in no namespace unless xmlnsURIs is on (SAX2 xmlns-uris)', () => {
    const factory = new XMLInputFactory({ namespacePrefixes: true });
    /** Each attribute of the root as `qName|uri`. */
    const uris = (parser: SAXParser): string[] => {
      const out: string[] = [];
      parser.parse('<a xmlns="urn:d" xmlns:p="urn:p" p:x="1"/>', {
        startElement: (_uri, _localName, _qName, attributes) => {
          for (let i = 0; i < attributes.length; i++) out.push(`${attributes.qName(i)}|${attributes.uri(i)}`);
        },
      });
      return out;
    };
    expect(uris(new SAXParser(factory))).toEqual(['xmlns|', 'xmlns:p|', 'p:x|urn:p']);
    expect(uris(new SAXParser(factory, { xmlnsURIs: false }))).toEqual(['xmlns|', 'xmlns:p|', 'p:x|urn:p']);
    expect(uris(new SAXParser(factory, { xmlnsURIs: true }))).toEqual([
      `xmlns|${XMLNS}`,
      `xmlns:p|${XMLNS}`,
      'p:x|urn:p',
    ]);
  });

  it('makes system ids in declarations absolute unless resolveDTDURIs is false (SAX2 resolve-dtd-uris)', () => {
    const xml = { systemId: `${BASE}d.xml`, text: '<!DOCTYPE a [<!NOTATION n SYSTEM "n.txt">]><a/>' };
    const on = recorder(['notationDecl']);
    new SAXParser().parse(xml, on.handler);
    expect(on.calls).toEqual([`notationDecl(n, undefined, ${BASE}n.txt)`]);
    const off = recorder(['notationDecl']);
    new SAXParser(new XMLInputFactory(), { resolveDTDURIs: false }).parse(xml, off.handler);
    expect(off.calls).toEqual(['notationDecl(n, undefined, n.txt)']);
  });

  it('skips external general entities with supportExternalEntities off (SAX2 external-general-entities)', () => {
    const factory = new XMLInputFactory({
      accessExternalEntities: 'all',
      entityResolver: memory({ [`${BASE}e.xml`]: 'E' }),
    });
    const xml = { systemId: `${BASE}d.xml`, text: '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;</a>' };
    const on = recorder(['characters', 'skippedEntity']);
    new SAXParser(factory).parse(xml, on.handler);
    expect(on.calls).toEqual(['characters(E)']);
    const off = recorder(['characters', 'skippedEntity']);
    new SAXParser(factory.withOptions({ supportExternalEntities: false })).parse(xml, off.handler);
    expect(off.calls).toEqual(['skippedEntity(e)']);
  });

  it('warns of text that is not fully normalized with checkNormalization on (XML 1.1 §2.13)', () => {
    const parser = new SAXParser(new XMLInputFactory({ checkNormalization: true }));
    const { handler, calls: out } = recorder(['warning']);
    parser.parse('<?xml version="1.1"?><a>e\u0301</a>', handler);
    expect(out).toEqual(['warning(NOT_FULLY_NORMALIZED)']);
  });

  it('refuses a DOCTYPE with disallowDoctype on', () => {
    const parser = new SAXParser(new XMLInputFactory({ disallowDoctype: true }));
    expect(() => parser.parse('<!DOCTYPE a><a/>', {})).toThrow(expect.objectContaining({ code: 'DOCTYPE_DISALLOWED' }));
  });

  it("applies the factory's limits", () => {
    const deep = new SAXParser(new XMLInputFactory({ limits: { elementDepth: 1 } }));
    expect(() => deep.parse('<a><b/></a>', {})).toThrow(expect.objectContaining({ code: 'LIMIT_ELEMENT_DEPTH' }));
    const expanding = new SAXParser(new XMLInputFactory({ limits: { entityExpansions: 2 } }));
    const xml = '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;&e;&e;</a>';
    expect(() => expanding.parse(xml, {})).toThrow(expect.objectContaining({ code: 'LIMIT_ENTITY_EXPANSIONS' }));
  });
});

describe('SAXParser access lists', () => {
  const DTD = { systemId: `${BASE}d.xml`, text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>' };
  const ENTITY = { systemId: `${BASE}d.xml`, text: '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;</a>' };
  const FILES = { [`${BASE}a.dtd`]: '<!ENTITY e "from the DTD">', [`${BASE}e.xml`]: 'external' };

  it('asks its resolver whatever the access lists say, as the JDK does', () => {
    const factory = new XMLInputFactory({ entityResolver: memory(FILES) });
    for (const [xml, text] of [
      [DTD, 'from the DTD'],
      [ENTITY, 'external'],
    ] as const) {
      const { handler, calls: out } = recorder(['characters', 'skippedEntity']);
      new SAXParser(factory).parse(xml, handler);
      expect(out).toEqual([`characters(${text})`]);
    }
  });

  it.each([
    ['the external subset', DTD, 'accessExternalDTD', 'from the DTD'],
    ['an external entity', ENTITY, 'accessExternalEntities', 'external'],
  ] as const)(
    'reports %s a reading resolver refuses to the handler, and skips it, until %s allows it',
    (_, xml, option, text) => {
      const factory = new XMLInputFactory({ entityResolver: memory(FILES, [], true) });
      const refused = recorder(['characters', 'skippedEntity', 'error']);
      new SAXParser(factory).parse(xml, refused.handler);
      expect(refused.calls).toEqual(['error(ACCESS_REFUSED)', 'skippedEntity(e)']);
      const allowed = recorder(['characters', 'skippedEntity', 'error']);
      new SAXParser(factory.withOptions({ [option]: ['http'] })).parse(xml, allowed.handler);
      expect(allowed.calls).toEqual([`characters(${text})`]);
    }
  );
});

describe('SAXParser.parse (SAX2 ContentHandler)', () => {
  it('calls content and lexical handler methods in document order', () => {
    const xml = '<?xml version="1.0"?><p:a xmlns:p="urn:p" x="1"><!--c-->t<![CDATA[d]]><?pi data?></p:a>';
    expect(calls(xml)).toEqual([
      'startDocument()',
      'startPrefixMapping(p, urn:p)',
      'startElement(urn:p, a, p:a, [x=1])',
      'comment(c)',
      'characters(t)',
      'startCDATA()',
      'characters(d)',
      'endCDATA()',
      'processingInstruction(pi, data)',
      'endElement(urn:p, a, p:a)',
      'endPrefixMapping(p)',
      'endDocument()',
    ]);
  });

  it('reports comments and PIs outside the root element, but not whitespace', () => {
    const xml = '<?xml version="1.0"?>\n<!--before-->\n<?p d?>\n<a/>\n<!--after-->\n<?q?>\n';
    const factory = new XMLInputFactory({ reportPrologWhitespace: true });
    expect(calls(xml, factory)).toEqual([
      'startDocument()',
      'comment(before)',
      'processingInstruction(p, d)',
      'startElement(, a, a, [])',
      'endElement(, a, a)',
      'comment(after)',
      'processingInstruction(q, )',
      'endDocument()',
    ]);
  });

  it('maps prefixes before the start tag and unmaps them after the end tag, in declaration order', () => {
    const xml = '<a xmlns="urn:d" xmlns:p="urn:p"><p:b xmlns:q="urn:q"/><c xmlns=""/></a>';
    expect(calls(xml, undefined, ['startPrefixMapping', 'endPrefixMapping', 'startElement', 'endElement'])).toEqual([
      'startPrefixMapping(, urn:d)',
      'startPrefixMapping(p, urn:p)',
      'startElement(urn:d, a, a, [])',
      'startPrefixMapping(q, urn:q)',
      'startElement(urn:p, b, p:b, [])',
      'endElement(urn:p, b, p:b)',
      'endPrefixMapping(q)',
      'startPrefixMapping(, )',
      'startElement(, c, c, [])',
      'endElement(, c, c)',
      'endPrefixMapping()',
      'endElement(urn:d, a, a)',
      'endPrefixMapping()',
      'endPrefixMapping(p)',
    ]);
  });

  it('reports end tags with the names their start tags had, through nesting', () => {
    const xml = '<r xmlns:p="urn:outer"><p:item xmlns:p="urn:inner"><p:x/></p:item><p:item/></r>';
    expect(calls(xml, undefined, ['endElement'])).toEqual([
      'endElement(urn:inner, x, p:x)',
      'endElement(urn:inner, item, p:item)',
      'endElement(urn:outer, item, p:item)',
      'endElement(, r, r)',
    ]);
  });

  it('reads namespaces for a handler with no prefix mapping methods', () => {
    const names: string[] = [];
    new SAXParser().parse('<p:a xmlns:p="urn:p"><p:b/></p:a>', {
      startElement: (uri, localName) => names.push(`{${uri}}${localName}`),
      endElement: (uri, localName) => names.push(`/{${uri}}${localName}`),
    });
    expect(names).toEqual(['{urn:p}a', '{urn:p}b', '/{urn:p}b', '/{urn:p}a']);
  });

  it('reports comment text as written, spaces kept and line ends normalized (§2.5, §2.11)', () => {
    expect(calls('<!-- HELLO --><r><!--a\r\nb\rc--></r>', undefined, ['comment'])).toEqual([
      'comment( HELLO )',
      'comment(a\nb\nc)',
    ]);
  });

  it('reports PI data with leading whitespace dropped and trailing whitespace kept (§2.6)', () => {
    expect(calls('<r><?pi   a  ?><?empty?></r>', undefined, ['processingInstruction'])).toEqual([
      'processingInstruction(pi, a  )',
      'processingInstruction(empty, )',
    ]);
  });

  it('wraps a CDATA section in startCDATA and endCDATA (LexicalHandler)', () => {
    expect(calls('<a>x<![CDATA[<y>]]>z</a>', undefined, ['characters', 'startCDATA', 'endCDATA'])).toEqual([
      'characters(x)',
      'startCDATA()',
      'characters(<y>)',
      'endCDATA()',
      'characters(z)',
    ]);
  });

  it('reports CDATA boundaries to a handler without characters', () => {
    expect(calls('<a><![CDATA[x]]></a>', undefined, ['startCDATA', 'endCDATA'])).toEqual([
      'startCDATA()',
      'endCDATA()',
    ]);
  });

  it('merges text, CDATA and entity text into one characters call when coalescing', () => {
    const xml = '<!DOCTYPE a [<!ENTITY e "E">]><a>x<![CDATA[y]]>&e;z</a>';
    const factory = new XMLInputFactory({ coalescing: true });
    expect(calls(xml, factory, ['characters', 'startCDATA'])).toEqual(['characters(xyEz)']);
  });

  it('reads a document for a handler with no methods at all', () => {
    expect(() =>
      new SAXParser().parse('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;<!--c--><?p?><![CDATA[d]]></a>', {})
    ).not.toThrow();
  });

  it('reports unread entities as skipped (skippedEntity)', () => {
    expect(calls('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', undefined, ['skippedEntity'])).toEqual(['skippedEntity(e)']);
  });

  it('reports every reference as skipped when entity references are not replaced', () => {
    const factory = new XMLInputFactory({ replaceEntityReferences: false });
    expect(calls('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', factory, ['skippedEntity', 'characters'])).toEqual([
      'skippedEntity(e)',
    ]);
  });

  it('reports whitespace in element content as ignorableWhitespace', () => {
    const factory = new XMLInputFactory({ validator: WHITESPACE_VALIDATOR });
    expect(calls('<a>\n  <b>x</b>\n</a>', factory, ['characters', 'ignorableWhitespace'])).toEqual([
      'ignorableWhitespace(\n  )',
      'characters(x)',
      'ignorableWhitespace(\n)',
    ]);
  });

  it('drops whitespace outside the root element even when the reader reports it', () => {
    const factory = new XMLInputFactory({ validator: WHITESPACE_VALIDATOR, reportPrologWhitespace: true });
    expect(calls('\n<a> </a>\n', factory, ['characters', 'ignorableWhitespace'])).toEqual(['ignorableWhitespace( )']);
  });

  it('passes one Attributes object that reads the current start tag', () => {
    const seen: Attributes[] = [];
    const values: string[] = [];
    new SAXParser().parse('<a x="1"><b y="2"/></a>', {
      startElement: (_uri, _localName, _qName, attributes) => {
        seen.push(attributes);
        values.push(attributes.value(0));
      },
    });
    expect(seen[0]).toBe(seen[1]);
    expect(values).toEqual(['1', '2']);
  });

  it.each([
    ['a string', '<a>t</a>'],
    ['bytes', new TextEncoder().encode('<a>t</a>')],
    ['an iterable of chunks', [new TextEncoder().encode('<a>'), new TextEncoder().encode('t</a>')]],
    ['a source object', { systemId: 'file:///d.xml', text: '<a>t</a>' }],
  ])('parses %s', (_kind, source) => {
    const { handler, calls: out } = recorder(['startElement', 'characters']);
    new SAXParser().parse(source, handler);
    expect(out).toEqual(['startElement(, a, a, [])', 'characters(t)']);
  });

  it('can be used for one document after another', () => {
    const parser = new SAXParser();
    const first = recorder(['startElement']);
    const second = recorder(['startElement']);
    parser.parse('<a/>', first.handler);
    parser.parse('<b/>', second.handler);
    expect([...first.calls, ...second.calls]).toEqual(['startElement(, a, a, [])', 'startElement(, b, b, [])']);
  });
});

describe('SAXParser.parseAsync', () => {
  /** Yields bytes one at a time. */
  async function* bytewise(xml: string): AsyncGenerator<Uint8Array> {
    for (const b of new TextEncoder().encode(xml)) yield new Uint8Array([b]);
  }

  it('parses an async iterable of chunks, awaiting input as it arrives', async () => {
    const { handler, calls: out } = recorder();
    await new SAXParser().parseAsync(bytewise('<a>text</a>'), handler);
    expect(out).toEqual([
      'startDocument()',
      'startElement(, a, a, [])',
      'characters(text)',
      'endElement(, a, a)',
      'endDocument()',
    ]);
  });

  it('parses a web ReadableStream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<a x="1">'));
        controller.enqueue(new TextEncoder().encode('y</a>'));
        controller.close();
      },
    });
    const { handler, calls: out } = recorder(['startElement', 'characters']);
    await new SAXParser().parseAsync(stream, handler);
    expect(out).toEqual(['startElement(, a, a, [x=1])', 'characters(y)']);
  });

  it('parses a string', async () => {
    const { handler, calls: out } = recorder(['startElement']);
    await new SAXParser().parseAsync('<a/>', handler);
    expect(out).toEqual(['startElement(, a, a, [])']);
  });

  it('waits for a resolver that answers with a promise', async () => {
    const resolver: EntityResolver = { resolveEntity: () => Promise.resolve({ text: '<b>later</b>' }) };
    const factory = new XMLInputFactory({ entityResolver: resolver, accessExternalEntities: 'all' });
    const { handler, calls: out } = recorder(['startElement', 'characters', 'startEntity', 'endEntity']);
    const xml = { systemId: `${BASE}d.xml`, text: '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;</a>' };
    await new SAXParser(factory).parseAsync(xml, handler);
    expect(out).toEqual([
      'startElement(, a, a, [])',
      'startEntity(e)',
      'startElement(, b, b, [])',
      'characters(later)',
      'endEntity(e)',
    ]);
  });

  it('rejects with the XMLError a malformed document raises', async () => {
    const handler: SAXHandler = {};
    await expect(new SAXParser().parseAsync(bytewise('<a>\n<b></a>'), handler)).rejects.toThrow(
      expect.objectContaining({ code: 'WF_END_TAG_MISMATCH', line: 2, column: 6 })
    );
    await expect(new SAXParser().parseAsync(bytewise('<a>'), handler)).rejects.toBeInstanceOf(XMLError);
  });
});
