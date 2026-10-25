import { parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { AttributeList } from '@/cursor/attributes.ts';
import { EventType, XMLError, XMLInputFactory } from '@/index.ts';
import { NamespaceBindings } from '@/namespaces/namespaces.ts';

/** Reads to the first start tag. */
function start(xml: string, options = {}) {
  const r = reader(xml, options);
  while (r.next() !== EventType.START_ELEMENT);
  return r;
}

describe('attribute defaults (§3.3.2)', () => {
  it('adds defaulted and fixed attributes the start tag leaves out, as not specified', () => {
    const r = start('<!DOCTYPE a [<!ATTLIST a x CDATA "1" y CDATA #FIXED "2" z CDATA #IMPLIED>]><a x="0"/>');
    const attributes = Array.from({ length: r.attributeCount() }, (_, i) => [
      r.attributeName(i),
      r.attributeValue(i),
      r.isAttributeSpecified(i),
    ]);
    expect(attributes).toEqual([
      ['x', '0', true],
      ['y', '2', false],
    ]);
  });

  it('keeps the first declaration of an attribute (§3.3)', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ATTLIST a x CDATA "1"><!ATTLIST a x CDATA "2">]><a/>')).toBe('<a x="1"></a>');
  });

  it('expands entities in default values', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ENTITY e "v"><!ATTLIST a x CDATA "[&e;]">]><a/>')).toBe('<a x="[v]"></a>');
  });

  it('defaults a namespace declaration, which then applies to the element', () => {
    const r = start('<!DOCTYPE p:a [<!ATTLIST p:a xmlns:p CDATA "urn:p">]><p:a/>');
    expect([r.localName(), r.namespaceURI(), r.namespaceCount(), r.attributeCount()]).toEqual(['a', 'urn:p', 1, 0]);
  });

  it('does not apply attribute-list declarations after an unread parameter entity (§5.1)', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ENTITY % e SYSTEM "e.dtd"> %e; <!ATTLIST a x CDATA "1">]><a/>')).toBe(
      '<a></a>'
    );
  });
});

describe('attribute types (§3.3.1, §3.3.3)', () => {
  it('normalizes values of tokenized types: no leading or trailing spaces, single spaces between', () => {
    const xml = '<!DOCTYPE a [<!ATTLIST a t NMTOKENS #IMPLIED c CDATA #IMPLIED>]><a t="  x   y  " c="  x   y  "/>';
    expect(parseEveryWay(xml)).toBe('<a c="  x   y  " t="x y"></a>');
  });

  it('normalizes tokenized defaults too', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ATTLIST a t NMTOKENS " x  y ">]><a/>')).toBe('<a t="x y"></a>');
  });

  it('reports declared types, CDATA for undeclared attributes and NMTOKEN for enumerations', () => {
    const xml =
      '<!DOCTYPE a [<!ATTLIST a i ID #IMPLIED e (p|q) #IMPLIED n NOTATION (gif) #IMPLIED>]><a i="x" e="p" n="gif" u="1"/>';
    const r = start(xml);
    expect(Array.from({ length: r.attributeCount() }, (_, i) => r.attributeType(i))).toEqual([
      'ID',
      'NMTOKEN',
      'NOTATION',
      'CDATA',
    ]);
  });
});

