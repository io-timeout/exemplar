import { errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, XMLInputFactory } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** Each start tag as `{uri}local` followed by its attributes the same way, every way the document can be read. */
function expanded(xml: string, options: InputOptions = {}): string[] {
  parseEveryWay(xml, options);
  const r = reader(xml, options);
  const out: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
    if (e !== EventType.START_ELEMENT) continue;
    const attributes = Array.from(
      { length: r.attributeCount() },
      (_, i) => ` {${r.attributeNamespace(i)}}${r.attributeLocalName(i)}`
    );
    out.push(`{${r.namespaceURI()}}${r.localName()}${attributes.join('')}`);
  }
  return out;
}

/** Each end tag as `{uri}local` and the declarations going out of scope with it. */
function ends(xml: string): string[] {
  const r = reader(xml);
  const out: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
    if (e !== EventType.END_ELEMENT) continue;
    const declarations = Array.from(
      { length: r.namespaceCount() },
      (_, i) => ` ${r.namespacePrefix(i)}=${r.namespaceURI(i)}`
    );
    out.push(`{${r.namespaceURI()}}${r.localName()}${declarations.join('')}`);
  }
  return out;
}

describe('namespace scope through the cursor (Namespaces §6)', () => {
  it('binds xml without a declaration, for elements and attributes', () => {
    expect(expanded("<root xml:lang='en'/>")).toEqual([`{}root {${XML}}lang`]);
    expect(expanded('<xml:root/>')).toEqual([`{${XML}}root`]);
  });

  it('applies a declaration to the start tag that makes it, whatever the attribute order', () => {
    expect(expanded('<o:c b="B" xmlns:o="O"/>')).toEqual(['{O}c {}b']);
    expect(expanded('<p a:attr="v" xmlns:a="http://A"/>')).toEqual(['{}p {http://A}attr']);
    expect(expanded('<p xmlns:a="http://A" a:attr="v"/>')).toEqual(['{}p {http://A}attr']);
  });

  it('puts unprefixed attributes in no namespace, even under a default namespace (§6.2)', () => {
    expect(expanded("<elm xmlns='http://foo' attr='bar'/>")).toEqual(['{http://foo}elm {}attr']);
    expect(expanded('<f xmlns="A" xmlns:m="M" id="x" m:t="y"/>')).toEqual(['{A}f {}id {M}t']);
  });

  it('ends a default namespace with the element that declares it', () => {
    expect(expanded('<root><n xmlns="u:d"><plain/></n><plain/></root>')).toEqual([
      '{}root',
      '{u:d}n',
      '{u:d}plain',
      '{}plain',
    ]);
  });

  it('restores a shadowed prefix when the inner declaration goes out of scope', () => {
    const xml = '<r xmlns:x="x1" xmlns:y="y1"><q xmlns:x="x2"><c x:a="" y:a=""/></q><c x:a=""/></r>';
    expect(expanded(xml)).toEqual(['{}r', '{}q', '{}c {x2}a {y1}a', '{}c {x1}a']);
    const nested = '<r xmlns:a="A"><a:x xmlns:a="R"><a:y/></a:x><a:z/><a:y/></r>';
    expect(expanded(nested)).toEqual(['{}r', '{R}x', '{R}y', '{A}z', '{A}y']);
  });

  it('keeps an element’s namespace at its end tag, after its children redeclared the prefix', () => {
    const xml = '<r xmlns:p="urn:p0"><p:a><b xmlns="urn:inner" xmlns:p="urn:p1"><p:c/></b><p:d/></p:a></r>';
    expect(expanded(xml)).toEqual(['{}r', '{urn:p0}a', '{urn:inner}b', '{urn:p1}c', '{urn:p0}d']);
    expect(ends(xml)).toEqual([
      '{urn:p1}c',
      '{urn:inner}b =urn:inner p=urn:p1',
      '{urn:p0}d',
      '{urn:p0}a',
      '{}r p=urn:p0',
    ]);
  });

  it('reports the namespace an element had at its start again at its end', () => {
    expect(ends('<root xmlns:p="urn:outer"><p:item xmlns:p="urn:inner"/><p:item/></root>')).toEqual([
      '{urn:inner}item p=urn:inner',
      '{urn:outer}item',
      '{}root p=urn:outer',
    ]);
  });

  it('gives children without a prefix no namespace when only prefixes are declared', () => {
    expect(expanded('<rss xmlns:atom="A"><channel/></rss>')).toEqual(['{}rss', '{}channel']);
    expect(expanded('<foo:r xmlns:foo="F" xmlns:bar="B"><bar:o><n/></bar:o></foo:r>')).toEqual(['{F}r', '{B}o', '{}n']);
  });

  it('treats a prefix as a name for its namespace only: two prefixes can name one namespace', () => {
    expect(expanded('<f xmlns="A" xmlns:a="A"><a:t/><t/></f>')).toEqual(['{A}f', '{A}t', '{A}t']);
    expect(expanded('<x xmlns="A" xmlns:a="A" t="1" a:t="2"/>')).toEqual(['{A}x {}t {A}t']);
  });

  it('rejects a prefix after the element that declared it has ended (NSC: Prefix Declared)', () => {
    expect(errorOf('<r xmlns:a="A"><a:x xmlns:b="U"/><b:y/></r>')).toMatchObject({
      code: 'NS_UNBOUND_PREFIX',
      line: 1,
      column: 35,
    });
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'never finds the prefix %s through an object prototype',
    (prefix) => {
      expect(errorOf(`<foo xmlns="X"><${prefix}:u/></foo>`).code).toBe('NS_UNBOUND_PREFIX');
      expect(errorOf(`<f:f xmlns:f="F" ${prefix}:b="1"/>`).code).toBe('NS_UNBOUND_PREFIX');
    }
  );

  it('does not namespace-process attribute values', () => {
    expect(expanded('<r xsi:type="bar:Bar" xmlns:xsi="x"/>')).toEqual(['{}r {x}type']);
  });

  it('allows prefixes made of any NCName characters', () => {
    expect(expanded('<r xmlns:color_1-.0="u"><color_1-.0:e/></r>')).toEqual(['{}r', '{u}e']);
  });

  it('accepts xmlns as an element name with no prefix', () => {
    expect(expanded('<xmlns/>')).toEqual(['{}xmlns']);
  });

  it('lets XML 1.1 undeclare a prefix for the element’s content only (Namespaces 1.1 §5)', () => {
    const xml = '<?xml version="1.1"?><r xmlns:p="u"><s xmlns:p=""/><p:x/></r>';
    expect(expanded(xml)).toEqual(['{}r', '{}s', '{u}x']);
    expect(errorOf('<?xml version="1.1"?><r xmlns:p="u"><s xmlns:p=""><p:x/></s></r>').code).toBe('NS_UNBOUND_PREFIX');
  });

  it('uses the normalized attribute value as the namespace name', () => {
    expect(expanded('<r xmlns:p="a&amp;b"><p:x/></r>')).toEqual(['{}r', '{a&b}x']);
    expect(expanded('<!DOCTYPE r [<!ENTITY u "x">]><r xmlns:p="urn:&u;"><p:a/></r>')).toEqual(['{}r', '{urn:x}a']);
  });

  it('reads thousands of nested scopes in linear time', () => {
    const depth = 3000;
    const open = Array.from({ length: depth }, (_, i) => `<p${i}:e xmlns:p${i}="urn:${i}">`).join('');
    const close = Array.from({ length: depth }, (_, i) => `</p${depth - 1 - i}:e>`).join('');
    const r = reader(`${open}${close}`, { limits: { elementDepth: depth } });
    let last = '';
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next())
      if (e === EventType.END_ELEMENT) last = r.namespaceURI();
    expect(last).toBe('urn:0');
  });

  it('resolves each of many nested scopes', () => {
    const depth = 90;
    const open = Array.from({ length: depth }, (_, i) => `<p${i}:e xmlns:p${i}="urn:${i}">`).join('');
    const close = Array.from({ length: depth }, (_, i) => `</p${depth - 1 - i}:e>`).join('');
    const names = expanded(`${open}${close}`);
    expect(names[0]).toBe('{urn:0}e');
    expect(names.at(-1)).toBe(`{urn:${depth - 1}}e`);
  });
});

