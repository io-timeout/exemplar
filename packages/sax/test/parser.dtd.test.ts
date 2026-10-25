import { recorder } from '@test/helpers/recorder.ts';
import { describe, expect, it } from 'vitest';
import { type DtdItem, type EntityResolver, XMLInputFactory, type XIncludeProcessor } from '@exemplarjs/xml';
import { INCLUDED_DECLARATIONS, StreamReader } from '@exemplarjs/xml/internal';
import { SAXParser } from '@/index.ts';

const BASE = 'http://example.org/docs/';

/** The DeclHandler, DTDHandler and LexicalHandler methods. */
const DTD_METHODS = [
  'startDTD',
  'endDTD',
  'startEntity',
  'endEntity',
  'comment',
  'processingInstruction',
  'elementDecl',
  'attributeDecl',
  'internalEntityDecl',
  'externalEntityDecl',
  'notationDecl',
  'unparsedEntityDecl',
  'skippedEntity',
];

/** The DTD calls a document gives, between startDTD and endDTD, with external access through a memory resolver. */
function dtdCalls(text: string, files: Record<string, string> = {}, resolveDTDURIs = true): string[] {
  const resolver: EntityResolver = {
    resolveEntity(request) {
      const uri = new URL(request.systemId ?? '', request.baseURI).href;
      const found = files[uri];
      return found === undefined ? undefined : { systemId: uri, text: found };
    },
  };
  const factory = new XMLInputFactory({ entityResolver: resolver, accessExternalDTD: 'all' });
  const parser = new SAXParser(factory, { resolveDTDURIs });
  const { handler, calls } = recorder(DTD_METHODS);
  parser.parse({ systemId: `${BASE}doc.xml`, text }, handler);
  return calls.slice(calls.findIndex((call) => call.startsWith('startDTD(')) + 1, calls.indexOf('endDTD()') + 1);
}

