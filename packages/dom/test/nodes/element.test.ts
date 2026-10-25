import { build, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { Attr, type Document, type Element } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';

/** A DTD giving `r` a default `d`, a defaulted enumeration `e` and an ID `i`. */
const DTD = '<!DOCTYPE r [<!ATTLIST r d CDATA "dv" e (x|y) "x" i ID #IMPLIED>]>';

/** An element with no attributes in a fresh document. */
function element(name = 'e'): Element {
  return newDocument().createElement(name);
}

/** The attributes of an element as name=value. */
function attributes(e: Element): string[] {
  return [...e.attributes].map((a) => `${a.nodeName}=${a.nodeValue}`);
}

/** An element inside an entity reference, which is read-only, with an attribute a. */
function readOnlyElement(): Element {
  const document = build(`<!DOCTYPE r [<!ENTITY e "<b a='1'/>">]><r>&e;</r>`, { replaceEntityReferences: false });
  return document.documentElement?.firstChild?.firstChild as Element;
}

describe('Element', () => {
  it('is an element node named by its tag name', () => {
    const e = element('tag');
    expect([e.nodeType, e.nodeName, e.tagName]).toEqual([1, 'tag', 'tag']);
  });

  it('has no schema type, as DTDs give elements none (DOM Level 3 TypeInfo)', () => {
    const info = element().schemaTypeInfo;
    expect([info.typeName, info.typeNamespace]).toEqual([null, null]);
  });

  it('says whether it has attributes', () => {
    const e = element();
    expect(e.hasAttributes()).toBe(false);
    e.setAttribute('a', '1');
    expect(e.hasAttributes()).toBe(true);
  });
});

describe('Element.getAttribute and friends (DOM Level 2)', () => {
  const r = build('<r a="1" xmlns:p="urn:p" p:b="2"/>').documentElement as Element;

  it('gives an attribute value by name, the empty string when there is none', () => {
    expect([r.getAttribute('a'), r.getAttribute('p:b'), r.getAttribute('missing')]).toEqual(['1', '2', '']);
  });

  it('gives an attribute value by namespace and local name, the empty string when there is none', () => {
    expect([r.getAttributeNS('urn:p', 'b'), r.getAttributeNS(null, 'a'), r.getAttributeNS('urn:p', 'a')]).toEqual([
      '2',
      '1',
      '',
    ]);
  });

  it('says whether it has an attribute by name or by namespace', () => {
    expect([
      r.hasAttribute('a'),
      r.hasAttribute('b'),
      r.hasAttributeNS('urn:p', 'b'),
      r.hasAttributeNS('', 'b'),
    ]).toEqual([true, false, true, false]);
  });

  it('gives attribute nodes, or null', () => {
    expect(r.getAttributeNode('a')?.value).toBe('1');
    expect(r.getAttributeNode('b')).toBeNull();
    expect(r.getAttributeNodeNS('urn:p', 'b')?.name).toBe('p:b');
    expect(r.getAttributeNodeNS('', 'a')?.name).toBe('a');
  });

  it('finds a DOM Level 1 attribute by its name when no namespace is given', () => {
    const e = element();
    e.setAttribute('level1', 'v');
    expect(e.getAttributeNodeNS(null, 'level1')?.value).toBe('v');
  });
});

describe('Element.setAttribute (DOM Level 1)', () => {
  it('adds an attribute, specified and owned by the element', () => {
    const e = element();
    e.setAttribute('a', 'v');
    const attr = e.getAttributeNode('a') as Attr;
    expect([attr.value, attr.specified, attr.ownerElement, attr.namespaceURI, attr.localName]).toEqual([
      'v',
      true,
      e,
      null,
      null,
    ]);
  });

  it('changes the value of an attribute it has, keeping the node', () => {
    const e = element();
    e.setAttribute('a', '1');
    const attr = e.getAttributeNode('a');
    e.setAttribute('a', '2');
    expect([e.getAttributeNode('a'), attr?.value, e.attributes.length]).toEqual([attr, '2', 1]);
  });

  it('converts the value to a string', () => {
    const e = element();
    e.setAttribute('a', 7 as unknown as string);
    expect(e.getAttribute('a')).toBe('7');
  });

  it('keeps names like __proto__ and constructor as ordinary attributes', () => {
    const e = element();
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) e.setAttribute(name, name);
    expect(attributes(e)).toEqual([
      '__proto__=__proto__',
      'constructor=constructor',
      'toString=toString',
      'hasOwnProperty=hasOwnProperty',
    ]);
    expect(e.attributes.getNamedItem('constructor')?.nodeValue).toBe('constructor');
  });

  it('raises INVALID_CHARACTER_ERR for a name that is not an XML name', () => {
    expect(() => element().setAttribute('1a', 'v')).toThrow(domException('InvalidCharacterError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on a read-only element', () => {
    expect(() => readOnlyElement().setAttribute('a', '2')).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('Element.setAttributeNS (DOM Level 2)', () => {
  it('adds an attribute in a namespace', () => {
    const e = element();
    e.setAttributeNS('urn:p', 'p:a', 'v');
    const attr = e.getAttributeNodeNS('urn:p', 'a') as Attr;
    expect([attr.name, attr.prefix, attr.localName, attr.namespaceURI, attr.value]).toEqual([
      'p:a',
      'p',
      'a',
      'urn:p',
      'v',
    ]);
  });

  it('reads the empty namespace as none', () => {
    const e = element();
    e.setAttributeNS('', 'a', 'v');
    expect(e.getAttributeNodeNS(null, 'a')?.namespaceURI).toBeNull();
  });

  it('changes the value and prefix of an attribute with the same namespace and local name', () => {
    const e = element();
    e.setAttributeNS('urn:p', 'p:a', '1');
    const attr = e.getAttributeNodeNS('urn:p', 'a');
    e.setAttributeNS('urn:p', 'q:a', '2');
    expect([e.getAttributeNodeNS('urn:p', 'a'), attr?.name, attr?.value, e.attributes.length]).toEqual([
      attr,
      'q:a',
      '2',
      1,
    ]);
  });

  it('keeps the name when the prefix is the same', () => {
    const e = element();
    e.setAttributeNS('urn:p', 'p:a', '1');
    e.setAttributeNS('urn:p', 'p:a', '2');
    expect(attributes(e)).toEqual(['p:a=2']);
  });

  it('puts an attribute before one with the same qualified name, as Xerces does', () => {
    const e = element();
    e.setAttribute('p:a', 'level1');
    e.setAttributeNS('urn:p', 'p:a', 'level2');
    expect(attributes(e)).toEqual(['p:a=level2', 'p:a=level1']);
    expect(e.getAttribute('p:a')).toBe('level2');
  });

  it.each([
    ['a prefix with no namespace', null, 'p:a', 'NamespaceError'],
    ['xml with another namespace', 'urn:p', 'xml:a', 'NamespaceError'],
    ['xmlns outside its namespace', 'urn:p', 'xmlns', 'NamespaceError'],
    ['a malformed qualified name', 'urn:p', 'p:a:b', 'NamespaceError'],
    ['a local part that is not an NCName', 'urn:p', 'p:1a', 'NamespaceError'],
    ['a name that is not an XML name', 'urn:p', '1a', 'InvalidCharacterError'],
  ] as const)('raises an exception for %s', (_case, uri, name, exception) => {
    expect(() => element().setAttributeNS(uri, name, 'v')).toThrow(domException(exception));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on a read-only element', () => {
    expect(() => readOnlyElement().setAttributeNS(null, 'a', '2')).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('Element.setAttributeNode (DOM Level 1)', () => {
  it('adds an attribute node and returns null', () => {
    const e = element();
    const attr = (e.ownerDocument as Document).createAttribute('a');
    expect(e.setAttributeNode(attr)).toBeNull();
    expect([e.getAttributeNode('a'), attr.ownerElement]).toEqual([attr, e]);
  });

  it('replaces an attribute of the same name and returns it, no longer owned', () => {
    const e = element();
    e.setAttribute('a', 'old');
    const old = e.getAttributeNode('a') as Attr;
    const attr = (e.ownerDocument as Document).createAttribute('a');
    expect(e.setAttributeNode(attr)).toBe(old);
    expect([old.ownerElement, e.getAttributeNode('a'), e.attributes.length]).toEqual([null, attr, 1]);
  });

  it('returns the node itself when it is set again, as Xerces does', () => {
    const e = element();
    const attr = (e.ownerDocument as Document).createAttribute('a');
    e.setAttributeNode(attr);
    expect(e.setAttributeNode(attr)).toBe(attr);
    expect(e.attributes).toHaveLength(1);
  });

  it('raises WRONG_DOCUMENT_ERR for an attribute of another document', () => {
    expect(() => element().setAttributeNode(newDocument().createAttribute('a'))).toThrow(
      domException('WrongDocumentError')
    );
  });

  it('raises INUSE_ATTRIBUTE_ERR for an attribute of another element', () => {
    const document = newDocument();
    const [a, b] = [document.createElement('a'), document.createElement('b')];
    a.setAttribute('x', '1');
    expect(() => b.setAttributeNode(a.getAttributeNode('x') as Attr)).toThrow(domException('InUseAttributeError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on a read-only element', () => {
    const e = readOnlyElement();
    expect(() => e.setAttributeNode((e.ownerDocument as Document).createAttribute('x'))).toThrow(
      domException('NoModificationAllowedError')
    );
  });
});

describe('Element.setAttributeNodeNS (DOM Level 2)', () => {
  it('replaces an attribute with the same namespace and local name', () => {
    const e = element();
    e.setAttributeNS('urn:p', 'p:a', 'old');
    const old = e.getAttributeNodeNS('urn:p', 'a');
    const attr = (e.ownerDocument as Document).createAttributeNS('urn:p', 'q:a');
    expect(e.setAttributeNodeNS(attr)).toBe(old);
    expect(attributes(e)).toEqual(['q:a=']);
  });

  it('adds an attribute and returns null when nothing matches', () => {
    const e = element();
    expect(e.setAttributeNodeNS((e.ownerDocument as Document).createAttributeNS('urn:p', 'p:a'))).toBeNull();
  });

  it('reports an attribute of the same qualified name that it sits before, as Xerces does', () => {
    const e = element();
    e.setAttribute('p:a', 'level1');
    const level1 = e.getAttributeNode('p:a');
    expect(e.setAttributeNodeNS((e.ownerDocument as Document).createAttributeNS('urn:p', 'p:a'))).toBe(level1);
    expect(e.attributes).toHaveLength(2);
  });

  it('matches a DOM Level 1 attribute by name', () => {
    const e = element();
    e.setAttribute('a', 'level1');
    const level1 = e.getAttributeNode('a');
    const attr = new Attr(e.ownerDocument, 'a', null, null, 'new');
    expect(e.setAttributeNodeNS(attr)).toBe(level1);
    expect(attributes(e)).toEqual(['a=new']);
  });
});

describe('Element.removeAttribute and friends (DOM Level 2)', () => {
  it('removes an attribute by name', () => {
    const e = element();
    e.setAttribute('a', '1');
    e.removeAttribute('a');
    expect(e.hasAttributes()).toBe(false);
  });

  it('does nothing for an attribute it does not have', () => {
    const e = element();
    e.removeAttribute('a');
    e.removeAttributeNS('urn:p', 'a');
    expect(e.hasAttributes()).toBe(false);
  });

  it('removes an attribute by namespace and local name', () => {
    const e = element();
    e.setAttributeNS('urn:p', 'p:a', '1');
    e.removeAttributeNS('urn:p', 'a');
    expect(e.hasAttributes()).toBe(false);
  });

  it('removes an attribute node and returns it, no longer owned', () => {
    const e = element();
    e.setAttribute('a', '1');
    const attr = e.getAttributeNode('a') as Attr;
    expect(e.removeAttributeNode(attr)).toBe(attr);
    expect([attr.ownerElement, attr.value, e.hasAttributes()]).toEqual([null, '1', false]);
  });

  it('raises NOT_FOUND_ERR for an attribute node it does not have', () => {
    const e = element();
    expect(() => e.removeAttributeNode((e.ownerDocument as Document).createAttribute('a'))).toThrow(
      domException('NotFoundError')
    );
  });

  it.each([
    ['removeAttribute', (e: Element) => e.removeAttribute('a')],
    ['removeAttributeNS', (e: Element) => e.removeAttributeNS(null, 'a')],
    ['removeAttributeNode', (e: Element) => e.removeAttributeNode(e.getAttributeNode('a') as Attr)],
  ])('raises NO_MODIFICATION_ALLOWED_ERR from %s on a read-only element', (_name, remove) => {
    expect(() => remove(readOnlyElement())).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('DTD attribute defaults (DOM Level 1 Element.removeAttribute)', () => {
  it('gives parsed elements their defaults, not specified', () => {
    const r = build(`${DTD}<r/>`).documentElement as Element;
    expect(attributes(r)).toEqual(['d=dv', 'e=x']);
    expect(r.getAttributeNode('d')?.specified).toBe(false);
  });

  it('brings back a removed attribute with its default, with its type, not specified', () => {
    const r = build(`${DTD}<r d="mine"/>`).documentElement as Element;
    r.removeAttribute('d');
    const restored = r.getAttributeNode('d') as Attr;
    expect([restored.value, restored.specified, restored.ownerElement, restored.schemaTypeInfo.typeName]).toEqual([
      'dv',
      false,
      r,
      'CDATA',
    ]);
  });

  it('brings back a defaulted attribute in the place of the one removed', () => {
    const r = build(`${DTD}<r i="a"/>`).documentElement as Element;
    r.removeAttribute('d');
    expect(attributes(r)).toEqual(['i=a', 'd=dv', 'e=x']);
  });

  it('removes an attribute with no default for good', () => {
    const r = build(`${DTD}<r i="a"/>`).documentElement as Element;
    r.removeAttribute('i');
    expect(r.hasAttribute('i')).toBe(false);
  });

  it('gives created elements their defaults (DOM Level 1 Document.createElement)', () => {
    const document = build(`${DTD}<r/>`);
    const created = document.createElement('r');
    expect(attributes(created)).toEqual(['d=dv', 'e=x']);
    expect(created.getAttributeNode('e')?.schemaTypeInfo.typeName).toBe('NMTOKEN');
  });

  it('puts the defaults of an element created with a namespace in the namespaces their prefixes have', () => {
    const document = build(
      '<!DOCTYPE p:e [<!ATTLIST p:e xmlns:p CDATA #FIXED "urn:p" xmlns:q CDATA #FIXED "urn:q" p:a CDATA "1" q:b CDATA "2" c CDATA "3" xmlns CDATA "urn:d">]><p:e/>'
    );
    const created = document.createElementNS('urn:p', 'p:e');
    expect([...created.attributes].map((a) => [a.nodeName, a.namespaceURI, a.localName, a.nodeValue])).toEqual([
      ['xmlns:p', 'http://www.w3.org/2000/xmlns/', 'p', 'urn:p'],
      ['xmlns:q', 'http://www.w3.org/2000/xmlns/', 'q', 'urn:q'],
      ['p:a', 'urn:p', 'a', '1'],
      ['q:b', 'urn:q', 'b', '2'],
      ['c', null, 'c', '3'],
      ['xmlns', 'http://www.w3.org/2000/xmlns/', 'xmlns', 'urn:d'],
    ]);
  });

  it('gives an element created without a namespace DOM Level 1 defaults', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r p:a CDATA "1">]><r/>', { namespaceAware: false });
    const attr = document.createElement('r').getAttributeNode('p:a') as Attr;
    expect([attr.namespaceURI, attr.localName, attr.value]).toEqual([null, null, '1']);
  });

  it('gives a renamed element only the defaults it lacks', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST s d CDATA "dv">]><r d="mine"/>');
    const r = document.renameNode(document.documentElement as Element, null, 's');
    expect([r.getAttribute('d'), r.attributes.length]).toEqual(['mine', 1]);
  });

  it('gives a defaulted ID attribute back as an ID', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r i ID "dflt">]><r i="mine"/>');
    const r = document.documentElement as Element;
    r.removeAttribute('i');
    expect([r.getAttributeNode('i')?.isId, document.getElementById('dflt')]).toEqual([true, r]);
  });
});

describe('Element.getElementsByTagName (DOM Level 1)', () => {
  const document = build('<r><a><b/><a/></a><b xmlns="urn:x"/><p:b xmlns:p="urn:x"/></r>');
  const a = document.documentElement?.firstChild as Element;

  it('finds the descendants of a name in document order, not the element itself', () => {
    expect([...a.getElementsByTagName('a')].map((e) => e.parentNode === a)).toEqual([true]);
    expect(document.documentElement?.getElementsByTagName('b').length).toBe(2);
  });

  it('finds every descendant with *', () => {
    expect([...a.getElementsByTagName('*')].map((e) => e.nodeName)).toEqual(['b', 'a']);
  });

  it('is live', () => {
    const list = a.getElementsByTagName('c');
    a.appendChild(document.createElement('c'));
    expect(list).toHaveLength(1);
  });
});

describe('Element.getElementsByTagNameNS (DOM Level 2)', () => {
  const document = build('<r><b/><b xmlns="urn:x"/><p:c xmlns:p="urn:x"/><p:b xmlns:p="urn:y"/></r>');
  const r = document.documentElement as Element;

  it.each([
    ['urn:x', 'b', ['b']],
    ['urn:x', '*', ['b', 'p:c']],
    ['*', 'b', ['b', 'b', 'p:b']],
    ['*', '*', ['b', 'b', 'p:c', 'p:b']],
    [null, 'b', ['b']],
    ['', 'b', ['b']],
  ])('finds the elements in %j named %j', (uri, local, expected) => {
    expect([...r.getElementsByTagNameNS(uri, local)].map((e) => e.nodeName)).toEqual(expected);
  });

  it('matches DOM Level 1 elements only with *', () => {
    const e = element();
    e.appendChild((e.ownerDocument as Document).createElement('level1'));
    expect([e.getElementsByTagNameNS(null, 'level1').length, e.getElementsByTagNameNS(null, '*').length]).toEqual([
      0, 1,
    ]);
  });
});

describe('Element.setIdAttribute and friends (DOM Level 3)', () => {
  /** A document with an element holding attributes k and p:n. */
  function doc(): { document: Document; e: Element } {
    const document = build('<r><e k="key" xmlns:p="urn:p" p:n="named"/></r>');
    return { document, e: document.documentElement?.firstChild as Element };
  }

  it('makes an attribute an ID by name, which getElementById finds', () => {
    const { document, e } = doc();
    expect(document.getElementById('key')).toBeNull();
    e.setIdAttribute('k', true);
    expect([e.getAttributeNode('k')?.isId, document.getElementById('key')]).toEqual([true, e]);
    e.setIdAttribute('k', false);
    expect(document.getElementById('key')).toBeNull();
  });

  it('makes an attribute an ID by namespace and local name', () => {
    const { document, e } = doc();
    e.setIdAttributeNS('urn:p', 'n', true);
    expect(document.getElementById('named')).toBe(e);
  });

  it('makes an attribute node an ID', () => {
    const { document, e } = doc();
    e.setIdAttributeNode(e.getAttributeNode('k') as Attr, true);
    expect(document.getElementById('key')).toBe(e);
  });

  it.each([
    ['setIdAttribute', (e: Element) => e.setIdAttribute('none', true)],
    ['setIdAttributeNS', (e: Element) => e.setIdAttributeNS('urn:p', 'k', true)],
    [
      'setIdAttributeNode',
      (e: Element) => e.setIdAttributeNode((e.ownerDocument as Document).createAttribute('k'), true),
    ],
  ])('raises NOT_FOUND_ERR from %s for an attribute the element does not have', (_name, mark) => {
    expect(() => mark(doc().e)).toThrow(domException('NotFoundError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on a read-only element', () => {
    expect(() => readOnlyElement().setIdAttribute('a', true)).toThrow(domException('NoModificationAllowedError'));
  });

  it('finds an element by a changed ID value', () => {
    const { document, e } = doc();
    e.setIdAttribute('k', true);
    e.setAttribute('k', 'changed');
    expect([document.getElementById('key'), document.getElementById('changed')]).toEqual([null, e]);
  });
});

describe('Element.baseURI (XML Base)', () => {
  it('resolves xml:base against the parent base URI', () => {
    const document = build({
      systemId: 'http://example.com/a/doc.xml',
      text: '<r xml:base="b/"><c xml:base="c.xml"/><d/></r>',
    });
    const r = document.documentElement as Element;
    expect([r.baseURI, (r.firstChild as Element).baseURI, (r.lastChild as Element).baseURI]).toEqual([
      'http://example.com/a/b/',
      'http://example.com/a/b/c.xml',
      'http://example.com/a/b/',
    ]);
  });

  it('escapes what a URI may not hold before resolving, as XInclude and catalogs do (XML Base §3.1)', () => {
    const document = build({ systemId: 'http://example.com/a/doc.xml', text: String.raw`<r xml:base="dir\sub|x/"/>` });
    expect(document.documentElement?.baseURI).toBe('http://example.com/a/dir%5Csub%7Cx/');
  });

  it('takes the document base URI with no xml:base', () => {
    const document = build({ systemId: 'http://example.com/doc.xml', text: '<r/>' });
    expect(document.documentElement?.baseURI).toBe('http://example.com/doc.xml');
  });

  it('takes an absolute xml:base as it is', () => {
    const document = build('<r xml:base="http://example.org/x/"/>');
    expect(document.documentElement?.baseURI).toBe('http://example.org/x/');
  });

  it('takes the inherited base URI for an empty xml:base', () => {
    const document = build({ systemId: 'http://example.com/doc.xml', text: '<r xml:base=""/>' });
    expect(document.documentElement?.baseURI).toBe('http://example.com/doc.xml');
  });

  it('is null when a relative xml:base has nothing to resolve against', () => {
    expect(build('<r xml:base="rel/"/>').documentElement?.baseURI).toBeNull();
  });

  it('is null with no base URI at all', () => {
    expect(element().baseURI).toBeNull();
  });

  it('reads xml:base on an element that is not namespace-aware', () => {
    const document = build('<r xml:base="http://example.org/"/>', { namespaceAware: false });
    expect(document.documentElement?.baseURI).toBe('http://example.org/');
  });

  it('reads an xml:base set with setAttributeNS', () => {
    const e = element();
    e.setAttributeNS(XML, 'xml:base', 'http://example.org/set/');
    expect(e.baseURI).toBe('http://example.org/set/');
  });

  it('takes the base URI of the parent for an element out of the document', () => {
    const document = newDocument();
    document.documentURI = 'http://example.com/doc.xml';
    const e = document.createElement('e');
    expect(e.baseURI).toBe('http://example.com/doc.xml');
  });
});