describe('namespace declarations through the cursor', () => {
  it('lists the declarations of a start tag in order, the default namespace with the empty prefix', () => {
    const r = reader('<r xmlns:p="u" xmlns="d" a="1"/>');
    r.next();
    expect([
      r.namespaceCount(),
      r.namespacePrefix(0),
      r.namespaceURI(0),
      r.namespacePrefix(1),
      r.namespaceURI(1),
    ]).toEqual([2, 'p', 'u', '', 'd']);
    expect(r.attributeCount()).toBe(1);
  });

  it('throws a RangeError for a declaration index out of range', () => {
    const r = reader('<r xmlns:p="u"/>');
    r.next();
    for (const index of [1, -1]) {
      expect(() => r.namespacePrefix(index)).toThrow(RangeError);
      expect(() => r.namespaceURI(index)).toThrow(RangeError);
    }
  });

  it('reports xmlns attributes in the xmlns namespace when namespacePrefixes is on (SAX namespace-prefixes)', () => {
    const r = reader('<r xmlns:p="u" xmlns="d"/>', { namespacePrefixes: true });
    r.next();
    const attributes = Array.from({ length: r.attributeCount() }, (_, i) => [
      r.attributeName(i),
      r.attributePrefix(i),
      r.attributeLocalName(i),
      r.attributeNamespace(i),
    ]);
    expect(attributes).toEqual([
      ['xmlns:p', 'xmlns', 'p', XMLNS],
      ['xmlns', '', 'xmlns', XMLNS],
    ]);
    expect(r.namespaceCount()).toBe(2);
  });

  it('reads names as plain XML names when namespaceAware is off', () => {
    const r = reader('<p:raw xmlns:x="u" a:b:c="1"><:b/></p:raw>', { namespaceAware: false });
    r.next();
    expect([r.name(), r.localName(), r.prefix(), r.namespaceURI(), r.namespaceCount()]).toEqual([
      'p:raw',
      'p:raw',
      '',
      '',
      0,
    ]);
    expect([r.attributeCount(), r.attributeName(1), r.attributeLocalName(1), r.attributePrefix(1)]).toEqual([
      2,
      'a:b:c',
      'a:b:c',
      '',
    ]);
    expect(r.attributeNamespace(0)).toBe('');
    expect(() => r.namespaceURI(0)).toThrow(RangeError);
    r.next();
    expect(r.name()).toBe(':b');
  });

  it('accepts what only namespaces forbid when namespaceAware is off', () => {
    const off = { namespaceAware: false };
    expect(parseEveryWay('<r xmlns:x="u" xmlns:y="u"><c x:a="" y:a=""/></r>', off)).toBe(
      '<r xmlns:x="u" xmlns:y="u"><c x:a="" y:a=""></c></r>'
    );
    expect(parseEveryWay('<_a><:b></:b><?a:b?></_a>', off)).toBe('<_a><:b></:b><?a:b ?></_a>');
    expect(parseEveryWay('<!DOCTYPE r [<!ENTITY a:b "x">]><r>&a:b;</r>', off)).toBe('<r>x</r>');
  });
});

