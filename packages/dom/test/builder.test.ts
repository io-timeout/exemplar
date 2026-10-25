import {
  build,
  buildAsync,
  children,
  domException,
  newDocument,
  serialize,
  streamOf,
  utf16,
  utf8,
} from '@test/helpers/dom.ts';
import { fallingBack, including, resolver, spaceValidator } from '@test/helpers/stubs.ts';
import { describe, expect, it } from 'vitest';
import { XMLError, XMLInputFactory } from '@exemplarjs/xml';
import {
  type Attr,
  type Document,
  DocumentBuilder,
  DOMImplementation,
  type Element,
  type Entity,
  type Notation,
  type Text,
} from '@/index.ts';

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE doc [
<!ENTITY e "<b>bold</b> text">
<!ENTITY t "plain">
<!ELEMENT doc (a|p)*>
<!ATTLIST doc id ID #IMPLIED def CDATA "dflt">
]>
<doc id="d1" xmlns:x="urn:x"><a x:y="1">x&e;y&t;z</a>
  <p><![CDATA[c<d]]><!--c--><?pi data?></p></doc>`;

/** Entities read through a resolver from http://example.com/. */
const EXTERNAL = {
  entityResolver: resolver(
    {
      'e.xml': '<?xml version="1.0" encoding="ISO-8859-1"?><e>ext</e>',
      'r.dtd': '<!ENTITY % pe SYSTEM "pe.ent"> %pe; <!ELEMENT r (e)*><!NOTATION n SYSTEM "n">',
      'pe.ent': '<!ENTITY x "X">',
    },
    'http://example.com/'
  ),
  accessExternalEntities: 'all',
  accessExternalDTD: 'all',
} as const;

/** A document reading the external entities above, its references kept or not. */
function external(replaceEntityReferences: boolean): Document {
  return build(
    {
      systemId: 'http://example.com/doc.xml',
      text: '<!DOCTYPE r SYSTEM "r.dtd" [<!ENTITY ext SYSTEM "e.xml">]><r> &ext;&ext; &x;</r>',
    },
    { ...EXTERNAL, replaceEntityReferences }
  );
}

describe('DocumentBuilder', () => {
  it('uses a default factory and no options of its own', () => {
    const builder = new DocumentBuilder();
    expect(builder.factory).toBeInstanceOf(XMLInputFactory);
    expect(builder.options).toEqual({});
  });

  it('keeps the factory and options it is given', () => {
    const factory = new XMLInputFactory({ coalescing: true });
    const builder = new DocumentBuilder(factory, { ignoringComments: true });
    expect([builder.factory, builder.options]).toEqual([factory, { ignoringComments: true }]);
  });

  it('makes documents with one DOM implementation', () => {
    const builder = new DocumentBuilder();
    expect(builder.domImplementation).toBeInstanceOf(DOMImplementation);
    expect(builder.newDocument().implementation).toBe(builder.domImplementation);
    expect(builder.parse('<r/>').implementation).toBe(builder.domImplementation);
  });

  it('makes an empty document', () => {
    const document = new DocumentBuilder().newDocument();
    expect([document.hasChildNodes(), document.documentURI]).toEqual([false, null]);
  });

  it('throws the XMLError of a document that is not well-formed', () => {
    expect(() => build('<a><b></a>')).toThrow(XMLError);
  });

  it('rejects asynchronously a stream that is not well-formed', async () => {
    const stream = streamOf(utf8('<a><b></a>'), 3);
    await expect(buildAsync(stream)).rejects.toThrow(XMLError);
  });
});

describe('DocumentBuilder.parse: the document', () => {
  it('builds elements, attributes and the document properties', () => {
    const document = build(DOC);
    const root = document.documentElement as Element;
    expect(root.tagName).toBe('doc');
    expect(document.getElementById('d1')).toBe(root);
    expect(root.getAttribute('def')).toBe('dflt');
    expect(root.getAttributeNode('def')?.specified).toBe(false);
    expect(root.getAttributeNode('id')?.isId).toBe(true);
    expect(root.getElementsByTagName('a').item(0)?.getAttributeNS('urn:x', 'y')).toBe('1');
    expect([document.xmlVersion, document.xmlEncoding, document.xmlStandalone]).toEqual(['1.0', 'UTF-8', true]);
  });

  it('gives the version, encoding and standalone of the XML declaration (DOM Level 3 Document)', () => {
    const document = build(utf8('<?xml version="1.1" encoding="utf-8" standalone="no"?><r/>'));
    expect([document.xmlVersion, document.xmlEncoding, document.xmlStandalone, document.inputEncoding]).toEqual([
      '1.1',
      'utf-8',
      false,
      'UTF-8',
    ]);
  });

  it('defaults the properties with no XML declaration', () => {
    const document = build('<r/>');
    expect([document.xmlVersion, document.xmlEncoding, document.xmlStandalone, document.inputEncoding]).toEqual([
      '1.0',
      null,
      false,
      null,
    ]);
  });

  it('gives the encoding detected from the bytes, upper-cased', () => {
    expect(build(utf16('<r/>', true)).inputEncoding).toBe('UTF-16LE');
    expect(build(utf8('<?xml version="1.0" encoding="ISO-8859-1"?><r/>')).inputEncoding).toBe('ISO-8859-1');
  });

  it('takes the document URI from the source system id', () => {
    expect(build({ systemId: 'http://example.com/d.xml', text: '<r/>' }).documentURI).toBe('http://example.com/d.xml');
    expect(build({ text: '<r/>' }).documentURI).toBeNull();
  });

  it('keeps comments and processing instructions before and after the element', () => {
    const document = build('<?a x?><!--b--><r/><?c?><!--d-->');
    expect(children(document)).toEqual(['7:a:x', '8:#comment:b', '1:r:', '7:c:', '8:#comment:d']);
  });

  it('leaves out whitespace outside the element, even when the reader reports it', () => {
    expect(build('  <r/>  ', { reportPrologWhitespace: true }).childNodes).toHaveLength(1);
  });

  it('keeps attribute names like __proto__ and constructor as ordinary attributes', () => {
    const root = build('<r __proto__="p" constructor="c" toString="t" hasOwnProperty="h"/>').documentElement as Element;
    expect([...root.attributes].map((a) => `${a.nodeName}=${a.nodeValue}`)).toEqual([
      '__proto__=p',
      'constructor=c',
      'toString=t',
      'hasOwnProperty=h',
    ]);
    expect(root.getAttribute('__proto__')).toBe('p');
  });
});

describe('DocumentBuilder.parse: namespaces', () => {
  it('gives namespace-aware elements and attributes their namespace, prefix and local name', () => {
    const root = build('<p:r xmlns:p="urn:p" xmlns="urn:d" p:a="1" b="2"><c/></p:r>').documentElement as Element;
    expect([root.namespaceURI, root.prefix, root.localName]).toEqual(['urn:p', 'p', 'r']);
    const a = root.getAttributeNode('p:a') as Attr;
    const b = root.getAttributeNode('b') as Attr;
    expect([a.namespaceURI, a.localName, b.namespaceURI, b.localName]).toEqual(['urn:p', 'a', null, 'b']);
    expect((root.firstChild as Element).namespaceURI).toBe('urn:d');
  });

  it('keeps namespace declarations as attributes in the XMLNS namespace', () => {
    const root = build('<r xmlns="urn:d" xmlns:p="urn:p"/>').documentElement as Element;
    expect([...root.attributes].map((a) => [a.nodeName, a.namespaceURI, a.localName])).toEqual([
      ['xmlns', 'http://www.w3.org/2000/xmlns/', 'xmlns'],
      ['xmlns:p', 'http://www.w3.org/2000/xmlns/', 'p'],
    ]);
  });

  it('gives xml:lang the XML namespace with no declaration', () => {
    const root = build('<r xml:lang="en"/>').documentElement as Element;
    expect(root.getAttributeNodeNS('http://www.w3.org/XML/1998/namespace', 'lang')?.value).toBe('en');
  });

  it('builds DOM Level 1 nodes when not namespace-aware', () => {
    const root = build('<p:r xmlns:p="urn:p" p:a="1"/>', { namespaceAware: false }).documentElement as Element;
    expect([root.nodeName, root.namespaceURI, root.localName, root.prefix]).toEqual(['p:r', null, null, null]);
    const a = root.getAttributeNode('p:a') as Attr;
    expect([a.namespaceURI, a.localName]).toEqual([null, null]);
  });
});

describe('DocumentBuilder.parse: entities', () => {
  it('puts expansions in place of entity references, and keeps the entity nodes', () => {
    const document = build(DOC);
    const a = document.getElementsByTagName('a').item(0) as Element;
    expect(children(a)).toEqual(['3:#text:x', '1:b:bold', '3:#text: textyplainz']);
    const entity = document.doctype?.entities.getNamedItem('e') as Entity;
    expect(children(entity)).toEqual(['1:b:bold', '3:#text: text']);
  });

  it('keeps entity references as read-only nodes when replaceEntityReferences is off', () => {
    const document = build(DOC, { replaceEntityReferences: false });
    const a = document.getElementsByTagName('a').item(0) as Element;
    expect(children(a)).toEqual(['3:#text:x', '5:e:bold text', '3:#text:y', '5:t:plain', '3:#text:z']);
    const text = a.childNodes.item(1)?.lastChild as Text;
    expect(() => text.appendData('!')).toThrow(domException('NoModificationAllowedError'));
  });

  it('nests entity references', () => {
    const document = build('<!DOCTYPE r [<!ENTITY i "<i/>"><!ENTITY o "a&i;b">]><r>&o;</r>', {
      replaceEntityReferences: false,
    });
    const o = document.documentElement?.firstChild as Element;
    expect(children(o)).toEqual(['3:#text:a', '5:i:', '3:#text:b']);
    expect(children(document.doctype?.entities.getNamedItem('o') as Entity)).toEqual([
      '3:#text:a',
      '5:i:',
      '3:#text:b',
    ]);
  });

  it('joins nested expansions to the text around them when references are replaced', () => {
    const document = build('<!DOCTYPE r [<!ENTITY i "<i/>"><!ENTITY o "a&i;b">]><r>x&o;y</r>');
    expect(children(document.documentElement as Element)).toEqual(['3:#text:xa', '1:i:', '3:#text:by']);
  });

  it('copies an entity from its first expansion only', () => {
    const document = build('<!DOCTYPE r [<!ENTITY m "<b/>">]><r>&m;<x/>&m;</r>');
    expect(children(document.doctype?.entities.getNamedItem('m') as Entity)).toEqual(['1:b:']);
  });

  it('leaves an entity whose markup is never referenced empty, as the design says', () => {
    const document = build('<!DOCTYPE r [<!ENTITY m "<b/>"><!ENTITY amp2 "&amp;">]><r/>');
    expect(document.doctype?.entities.getNamedItem('m')?.hasChildNodes()).toBe(false);
    expect(document.doctype?.entities.getNamedItem('amp2')?.hasChildNodes()).toBe(false);
  });

  it('gives an empty entity no children', () => {
    expect(build('<!DOCTYPE r [<!ENTITY e "">]><r/>').doctype?.entities.item(0)?.hasChildNodes()).toBe(false);
  });

  it('keeps an empty, read-only reference to an entity it does not read', () => {
    const document = build('<!DOCTYPE r [<!ENTITY ext SYSTEM "x.xml">]><r>a&ext;b</r>');
    const r = document.documentElement as Element;
    expect(children(r)).toEqual(['3:#text:a', '5:ext:', '3:#text:b']);
    expect(() => r.childNodes.item(1)?.appendChild(document.createTextNode('t'))).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('expands internal parameter entities in the DTD', () => {
    const document = build('<!DOCTYPE r [<!ENTITY % pe "<!ENTITY e \'x\'>"> %pe;]><r>&e;</r>');
    expect(document.documentElement?.textContent).toBe('x');
  });

  it('expands entities in attribute values without making nodes', () => {
    const root = build('<!DOCTYPE r [<!ENTITY t "T">]><r a="&t;!"/>', { replaceEntityReferences: false })
      .documentElement as Element;
    expect(children(root.getAttributeNode('a') as Attr)).toEqual(['3:#text:T!']);
  });

  it('expands entities with markup from character references (§4.6 example)', () => {
    const document = build(
      '<!DOCTYPE r [<!ENTITY e "&#60;t>z&#60;/t>"><!ENTITY f "&lt;t&gt;y&lt;/t&gt;">]><r>&e;&f;</r>'
    );
    expect(children(document.documentElement as Element)).toEqual(['1:t:z', '3:#text:<t>y</t>']);
  });
});

describe('DocumentBuilder.parse: external entities and the DTD', () => {
  it('reads external entities, giving their encodings and version (DOM Level 3 Entity)', () => {
    const ext = external(true).doctype?.entities.getNamedItem('ext') as Entity;
    expect([ext.systemId, ext.inputEncoding, ext.xmlEncoding, ext.xmlVersion]).toEqual([
      'e.xml',
      'ISO-8859-1',
      'ISO-8859-1',
      '1.0',
    ]);
  });

  it('gives an element read from an external entity the base URI of that entity (XML Base §4.2)', () => {
    for (const keep of [true, false]) {
      const e = external(keep).getElementsByTagName('e').item(0) as Element;
      expect(e.baseURI, `references kept: ${keep}`).toBe('http://example.com/e.xml');
    }
  });

  it('gives an element read from an external entity the URI the resolver read the entity from (XML Base §4.2)', () => {
    for (const replaceEntityReferences of [true, false]) {
      const document = build(
        { systemId: 'http://example.com/doc.xml', text: '<!DOCTYPE r [<!ENTITY ext SYSTEM "e.xml">]><r>&ext;</r>' },
        {
          entityResolver: resolver({ 'e.xml': '<e><c/></e>' }, 'http://example.com/sub/'),
          accessExternalEntities: 'all',
          replaceEntityReferences,
        }
      );
      const e = document.getElementsByTagName('e').item(0) as Element;
      const where = `references replaced: ${replaceEntityReferences}`;
      expect([e.baseURI, (e.firstChild as Element).baseURI], where).toEqual([
        'http://example.com/sub/e.xml',
        'http://example.com/sub/e.xml',
      ]);
    }
  });

  it('gives an element read from an external entity of unknown URI the base URI of the element it is referred from (RFC 3986 §5.1.2)', () => {
    for (const replaceEntityReferences of [true, false]) {
      const document = build(
        '<!DOCTYPE r [<!ENTITY ext SYSTEM "e.xml">]><r xml:base="http://example.org/b/">&ext;</r>',
        {
          entityResolver: { resolveEntity: () => ({ text: '<e><c/></e>' }) },
          accessExternalEntities: 'all',
          replaceEntityReferences,
        }
      );
      const e = document.getElementsByTagName('e').item(0) as Element;
      const where = `references replaced: ${replaceEntityReferences}`;
      expect([e.baseURI, (e.firstChild as Element).baseURI], where).toEqual([
        'http://example.org/b/',
        'http://example.org/b/',
      ]);
    }
  });

  it('gives an element of an internal entity the base URI of the element it is referred from', () => {
    for (const replaceEntityReferences of [true, false]) {
      const document = build(
        {
          systemId: 'http://example.com/doc.xml',
          text: '<!DOCTYPE r [<!ENTITY i "<c/>">]><r xml:base="http://example.org/b/">&i;</r>',
        },
        { replaceEntityReferences }
      );
      const where = `references replaced: ${replaceEntityReferences}`;
      expect(document.getElementsByTagName('c').item(0)?.baseURI, where).toBe('http://example.org/b/');
    }
  });

  it("gives an element of an internal entity referred to at the top of an external entity that entity's URI (XML Base §4.2)", () => {
    for (const replaceEntityReferences of [true, false]) {
      const document = build(
        {
          systemId: 'http://example.com/doc.xml',
          text: '<!DOCTYPE r [<!ENTITY i "<c/>"><!ENTITY ext SYSTEM "e.xml">]><r>&ext;</r>',
        },
        {
          entityResolver: resolver({ 'e.xml': '&i;' }, 'http://example.com/sub/'),
          accessExternalEntities: 'all',
          replaceEntityReferences,
        }
      );
      const where = `references replaced: ${replaceEntityReferences}`;
      expect(document.getElementsByTagName('c').item(0)?.baseURI, where).toBe('http://example.com/sub/e.xml');
    }
  });

  it('gives declarations the base URI of the entity they sit in', () => {
    const doctype = external(true).doctype;
    expect(doctype?.notations.getNamedItem('n')?.baseURI).toBe('http://example.com/r.dtd');
    expect(doctype?.entities.getNamedItem('ext')?.baseURI).toBe('http://example.com/doc.xml');
  });

  it('reads declarations from the external subset and its parameter entities', () => {
    const document = external(false);
    expect(document.doctype?.entities.getNamedItem('x')?.textContent).toBe('X');
    expect(document.documentElement?.textContent).toBe('extextX');
  });

  it('marks whitespace in element content declared in the external subset', () => {
    const space = external(true).documentElement?.firstChild as Text;
    expect([space.data, space.isElementContentWhitespace]).toEqual([' ', true]);
  });

  it('keeps the document type as written', () => {
    const doctype = external(true).doctype;
    expect([doctype?.name, doctype?.publicId, doctype?.systemId, doctype?.internalSubset]).toEqual([
      'r',
      null,
      'r.dtd',
      '<!ENTITY ext SYSTEM "e.xml">',
    ]);
  });

  it('gives a document type with an empty internal subset none', () => {
    expect(build('<!DOCTYPE r []><r/>').doctype?.internalSubset).toBeNull();
  });

  it('makes the document type, entities and notations read-only', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "x"><!NOTATION n SYSTEM "n">]><r/>');
    for (const node of [document.doctype, document.doctype?.entities.item(0), document.doctype?.notations.item(0)]) {
      expect(() => node?.appendChild(document.createComment('c'))).toThrow(domException('NoModificationAllowedError'));
    }
  });

  it('gives unparsed entities their notation', () => {
    const document = build('<!DOCTYPE r [<!NOTATION n SYSTEM "n"><!ENTITY u SYSTEM "u" NDATA n>]><r/>');
    const entity = document.doctype?.entities.item(0) as Entity;
    expect(entity.notationName).toBe('n');
  });

  it('gives a notation with only a public identifier no system identifier', () => {
    const notation = build('<!DOCTYPE r [<!NOTATION n PUBLIC "-//N//EN">]><r/>').doctype?.notations.item(0) as Notation;
    expect([notation.publicId, notation.systemId]).toEqual(['-//N//EN', null]);
  });

  it('gives no input encoding to an external entity read from text', () => {
    const document = build('<!DOCTYPE r [<!ENTITY ext SYSTEM "e.xml">]><r>&ext;</r>', {
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'file:///e.xml', text: '<?xml encoding="UTF-8"?><e/>' }) },
    });
    const ext = document.doctype?.entities.item(0) as Entity;
    expect([ext.inputEncoding, ext.xmlEncoding, ext.xmlVersion]).toEqual([null, 'UTF-8', null]);
  });
});

describe('DocumentBuilder.parse: attribute declarations', () => {
  it('gives declared attributes their DTD type, enumerations as NMTOKEN', () => {
    const root = build(
      '<!DOCTYPE r [<!NOTATION n SYSTEM "n"><!ATTLIST r i ID #IMPLIED e (x|y) #IMPLIED t NOTATION (n) #IMPLIED k NMTOKENS #IMPLIED>]><r i="a" e="x" t="n" k="a b" u="z"/>'
    ).documentElement as Element;
    expect(['i', 'e', 't', 'k', 'u'].map((n) => root.getAttributeNode(n)?.schemaTypeInfo.typeName)).toEqual([
      'ID',
      'NMTOKEN',
      'NOTATION',
      'NMTOKENS',
      null,
    ]);
  });

  it('shares one TypeInfo for each type', () => {
    const a = build('<!DOCTYPE r [<!ATTLIST r a CDATA #IMPLIED>]><r a="1"/>').documentElement?.getAttributeNode('a');
    const b = build('<!DOCTYPE s [<!ATTLIST s b CDATA #IMPLIED>]><s b="1"/>').documentElement?.getAttributeNode('b');
    expect(a?.schemaTypeInfo).toBe(b?.schemaTypeInfo);
  });

  it('lets the first declaration of an attribute count (§3.3)', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r a CDATA "first"><!ATTLIST r a CDATA "second">]><r/>');
    expect(document.createElement('r').getAttribute('a')).toBe('first');
  });

  it('keeps no default for an attribute declared with none', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r a CDATA #IMPLIED>]><r a="v"/>');
    document.documentElement?.removeAttribute('a');
    expect(document.documentElement?.hasAttribute('a')).toBe(false);
  });

  it('makes an ID of xml:id, normalized, which getElementById finds', () => {
    const document = build('<doc><para xml:id="  test "/></doc>');
    const para = document.getElementById('test') as Element;
    expect(para.nodeName).toBe('para');
    expect(para.getAttributeNode('xml:id')?.isId).toBe(true);
  });
});

describe('DocumentBuilder.parse: text', () => {
  it('marks whitespace in element content, and leaves it out when asked', () => {
    const document = build(DOC);
    const space = document.documentElement?.childNodes.item(1) as Text;
    expect([space.data, space.isElementContentWhitespace]).toEqual(['\n  ', true]);
    expect(document.documentElement?.textContent).toBe('xbold textyplainzc<d');
    const trimmed = build(DOC, {}, { ignoringElementContentWhitespace: true, ignoringComments: true });
    expect(children(trimmed.documentElement as Element).map((c) => c.slice(0, 3))).toEqual(['1:a', '1:p']);
    expect(children(trimmed.getElementsByTagName('p').item(0) as Element)).toEqual([
      '4:#cdata-section:c<d',
      '7:pi:data',
    ]);
  });

  it('does not mark whitespace in mixed, EMPTY or ANY content', () => {
    const document = build(
      '<!DOCTYPE r [<!ELEMENT r (m|y)*><!ELEMENT m (#PCDATA|y)*><!ELEMENT y ANY>]><r><m> <y> </y></m></r>'
    );
    const m = document.documentElement?.firstChild as Element;
    expect((m.firstChild as Text).isElementContentWhitespace).toBe(false);
    expect(((m.lastChild as Element).firstChild as Text).isElementContentWhitespace).toBe(false);
  });

  it('keeps whitespace that is not in element content when ignoring element content whitespace', () => {
    const document = build(
      '<!DOCTYPE r [<!ELEMENT r (#PCDATA)>]><r> </r>',
      {},
      { ignoringElementContentWhitespace: true }
    );
    expect(document.documentElement?.textContent).toBe(' ');
  });

  it('marks whitespace the validator reports as SPACE, and leaves it out when asked', () => {
    const marked = build('<r> <c/>t</r>', { validator: spaceValidator });
    const space = marked.documentElement?.firstChild as Text;
    expect(space.isElementContentWhitespace).toBe(true);
    const trimmed = build('<r> <c/>t</r>', { validator: spaceValidator }, { ignoringElementContentWhitespace: true });
    expect(children(trimmed.documentElement as Element)).toEqual(['1:c:', '3:#text:t']);
  });

  it('marks nothing without element declarations', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r a CDATA #IMPLIED>]><r> <c/> </r>');
    const space = document.documentElement?.firstChild as Text;
    expect(space.isElementContentWhitespace).toBe(false);
  });

  it('joins CDATA sections to text when coalescing', () => {
    const document = build('<a>x<![CDATA[<y>]]>z</a>', { coalescing: true });
    expect(children(document.documentElement as Element)).toEqual(['3:#text:x<y>z']);
  });

  it('keeps CDATA sections apart from text and from each other when not coalescing', () => {
    const document = build('<r>a<![CDATA[b]]><![CDATA[c]]>d</r>');
    expect(children(document.documentElement as Element)).toEqual([
      '3:#text:a',
      '4:#cdata-section:b',
      '4:#cdata-section:c',
      '3:#text:d',
    ]);
  });

  it('keeps comments, or leaves them out when asked', () => {
    expect(children(build('<r>a<!--c-->b</r>').documentElement as Element)).toEqual([
      '3:#text:a',
      '8:#comment:c',
      '3:#text:b',
    ]);
    const ignoring = build('<!--p--><r>a<!--c-->b</r>', {}, { ignoringComments: true });
    expect(children(ignoring)).toEqual(['1:r:ab']);
    expect(ignoring.documentElement?.childNodes.length).toBe(1);
  });

  it('joins text split by character and entity references', () => {
    const document = build('<!DOCTYPE r [<!ENTITY t "T">]><r>a&amp;b&#65;&t;c</r>');
    expect(children(document.documentElement as Element)).toEqual(['3:#text:a&bATc']);
  });
});

describe('DocumentBuilder.parseAsync', () => {
  it('builds the same tree from a stream', async () => {
    const document = await buildAsync({ stream: streamOf(utf8(DOC), 7) });
    expect(serialize(document)).toBe(serialize(build(DOC)));
  });

  it('builds from a string and from chunks', async () => {
    expect(serialize(await buildAsync('<r>a</r>'))).toBe('<r>a</r>');
    const chunked = await buildAsync([utf8('<r>'), utf8('b</r>')]);
    expect(serialize(chunked)).toBe('<r>b</r>');
  });

  it('takes the document URI from the source', async () => {
    const document = await buildAsync({ systemId: 'http://example.com/s.xml', stream: streamOf(utf8('<r/>'), 2) });
    expect(document.documentURI).toBe('http://example.com/s.xml');
  });
});

describe('DocumentBuilder: declarations XInclude brings in', () => {
  const ENTITY = {
    kind: 'entity',
    declaration: {
      name: 'u',
      isParameterEntity: false,
      systemId: 'u.bin',
      notation: 'n',
      baseURI: 'http://x/',
      declaredExternally: true,
    },
  } as const;
  const NOTATION = { kind: 'notation', declaration: { name: 'n', systemId: 'n.sys', baseURI: 'http://x/' } } as const;

  it('adds them to the document type', () => {
    const document = build('<!DOCTYPE r [<!ENTITY t "x">]><r/>', { xinclude: including([ENTITY, NOTATION]) });
    const doctype = document.doctype;
    expect([...(doctype?.entities ?? [])].map((e) => e.nodeName)).toEqual(['t', 'u']);
    const u = doctype?.entities.getNamedItem('u') as Entity;
    expect([u.systemId, u.notationName, u.baseURI]).toEqual(['u.bin', 'n', 'http://x/']);
    const n = doctype?.notations.getNamedItem('n') as Notation;
    expect([n.systemId, n.baseURI]).toEqual(['n.sys', 'http://x/']);
  });

  it('makes a document type named after the element when there is none', () => {
    const document = build('<!--c--><r/>', { xinclude: including([ENTITY, NOTATION]) });
    expect(children(document)).toEqual(['8:#comment:c', '10:r:null', '1:r:']);
    expect(document.doctype?.entities.length).toBe(1);
  });

  it('merges declarations the document type already has', () => {
    const document = build('<!DOCTYPE r [<!NOTATION n SYSTEM "own"><!ENTITY u SYSTEM "own" NDATA n>]><r/>', {
      xinclude: including([ENTITY, NOTATION]),
    });
    expect([document.doctype?.entities.length, document.doctype?.notations.length]).toEqual([1, 1]);
    const notation = document.doctype?.notations.item(0) as Notation;
    expect(notation.systemId).toBe('own');
  });

  it('makes them read-only, with null for what they lack', () => {
    const bare = [
      { kind: 'entity', declaration: { name: 'b', isParameterEntity: false, declaredExternally: true } },
      { kind: 'notation', declaration: { name: 'm' } },
      { kind: 'comment', text: 'ignored' },
    ] as const;
    const document = build('<r/>', { xinclude: including(bare) });
    const b = document.doctype?.entities.item(0) as Entity;
    expect([b.publicId, b.systemId, b.notationName]).toEqual([null, null, null]);
    const notation = document.doctype?.notations.item(0) as Notation;
    expect(notation.publicId).toBeNull();
    expect(() => b.appendChild(document.createComment('c'))).toThrow(domException('NoModificationAllowedError'));
  });

  it('adds nothing when nothing was brought in', () => {
    expect(build('<r/>', { xinclude: including([]) }).doctype).toBeNull();
  });
});

describe('DocumentBuilder: content XInclude ignores', () => {
  it('makes no entity reference for a reference XInclude ignores at the top of the document (XInclude §3.1)', () => {
    for (const replaceEntityReferences of [true, false]) {
      const document = build('<!DOCTYPE i [<!ENTITY e "x">]><i>&e;<r>t</r>&e;</i>', {
        xinclude: fallingBack,
        replaceEntityReferences,
      });
      const where = `references replaced: ${replaceEntityReferences}`;
      expect(children(document), where).toEqual(['10:i:null', '1:r:t']);
    }
  });
});

describe('DocumentBuilder: a document with no DTD', () => {
  it('gives a document type only when there is a DOCTYPE', () => {
    expect(newDocument().doctype).toBeNull();
    expect(build('<r/>').doctype).toBeNull();
  });
});