describe('start tags whose attributes are listed as strings', () => {
  const DTD = '<!DOCTYPE a [<!ATTLIST a d CDATA "1" t (x|y) "x" i ID #IMPLIED>]>';

  it('throw a RangeError for an attribute index out of range', () => {
    const r = start(`${DTD}<a/>`);
    expect(r.attributeCount()).toBe(2);
    for (const index of [2, 9, -1]) {
      expect(() => r.attributeName(index)).toThrow(RangeError);
      expect(() => r.attributeLocalName(index)).toThrow(RangeError);
      expect(() => r.attributePrefix(index)).toThrow(RangeError);
      expect(() => r.attributeNamespace(index)).toThrow(RangeError);
      expect(() => r.attributeValue(index)).toThrow(RangeError);
      expect(() => r.attributeType(index)).toThrow(RangeError);
      expect(() => r.isAttributeSpecified(index)).toThrow(RangeError);
    }
  });

  it('list a start tag whose values refer to entities, with no DTD to declare its attributes', () => {
    const r = start('<!DOCTYPE a [<!ENTITY e "v">]><a xmlns:p="u" p:x="&e;" y="&amp;"/>');
    expect([r.attributeCount(), r.attributeValue('u', 'x'), r.attributeValue('', 'y'), r.attributeType(0)]).toEqual([
      2,
      'v',
      '&',
      'CDATA',
    ]);
  });

  it('find attributes by namespace and local name', () => {
    const r = start(`${DTD}<a xmlns:p="u" p:d="2"/>`);
    expect([r.attributeValue('u', 'd'), r.attributeValue('', 'd'), r.attributeValue('', 'z')]).toEqual([
      '2',
      '1',
      undefined,
    ]);
  });
});

describe('xml:id', () => {
  /** The xml:id errors a document reports, with a handler that lets parsing go on. */
  const errors = (xml: string): string[] => {
    const codes: string[] = [];
    const reader = new XMLInputFactory({ errorHandler: { error: (e) => codes.push(e.code) } }).createStreamReader(xml);
    while (reader.next() !== EventType.END_DOCUMENT);
    return codes;
  };

  it('reads xml:id as an ID, its value normalized', () => {
    const reader = new XMLInputFactory().createStreamReader('<a xml:id="  x1 "/>');
    reader.next();
    expect([reader.attributeValue(0), reader.attributeType(0)]).toEqual(['x1', 'ID']);
  });

  it('reports a value that is not an NCName, a declaration of another type, and duplicates', () => {
    expect(errors('<a xml:id="x y"/>')).toEqual(['XMLID_NAME']);
    expect(errors('<!DOCTYPE a [<!ATTLIST a xml:id NMTOKEN #IMPLIED>]><a xml:id="x"/>')).toEqual(['XMLID_TYPE']);
    expect(errors('<a xml:id="x"><b xml:id="x"/></a>')).toEqual(['XMLID_DUPLICATE']);
    expect(errors('<a xml:id="x"><b xml:id="y"/></a>')).toEqual([]);
  });

  it('throws by default, as a validity error does', () => {
    const reader = new XMLInputFactory().createStreamReader('<a xml:id="1"/>');
    expect(() => reader.next()).toThrow(XMLError);
  });
});

describe('xml:id and declared IDs', () => {
  const errors = (xml: string): string[] => {
    const codes: string[] = [];
    const reader = new XMLInputFactory({ errorHandler: { error: (e) => codes.push(e.code) } }).createStreamReader(xml);
    while (reader.next() !== EventType.END_DOCUMENT);
    return codes;
  };
  const DTD = '<!DOCTYPE a [<!ATTLIST b id ID #IMPLIED>]>';

  it('reports an xml:id that repeats a declared ID, either way round', () => {
    expect(errors(`${DTD}<a><b id="x"/><c xml:id="x"/></a>`)).toEqual(['XMLID_DUPLICATE']);
    expect(errors(`${DTD}<a><c xml:id="x"/><b id="x"/></a>`)).toEqual(['XMLID_DUPLICATE']);
  });

  it('leaves repeated declared IDs to the validator', () => {
    expect(errors(`${DTD}<a><b id="x"/><b id="x"/></a>`)).toEqual([]);
  });
});