describe('namespaces in start tags read from the DTD’s view (attributes listed as strings)', () => {
  const DTD = '<!DOCTYPE r [<!ATTLIST r d CDATA "1"><!ATTLIST p:e d CDATA "1">]>';

  it('resolves prefixes in a start tag that has defaulted attributes', () => {
    expect(expanded(`${DTD}<r xmlns:p="urn:p" p:x="1"><p:e/></r>`)).toEqual(['{}r {urn:p}x {}d', '{urn:p}e {}d']);
  });

  it('applies a namespace declaration whose value refers to an entity', () => {
    expect(expanded('<!DOCTYPE r [<!ENTITY u "urn:u">]><r xmlns="&u;"><e/></r>')).toEqual(['{urn:u}r', '{urn:u}e']);
  });

  it('applies a defaulted default namespace to the element and its children', () => {
    expect(expanded('<!DOCTYPE r [<!ATTLIST r xmlns CDATA "urn:d">]><r><e/></r>')).toEqual(['{urn:d}r', '{urn:d}e']);
  });

  it.each([
    [`${DTD}<r xmlns:p=""/>`, 'NS_UNDECLARED_PREFIX'],
    [`${DTD}<r xmlns:xmlns="u"/>`, 'NS_RESERVED'],
    [`${DTD}<r q:x="1"/>`, 'NS_UNBOUND_PREFIX'],
    [`${DTD}<q:r/>`, 'NS_UNBOUND_PREFIX'],
    [`${DTD}<r xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/>`, 'NS_DUPLICATE_ATTRIBUTE'],
  ])('checks the namespace rules there too: %s', (xml, code) => {
    expect(errorOf(xml).code).toBe(code);
  });

  it('lists every attribute as given when namespaceAware is off', () => {
    const r = reader(`${DTD}<r xmlns:p="u" p:x="2"/>`, { namespaceAware: false });
    r.next();
    r.next();
    const attributes = Array.from({ length: r.attributeCount() }, (_, i) => [
      r.attributeName(i),
      r.attributeLocalName(i),
      r.attributePrefix(i),
      r.attributeNamespace(i),
    ]);
    expect(attributes).toEqual([
      ['xmlns:p', 'xmlns:p', '', ''],
      ['p:x', 'p:x', '', ''],
      ['d', 'd', '', ''],
    ]);
  });

  it('reports xmlns attributes among them when namespacePrefixes is on', () => {
    const r = reader(`${DTD}<r xmlns:p="u"/>`, { namespacePrefixes: true });
    r.next();
    r.next();
    expect(Array.from({ length: r.attributeCount() }, (_, i) => r.attributeNamespace(i))).toEqual([XMLNS, '']);
  });
});