describe('the DTD through SAX (LexicalHandler, DeclHandler, DTDHandler)', () => {
  it('reports a parameter entity it does not read as a skipped entity, with a leading % (ContentHandler.skippedEntity)', () => {
    expect(dtdCalls('<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent"> %p;]><a/>')).toContain('skippedEntity(%p)');
    const dtd = '<!ENTITY % q SYSTEM "q.ent"><!ENTITY e "[%q;]">';
    expect(dtdCalls('<!DOCTYPE a SYSTEM "a.dtd"><a/>', { [`${BASE}a.dtd`]: dtd })).toContain('skippedEntity(%q)');
  });

  it('reports the DTD in order, with entity boundaries', () => {
    const { handler, calls } = recorder();
    const xml = `<!DOCTYPE a [
      <!ELEMENT a (#PCDATA|b)*>
      <!ATTLIST a e (x|y) "x" n NOTATION (g) #IMPLIED>
      <!ENTITY % p "<!ENTITY i 'v'>">
      %p;
      <!ENTITY u SYSTEM "u.gif" NDATA g>
      <!NOTATION g SYSTEM "g">
      <!-- in the DTD -->
    ]><a>&i;</a>`;
    new SAXParser().parse({ systemId: 'file:///d/doc.xml', text: xml }, handler);
    expect(calls).toEqual([
      'startDocument()',
      'startDTD(a, undefined, undefined)',
      'elementDecl(a, (#PCDATA|b)*)',
      'attributeDecl(a, e, (x|y), undefined, x)',
      'attributeDecl(a, n, NOTATION (g), #IMPLIED, undefined)',
      "internalEntityDecl(%p, <!ENTITY i 'v'>)",
      'startEntity(%p)',
      'internalEntityDecl(i, v)',
      'endEntity(%p)',
      'unparsedEntityDecl(u, undefined, file:///d/u.gif, g)',
      'notationDecl(g, undefined, file:///d/g)',
      'comment( in the DTD )',
      'endDTD()',
      'startElement(, a, a, [e=x])',
      'startEntity(i)',
      'characters(v)',
      'endEntity(i)',
      'endElement(, a, a)',
      'endDocument()',
    ]);
  });

  it('gives startDTD the root name and the external identifiers as written', () => {
    const { handler, calls } = recorder(['startDTD', 'endDTD']);
    new SAXParser().parse({ systemId: `${BASE}d.xml`, text: '<!DOCTYPE r PUBLIC "-//R//EN" "r.dtd"><r/>' }, handler);
    expect(calls).toEqual(['startDTD(r, -//R//EN, r.dtd)', 'endDTD()']);
  });

  it('calls no DTD methods for a document without a DOCTYPE', () => {
    const { handler, calls } = recorder(DTD_METHODS);
    new SAXParser().parse('<a/>', handler);
    expect(calls).toEqual([]);
  });

  it.each([
    ['CDATA', 'CDATA'],
    ['ID', 'ID'],
    ['IDREF', 'IDREF'],
    ['IDREFS', 'IDREFS'],
    ['ENTITY', 'ENTITY'],
    ['ENTITIES', 'ENTITIES'],
    ['NMTOKEN', 'NMTOKEN'],
    ['NMTOKENS', 'NMTOKENS'],
    ['( x | y )', '(x|y)'],
    ['NOTATION ( n | m )', 'NOTATION (n|m)'],
  ])('reports the attribute type %s as %s (DeclHandler.attributeDecl)', (declared, reported) => {
    const calls = dtdCalls(`<!DOCTYPE a [<!ATTLIST a t ${declared} #IMPLIED>]><a/>`);
    expect(calls).toEqual([`attributeDecl(a, t, ${reported}, #IMPLIED, undefined)`, 'endDTD()']);
  });

  it.each([
    ['#REQUIRED', '#REQUIRED, undefined'],
    ['#IMPLIED', '#IMPLIED, undefined'],
    ['#FIXED "v"', '#FIXED, v'],
    ['"v"', 'undefined, v'],
  ])('reports the default %s as mode and value %s (§3.3.2)', (declared, reported) => {
    const calls = dtdCalls(`<!DOCTYPE a [<!ATTLIST a t CDATA ${declared}>]><a t="v"/>`);
    expect(calls[0]).toBe(`attributeDecl(a, t, CDATA, ${reported})`);
  });

  it('reports a default value normalized for its type (§3.3.3)', () => {
    const calls = dtdCalls('<!DOCTYPE a [<!ATTLIST a t NMTOKENS "  x   y " c CDATA " p\tq ">]><a/>');
    expect(calls.slice(0, 2)).toEqual([
      'attributeDecl(a, t, NMTOKENS, undefined, x y)',
      'attributeDecl(a, c, CDATA, undefined,  p q )',
    ]);
  });

  it.each([
    ['EMPTY', 'EMPTY'],
    ['ANY', 'ANY'],
    ['(#PCDATA)', '(#PCDATA)'],
    ['( #PCDATA | b )*', '(#PCDATA|b)*'],
    ['( b , ( c | d )+ , e? )', '(b,(c|d)+,e?)'],
  ])('reports the content model %s as %s (DeclHandler.elementDecl)', (declared, reported) => {
    expect(dtdCalls(`<!DOCTYPE a [<!ELEMENT a ${declared}>]><a/>`)[0]).toBe(`elementDecl(a, ${reported})`);
  });

  it('reports internal entities with their replacement text, parameter entities named with % (§4.2.1)', () => {
    const calls = dtdCalls('<!DOCTYPE a [<!ENTITY g "x&#38;#38;y"><!ENTITY % p "q&#37;"><!ENTITY r "&g;">]><a/>');
    expect(calls.slice(0, 3)).toEqual([
      'internalEntityDecl(g, x&#38;y)',
      'internalEntityDecl(%p, q%)',
      'internalEntityDecl(r, &g;)',
    ]);
  });

  it('reports external entities with their public id and absolute system id (§4.2.2)', () => {
    const calls = dtdCalls(
      '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml"><!ENTITY f PUBLIC "-//F" "sub/f.xml"><!ENTITY % p SYSTEM "../p.ent">]><a/>'
    );
    expect(calls.slice(0, 3)).toEqual([
      `externalEntityDecl(e, undefined, ${BASE}e.xml)`,
      `externalEntityDecl(f, -//F, ${BASE}sub/f.xml)`,
      'externalEntityDecl(%p, undefined, http://example.org/p.ent)',
    ]);
  });

  it('reports unparsed entities and notations (DTDHandler)', () => {
    const calls = dtdCalls(
      '<!DOCTYPE a [<!NOTATION gif PUBLIC "-//GIF"><!NOTATION png SYSTEM "png.exe"><!NOTATION jpg PUBLIC "-//JPG" "jpg.exe"><!ENTITY pic PUBLIC "-//PIC" "p.gif" NDATA gif>]><a/>'
    );
    expect(calls.slice(0, 4)).toEqual([
      'notationDecl(gif, -//GIF, undefined)',
      `notationDecl(png, undefined, ${BASE}png.exe)`,
      `notationDecl(jpg, -//JPG, ${BASE}jpg.exe)`,
      `unparsedEntityDecl(pic, -//PIC, ${BASE}p.gif, gif)`,
    ]);
  });

  it('reports system ids as written with resolve-dtd-uris off', () => {
    const calls = dtdCalls(
      '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml"><!ENTITY u SYSTEM "u.gif" NDATA n><!NOTATION n SYSTEM "n.exe">]><a/>',
      {},
      false
    );
    expect(calls.slice(0, 3)).toEqual([
      'externalEntityDecl(e, undefined, e.xml)',
      'unparsedEntityDecl(u, undefined, u.gif, n)',
      'notationDecl(n, undefined, n.exe)',
    ]);
  });

  it('keeps a relative system id as written when there is no base URI to resolve it against', () => {
    const { handler, calls } = recorder(['externalEntityDecl']);
    new SAXParser().parse('<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a/>', handler);
    expect(calls).toEqual(['externalEntityDecl(e, undefined, e.xml)']);
  });

  it('reports only the first declaration of an entity or attribute, the one that binds (§4.2, §3.3)', () => {
    const calls = dtdCalls(
      '<!DOCTYPE a [<!ENTITY e "1"><!ENTITY e "2"><!ATTLIST a x CDATA "1"><!ATTLIST a x CDATA "2" y CDATA "3">]><a/>'
    );
    expect(calls).toEqual([
      'internalEntityDecl(e, 1)',
      'attributeDecl(a, x, CDATA, undefined, 1)',
      'attributeDecl(a, y, CDATA, undefined, 3)',
      'endDTD()',
    ]);
  });

  it('reports comments and PIs in the DTD where they are', () => {
    const calls = dtdCalls('<!DOCTYPE a [<!--one--><?p data?><!ELEMENT a ANY><?q?>]><a/>');
    expect(calls).toEqual([
      'comment(one)',
      'processingInstruction(p, data)',
      'elementDecl(a, ANY)',
      'processingInstruction(q, )',
      'endDTD()',
    ]);
  });

  it('reports the external subset as the entity [dtd], after the internal subset (§2.8)', () => {
    const files = {
      [`${BASE}a.dtd`]:
        '<?xml encoding="UTF-8"?><!ELEMENT a EMPTY><!--ext--><?pe x?><!ENTITY % q SYSTEM "sub/q.ent">%q;',
      [`${BASE}sub/q.ent`]: '<!ENTITY z "from q">',
    };
    const calls = dtdCalls('<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY i "internal">]><a/>', files);
    expect(calls).toEqual([
      'internalEntityDecl(i, internal)',
      'startEntity([dtd])',
      'elementDecl(a, EMPTY)',
      'comment(ext)',
      'processingInstruction(pe, x)',
      `externalEntityDecl(%q, undefined, ${BASE}sub/q.ent)`,
      'startEntity(%q)',
      'internalEntityDecl(z, from q)',
      'endEntity(%q)',
      'endEntity([dtd])',
      'endDTD()',
    ]);
  });

  it('reports declarations from an included conditional section only (§3.4)', () => {
    const files = { [`${BASE}a.dtd`]: '<![INCLUDE[<!ENTITY in "yes">]]><![IGNORE[<!ENTITY out "no">]]>' };
    expect(dtdCalls('<!DOCTYPE a SYSTEM "a.dtd"><a/>', files)).toEqual([
      'startEntity([dtd])',
      'internalEntityDecl(in, yes)',
      'endEntity([dtd])',
      'endDTD()',
    ]);
  });

  it('nests parameter entity boundaries as the references nest', () => {
    const calls = dtdCalls(
      '<!DOCTYPE a [<!ENTITY % inner "<!ENTITY x \'1\'>"><!ENTITY % outer "&#37;inner;<!ENTITY y \'2\'>"> %outer;]><a/>'
    );
    expect(calls.slice(2)).toEqual([
      'startEntity(%outer)',
      'startEntity(%inner)',
      'internalEntityDecl(x, 1)',
      'endEntity(%inner)',
      'internalEntityDecl(y, 2)',
      'endEntity(%outer)',
      'endDTD()',
    ]);
  });

  it('reports the DTD to a handler with startEntity but no endEntity, and the other way round', () => {
    const xml = '<!DOCTYPE a [<!ENTITY % p "<!ENTITY i \'v\'>"> %p;]><a>&i;</a>';
    const started = recorder(['startEntity']);
    new SAXParser().parse(xml, started.handler);
    expect(started.calls).toEqual(['startEntity(%p)', 'startEntity(i)']);
    const ended = recorder(['endEntity']);
    new SAXParser().parse(xml, ended.handler);
    expect(ended.calls).toEqual(['endEntity(%p)', 'endEntity(i)']);
  });
});