describe('xml:id in listed start tags', () => {
  /** The xml:id errors a document reports, with a handler that lets parsing go on. */
  const errors = (xml: string): string[] => {
    const codes: string[] = [];
    const reader = new XMLInputFactory({ errorHandler: { error: (e) => codes.push(e.code) } }).createStreamReader(xml);
    while (reader.next() !== EventType.END_DOCUMENT);
    return codes;
  };

  it('normalizes and checks an xml:id among attributes listed for the DTD', () => {
    const r = start('<!DOCTYPE a [<!ATTLIST a xml:id ID #IMPLIED d CDATA "1">]><a xml:id=" x "/>');
    expect([r.attributeValue(0), r.attributeType(0)]).toEqual(['x', 'ID']);
  });

  it('accepts a declared xml:id a start tag leaves out', () => {
    expect(errors('<!DOCTYPE r [<!ATTLIST r xml:id ID #IMPLIED>]><r/>')).toEqual([]);
  });

  it('does not take an earlier tag’s xml:id for the current one', () => {
    const xml = '<!DOCTYPE r [<!ENTITY e "v">]><r><a x="&e;" xml:id="i"/><a x="&e;"/><a y="&e;" xml:id="i"/></r>';
    expect(errors(xml)).toEqual(['XMLID_DUPLICATE']);
  });

  it('treats xml:id as an ordinary attribute when not namespace-aware', () => {
    const r = start('<a xml:id="1 2"/>', { namespaceAware: false });
    expect([r.attributeValue(0), r.attributeType(0)]).toEqual(['1 2', 'CDATA']);
  });
});

describe('xml:id names', () => {
  it('reports xml:id in the XML namespace', () => {
    const reader = new XMLInputFactory().createStreamReader('<a xml:id="x" b="1"/>');
    reader.next();
    expect([reader.attributeNamespace(0), reader.attributeLocalName(0), reader.attributePrefix(0)]).toEqual([
      'http://www.w3.org/XML/1998/namespace',
      'id',
      'xml',
    ]);
  });
});

/** A fail callback that throws an error carrying the code, as the reader's does. */
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};

/** An attribute list holding the given attributes, all specified CDATA. */
function listOf(...attributes: [string, string][]): AttributeList {
  const list = new AttributeList();
  for (const [name, value] of attributes) list.add(name, value, 'CDATA', true);
  return list;
}

/** Declares and resolves a list's namespaces against fresh bindings; returns the bindings. */
function process(list: AttributeList, { version11 = false, prefixesShown = false } = {}): NamespaceBindings {
  const bindings = new NamespaceBindings();
  list.declareNamespaces(bindings, version11, () => undefined, fail);
  list.resolveNamespaces(bindings, '', 0, prefixesShown, fail);
  return bindings;
}