describe('attributes with the same expanded name (NSC: Attributes Unique)', () => {
  it('rejects one in the last place of a tag with many attributes', () => {
    for (const count of [15, 16, 17, 32, 64]) {
      const attributes = Array.from({ length: count }, (_, i) => ` p:a${i}="1"`).join('');
      expect(errorOf(`<r xmlns:p="u" xmlns:q="u"${attributes} q:a${count - 1}="2"/>`).code).toBe(
        'NS_DUPLICATE_ATTRIBUTE'
      );
    }
  });

  it('accepts many distinct attributes in consecutive elements, without false duplicates', () => {
    const elements = Array.from({ length: 19 }, (_, n) => {
      const attributes = Array.from({ length: 15 + n }, (_, i) => ` p:a${i}="1" a${i}="2"`).join('');
      return `<e${attributes}/>`;
    });
    expect(() => parseEveryWay(`<r xmlns:p="u">${elements.join('')}</r>`)).not.toThrow();
  });

  it('accepts names whose hashes collide', () => {
    const attributes = Array.from({ length: 20 }, (_, i) => ` x${i}="1"`).join('');
    expect(() => parseEveryWay(`<r${attributes} aahorqvqp="1" aupstazkt="2"/>`)).not.toThrow();
  });

  it('accepts the same local name in no namespace and in a namespace', () => {
    const attributes = Array.from({ length: 20 }, (_, i) => ` x${i}="1"`).join('');
    expect(expanded(`<r xmlns:p="u"${attributes} a="1" p:a="2"/>`)[0]).toMatch(/ \{\}a \{u\}a$/);
  });

  it('is checked by expanded name, not by prefix, after the prefixes are resolved', () => {
    const factory = new XMLInputFactory();
    /** Reads a document to its end. */
    const read = (xml: string) => () => {
      const r = factory.createStreamReader(xml);
      while (r.next() !== EventType.END_DOCUMENT);
    };
    expect(read('<r xmlns:x="u" xmlns:y="v"><c x:a="" y:a=""/></r>')).not.toThrow();
    expect(read('<r xmlns:x="u"><c xmlns:y="u" x:a="" y:a=""/></r>')).toThrow(
      expect.objectContaining({ code: 'NS_DUPLICATE_ATTRIBUTE', column: 38 })
    );
  });
});