describe('declarations XInclude adds as it includes', () => {
  /** A reader standing in for XInclude's, whose included declarations grow as the test adds to them. */
  function includingFactory(included: DtdItem[]): XMLInputFactory {
    const processor: XIncludeProcessor = {
      createReader: (_source, opened, options, registry, input) =>
        new (class extends StreamReader {
          override [INCLUDED_DECLARATIONS](): readonly DtdItem[] {
            return included;
          }
        })(opened, options, registry, input),
    };
    return new XMLInputFactory({ xinclude: processor });
  }

  it('reports the declarations added since the last start tag before the next one', () => {
    const included: DtdItem[] = [
      { kind: 'notation', declaration: { name: 'n', systemId: 'n.exe', baseURI: `${BASE}inc.xml` } },
    ];
    const { handler, calls } = recorder(['startElement', 'notationDecl', 'unparsedEntityDecl']);
    const record = handler.startElement?.bind(handler);
    handler.startElement = (uri, localName, qName, attributes) => {
      record?.(uri, localName, qName, attributes);
      if (localName === 'a') {
        included.push({
          kind: 'entity',
          declaration: {
            name: 'u',
            isParameterEntity: false,
            systemId: 'u.gif',
            notation: 'n',
            declaredExternally: false,
          },
        });
      }
    };
    new SAXParser(includingFactory(included)).parse('<a><b/><c/></a>', handler);
    expect(calls).toEqual([
      `notationDecl(n, undefined, ${BASE}n.exe)`,
      'startElement(, a, a, [])',
      'unparsedEntityDecl(u, undefined, u.gif, n)',
      'startElement(, b, b, [])',
      'startElement(, c, c, [])',
    ]);
  });

  it('reports every kind of declaration it is given', () => {
    const included: DtdItem[] = [
      { kind: 'element', declaration: { name: 'e', content: 'EMPTY', declaredExternally: false } },
      {
        kind: 'attribute',
        declaration: { element: 'e', name: 'x', type: 'ENUMERATION', mode: 'IMPLIED', declaredExternally: false },
      },
      { kind: 'entity', declaration: { name: 'p', isParameterEntity: true, declaredExternally: true } },
      { kind: 'pi', target: 't', data: 'd' },
      { kind: 'comment', text: 'c' },
      { kind: 'startEntity', name: 's' },
      { kind: 'endEntity', name: 's' },
    ];
    const { handler, calls } = recorder();
    new SAXParser(includingFactory(included)).parse('<a/>', handler);
    expect(calls.slice(1, 8)).toEqual([
      'elementDecl(e, EMPTY)',
      'attributeDecl(e, x, (), #IMPLIED, undefined)',
      'externalEntityDecl(%p, undefined, )',
      'processingInstruction(t, d)',
      'comment(c)',
      'startEntity(s)',
      'endEntity(s)',
    ]);
  });
});