describe('AttributeList', () => {
  it('adds attributes with their types, specified flags and whether normalizing changed them', () => {
    const list = new AttributeList();
    list.add('a', '1', 'CDATA', true);
    list.add('b', 'x y', 'NMTOKENS', false, true);
    expect(list.count).toBe(2);
    expect([list.names, list.values, list.types, list.isSpecified, list.changedByNormalizing]).toEqual([
      ['a', 'b'],
      ['1', 'x y'],
      ['CDATA', 'NMTOKENS'],
      [true, false],
      [false, true],
    ]);
    expect([list.prefixes, list.localNames, list.uris]).toEqual([
      ['', ''],
      ['a', 'b'],
      ['', ''],
    ]);
  });

  it('empties itself for the next start tag, reusing its arrays', () => {
    const list = listOf(['a', '1']);
    list.showAll();
    list.clear();
    expect([list.count, list.visibleCount]).toEqual([0, 0]);
    list.add('b', '2', 'CDATA', true);
    expect([list.count, list.names[0]]).toEqual([1, 'b']);
  });

  it.each([
    ['xmlns', true],
    ['xmlns:p', true],
    ['xmlnsx', false],
    ['x:xmlns', false],
    ['a', false],
  ])('tells whether %s declares a namespace', (name, declares) => {
    expect(listOf([name, 'u']).isDeclaration(0)).toBe(declares);
  });

  it('lists every attribute as visible when not namespace-aware', () => {
    const list = listOf(['xmlns', 'u'], ['a', '1']);
    list.showAll();
    expect([list.visibleCount, list.visible.slice(0, 2)]).toEqual([2, [0, 1]]);
  });

  it('applies declarations, putting them in the xmlns namespace and making the default the default', () => {
    const list = listOf(['xmlns', 'urn:d'], ['xmlns:p', 'urn:p'], ['a', '1']);
    const declared: number[] = [];
    const bindings = new NamespaceBindings();
    list.declareNamespaces(bindings, false, (k) => declared.push(k), fail);
    expect(declared).toEqual([2, 3]);
    expect(bindings.defaultIndex).toBe(2);
    expect([bindings.uri(2, '', 0), bindings.prefix(3, '', 0), bindings.uri(3, '', 0)]).toEqual([
      'urn:d',
      'p',
      'urn:p',
    ]);
    expect([list.prefixes, list.localNames, list.uris.slice(0, 2)]).toEqual([
      ['', 'xmlns', ''],
      ['xmlns', 'p', 'a'],
      ['http://www.w3.org/2000/xmlns/', 'http://www.w3.org/2000/xmlns/'],
    ]);
  });

  it.each([
    ['xmlns:1p', 'u', 'NS_QNAME'],
    ['xmlns:xmlns', 'u', 'NS_RESERVED'],
    ['xmlns:xml', 'urn:other', 'NS_RESERVED'],
    ['xmlns:p', 'http://www.w3.org/XML/1998/namespace', 'NS_RESERVED'],
    ['xmlns', 'http://www.w3.org/XML/1998/namespace', 'NS_RESERVED'],
    ['xmlns:p', 'http://www.w3.org/2000/xmlns/', 'NS_RESERVED'],
    ['xmlns', 'http://www.w3.org/2000/xmlns/', 'NS_RESERVED'],
    ['xmlns:p', '', 'NS_UNDECLARED_PREFIX'],
  ])('rejects the declaration %s="%s" (Namespaces §3)', (name, value, code) => {
    expect(() => process(listOf([name, value]))).toThrow(expect.objectContaining({ code }));
  });

  it('accepts xml bound to its own namespace, an empty default, and undeclaring a prefix in XML 1.1', () => {
    expect(() => process(listOf(['xmlns:xml', 'http://www.w3.org/XML/1998/namespace']))).not.toThrow();
    expect(() => process(listOf(['xmlns', '']))).not.toThrow();
    expect(() => process(listOf(['xmlns:p', '']), { version11: true })).not.toThrow();
  });

  it('resolves prefixed attributes against the declarations, in whatever order they come', () => {
    const list = listOf(['p:a', '1'], ['xmlns:p', 'urn:p'], ['b', '2'], ['xml:lang', 'en']);
    process(list);
    expect(list.visible.slice(0, list.visibleCount)).toEqual([0, 2, 3]);
    expect([list.prefixes, list.localNames, list.uris]).toEqual([
      ['p', 'xmlns', '', 'xml'],
      ['a', 'p', 'b', 'lang'],
      ['urn:p', 'http://www.w3.org/2000/xmlns/', '', 'http://www.w3.org/XML/1998/namespace'],
    ]);
  });

  it('lists the declarations too when namespacePrefixes is on', () => {
    const list = listOf(['xmlns:p', 'urn:p'], ['a', '1']);
    process(list, { prefixesShown: true });
    expect(list.visible.slice(0, list.visibleCount)).toEqual([0, 1]);
  });

  it.each([
    [':a', 'NS_QNAME'],
    ['a:', 'NS_QNAME'],
    ['a:1', 'NS_QNAME'],
    ['q:a', 'NS_UNBOUND_PREFIX'],
  ])('rejects the attribute name %s', (name, code) => {
    expect(() => process(listOf([name, 'v']))).toThrow(expect.objectContaining({ code }));
  });

  it('rejects a prefix undeclared in XML 1.1 (Namespaces 1.1 §5)', () => {
    const list = listOf(['xmlns:p', ''], ['p:a', '1']);
    expect(() => process(list, { version11: true })).toThrow(expect.objectContaining({ code: 'NS_UNBOUND_PREFIX' }));
  });

  it('rejects two attributes with the same expanded name (NSC: Attributes Unique)', () => {
    const list = listOf(['xmlns:p', 'u'], ['xmlns:q', 'u'], ['p:a', '1'], ['q:a', '2']);
    expect(() => process(list)).toThrow(expect.objectContaining({ code: 'NS_DUPLICATE_ATTRIBUTE' }));
    expect(() => process(listOf(['xmlns:p', 'u'], ['a', '1'], ['p:a', '2']))).not.toThrow();
  });
});