describe('declarations checked in start tags read from spans (Namespaces §3)', () => {
  it.each([
    ['<r xmlns:xmlns="u"/>', 'NS_RESERVED', 4],
    ['<r xmlns:xml="urn:other"/>', 'NS_RESERVED', 4],
    [`<r xmlns:p="${XML}"/>`, 'NS_RESERVED', 4],
    [`<r xmlns="${XML}"/>`, 'NS_RESERVED', 4],
    [`<r xmlns:p="${XMLNS}"/>`, 'NS_RESERVED', 4],
    [`<r xmlns="${XMLNS}"/>`, 'NS_RESERVED', 4],
    ['<r a="1" xmlns:p=""/>', 'NS_UNDECLARED_PREFIX', 10],
    ['<xmlns:a/>', 'NS_RESERVED', 2],
    ['<r xmlns:="u"/>', 'NS_QNAME', 4],
    ['<r xmlns:a:b="u"/>', 'NS_QNAME', 4],
  ])('rejects %s', (xml, code, column) => {
    expect(errorOf(xml)).toMatchObject({ code, line: 1, column });
  });

  it.each([[`<r xmlns:xml="${XML}"/>`], ['<r xmlns:xm="u" xmlns:xmlx="v" xmlns:x="w"/>'], ['<r xmlns:p="u&#x20;"/>']])(
    'accepts %s',
    (xml) => {
      expect(() => parseEveryWay(xml)).not.toThrow();
    }
  );

  it('compares a value with references to the reserved names after normalizing it', () => {
    expect(errorOf('<r xmlns:p="http://www.w3.org/XML/1998/namespac&#x65;"/>').code).toBe('NS_RESERVED');
    expect(expanded('<r xmlns:xml="http://www.w3.org/XML/1998/&#x6E;amespace" xml:a="1"/>')).toEqual([`{}r {${XML}}a`]);
    expect(expanded('<r xmlns:p="&#x20;\n" p:a="1"/>')).toEqual(['{}r {  }a']);
  });

  it('checks the local part of a prefixed name starts a name, outside ASCII too (Namespaces §4)', () => {
    expect(expanded('<p:é xmlns:p="u"/>')).toEqual(['{u}é']);
    expect(expanded('<p:𐀀 xmlns:p="u" p:𐀁="1"/>')).toEqual(['{u}𐀀 {u}𐀁']);
    expect(errorOf('<p:· xmlns:p="u"/>').code).toBe('NS_QNAME');
    expect(errorOf('<p:a xmlns:p="u" p:\u0300="1"/>').code).toBe('NS_QNAME');
  });
});

describe('start tags that repeat the one before', () => {
  it('declare the same bindings again for each sibling, and drop them after each', () => {
    const tag = '<e xmlns:p="urn:p" xmlns="urn:d" p:x="1"/>';
    expect(expanded(`<r>${tag}${tag}<f/>${tag}<p:g xmlns:p="urn:q"/>${tag}</r>`)).toEqual([
      '{}r',
      '{urn:d}e {urn:p}x',
      '{urn:d}e {urn:p}x',
      '{}f',
      '{urn:d}e {urn:p}x',
      '{urn:q}g',
      '{urn:d}e {urn:p}x',
    ]);
  });

  it('declare them again for a child that repeats its parent', () => {
    const open = '<e xmlns:p="urn:p" p:x="1">';
    expect(expanded(`<r>${open}${open}<p:c/></e></e>${open}</e></r>`)).toEqual([
      '{}r',
      '{}e {urn:p}x',
      '{}e {urn:p}x',
      '{urn:p}c',
      '{}e {urn:p}x',
    ]);
  });

  it('check a repeated declaration again in a scope that makes it wrong', () => {
    const tag = '<e xmlns:p="u" p:x="1" q:y="2"/>';
    expect(expanded(`<r xmlns:q="v">${tag}${tag}</r>`)).toEqual(['{}r', '{}e {u}x {v}y', '{}e {u}x {v}y']);
    expect(errorOf(`<r><s xmlns:q="v">${tag}</s>${tag}</r>`).code).toBe('NS_UNBOUND_PREFIX');
  });
});
