import { build, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import {
  type Attr,
  DOMImplementation,
  type Document,
  type DocumentType,
  type Element,
  type Node,
  type Text,
} from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';

/** An element with no attributes in a fresh document. */
function element(name = 'e'): Element {
  return newDocument().createElement(name);
}

const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** A document with nested scopes: r binds a and p, c rebinds p and the default, d sits in c. */
function scopes(): { document: Document; r: Element; c: Element; d: Element } {
  const document = build(
    '<a:r xmlns:a="urn:a" xmlns:p="urn:p1" xmlns="urn:d1"><c xmlns:p="urn:p2" xmlns="urn:d2"><d/></c></a:r>'
  );
  const r = document.documentElement as Element;
  const c = r.firstChild as Element;
  return { document, r, c, d: c.firstChild as Element };
}

describe('the prefix setter (DOM Level 2 Node.prefix)', () => {
  it('changes the prefix of an element, keeping its local name and namespace', () => {
    const e = newDocument().createElementNS('urn:p', 'p:e');
    e.prefix = 'q';
    expect([e.nodeName, e.tagName, e.prefix, e.localName, e.namespaceURI]).toEqual(['q:e', 'q:e', 'q', 'e', 'urn:p']);
  });

  it.each([null, ''])('removes the prefix when set to %j', (prefix) => {
    const e = newDocument().createElementNS('urn:p', 'p:e');
    e.prefix = prefix;
    expect([e.nodeName, e.prefix]).toEqual(['e', null]);
  });

  it('changes the prefix of an attribute', () => {
    const e = element();
    e.setAttributeNS('urn:p', 'p:a', 'v');
    const attr = e.getAttributeNodeNS('urn:p', 'a') as Attr;
    attr.prefix = 'q';
    expect([attr.name, e.getAttribute('q:a')]).toEqual(['q:a', 'v']);
  });

  it('gives a DOM Level 1 node no prefix', () => {
    expect(newDocument().createElement('p:e').prefix).toBeNull();
  });

  it('raises NAMESPACE_ERR for a DOM Level 1 node', () => {
    const e = newDocument().createElement('e');
    expect(() => (e.prefix = 'p')).toThrow(domException('NamespaceError'));
  });

  it('raises INVALID_CHARACTER_ERR for a prefix that is not an XML name', () => {
    const e = newDocument().createElementNS('urn:p', 'p:e');
    expect(() => (e.prefix = '1p')).toThrow(domException('InvalidCharacterError'));
  });

  it.each([
    ['a prefix holding a colon', 'urn:p', 'p:e', 'a:b'],
    ['a node in no namespace', null, 'e', 'p'],
    ['xml outside the XML namespace', 'urn:p', 'p:e', 'xml'],
    ['an element in the XMLNS namespace', 'http://www.w3.org/2000/xmlns/', 'xmlns:e', 'p'],
  ])('raises NAMESPACE_ERR for %s', (_case, uri, name, prefix) => {
    const e = newDocument().createElementNS(uri, name);
    expect(() => (e.prefix = prefix)).toThrow(domException('NamespaceError'));
  });

  it('raises NAMESPACE_ERR for the prefix xmlns on an attribute outside its namespace', () => {
    const attr = newDocument().createAttributeNS('urn:p', 'p:a');
    expect(() => (attr.prefix = 'xmlns')).toThrow(domException('NamespaceError'));
  });

  it('raises NAMESPACE_ERR for any prefix on the attribute xmlns', () => {
    const attr = newDocument().createAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns');
    expect(() => (attr.prefix = 'xmlns')).toThrow(domException('NamespaceError'));
  });

  it('lets xml be the prefix of a node in the XML namespace', () => {
    const attr = newDocument().createAttributeNS(XML, 'p:lang');
    attr.prefix = 'xml';
    expect(attr.name).toBe('xml:lang');
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on a read-only node', () => {
    const document = build(`<!DOCTYPE r [<!ENTITY e "<p:b xmlns:p='urn:p'/>">]><r>&e;</r>`, {
      replaceEntityReferences: false,
    });
    const b = document.documentElement?.firstChild?.firstChild as Element;
    expect(() => (b.prefix = 'q')).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('Node.lookupNamespaceURI (DOM Level 3 Appendix B.4)', () => {
  it('finds the namespace an element prefix is bound to, and the default namespace', () => {
    const { r, c, d } = scopes();
    expect([r.lookupNamespaceURI('a'), r.lookupNamespaceURI('p'), r.lookupNamespaceURI(null)]).toEqual([
      'urn:a',
      'urn:p1',
      'urn:d1',
    ]);
    expect([c.lookupNamespaceURI('p'), d.lookupNamespaceURI('p'), d.lookupNamespaceURI(null)]).toEqual([
      'urn:p2',
      'urn:p2',
      'urn:d2',
    ]);
    expect(d.lookupNamespaceURI('a')).toBe('urn:a');
  });

  it('gives null for a prefix nothing binds', () => {
    expect(scopes().d.lookupNamespaceURI('none')).toBeNull();
  });

  it('uses the element own namespace and prefix before its declarations', () => {
    const e = newDocument().createElementNS('urn:own', 'o:e');
    expect(e.lookupNamespaceURI('o')).toBe('urn:own');
  });

  it('reads xmlns="" as no default namespace', () => {
    const document = build('<r xmlns="urn:a"><c xmlns=""/></r>');
    expect(document.documentElement?.firstChild?.lookupNamespaceURI(null)).toBeNull();
  });

  it('reads declarations made with setAttributeNS', () => {
    const e = newDocument().createElementNS(null, 'e');
    e.setAttributeNS(XMLNS, 'xmlns:q', 'urn:q');
    e.setAttributeNS(XMLNS, 'xmlns', 'urn:default');
    expect([e.lookupNamespaceURI('q'), e.lookupNamespaceURI(null)]).toEqual(['urn:q', 'urn:default']);
  });

  it('ignores xmlns attributes of an element read without namespaces', () => {
    const document = build('<r xmlns:p="urn:p"/>', { namespaceAware: false });
    expect(document.documentElement?.lookupNamespaceURI('p')).toBeNull();
  });

  it('looks up from the document element for a document', () => {
    const { document } = scopes();
    expect(document.lookupNamespaceURI('a')).toBe('urn:a');
    expect(newDocument().lookupNamespaceURI('a')).toBeNull();
  });

  it('looks up from the ancestor element for text, comments and processing instructions', () => {
    const document = build('<r xmlns:p="urn:p">t<!--c--><?pi?></r>');
    for (const node of document.documentElement?.childNodes ?? []) {
      expect(node.lookupNamespaceURI('p'), node.nodeName).toBe('urn:p');
    }
  });

  it('looks up through entity references', () => {
    const document = build('<!DOCTYPE r [<!ENTITY t "text">]><r xmlns:p="urn:p">&t;</r>', {
      replaceEntityReferences: false,
    });
    const text = document.documentElement?.firstChild?.firstChild as Text;
    expect(text.lookupNamespaceURI('p')).toBe('urn:p');
  });

  it('gives null for a document type, a fragment and nodes out of the tree', () => {
    const { document } = scopes();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('t'));
    expect(fragment.lookupNamespaceURI('a')).toBeNull();
    expect(fragment.firstChild?.lookupNamespaceURI('a')).toBeNull();
    expect(new DOMImplementation().createDocumentType('d', null, null).lookupNamespaceURI('a')).toBeNull();
  });

  it('gives null for a processing instruction outside the document element', () => {
    const document = build('<?pi?><r xmlns:p="urn:p"/>');
    expect(document.firstChild?.lookupNamespaceURI('p')).toBeNull();
  });
});

describe('Node.lookupPrefix (DOM Level 3 Appendix B.2)', () => {
  it('finds the prefix bound to a namespace', () => {
    const { r, d } = scopes();
    expect([r.lookupPrefix('urn:a'), r.lookupPrefix('urn:p1'), d.lookupPrefix('urn:p2')]).toEqual(['a', 'p', 'p']);
  });

  it('gives null for a namespace bound only as the default', () => {
    expect(scopes().d.lookupPrefix('urn:d2')).toBeNull();
  });

  it('gives null for a prefix an inner declaration has rebound', () => {
    expect(scopes().d.lookupPrefix('urn:p1')).toBeNull();
  });

  it('gives null for a null or empty namespace', () => {
    const { r } = scopes();
    expect([r.lookupPrefix(null), r.lookupPrefix('')]).toEqual([null, null]);
  });

  it('uses the element own prefix', () => {
    const e = newDocument().createElementNS('urn:own', 'o:e');
    expect(e.lookupPrefix('urn:own')).toBe('o');
  });

  it('lets the element own prefix win over a declaration on it that conflicts, as B.4 does', () => {
    const e = newDocument().createElementNS('urn:own', 'o:e');
    e.setAttributeNS(XMLNS, 'xmlns:o', 'urn:other');
    expect([e.lookupPrefix('urn:own'), e.lookupPrefix('urn:other'), e.lookupNamespaceURI('o')]).toEqual([
      'o',
      null,
      'urn:own',
    ]);
  });

  it('does not use an ancestor prefix that the element own name rebinds', () => {
    const document = build('<o:r xmlns:o="urn:outer"/>');
    const inner = document.createElementNS('urn:inner', 'o:c');
    document.documentElement?.appendChild(inner);
    expect([inner.lookupPrefix('urn:outer'), inner.lookupPrefix('urn:inner')]).toEqual([null, 'o']);
  });

  it('looks up from the document element for a document, and from the owner element for an attribute', () => {
    const { document, r } = scopes();
    expect(document.lookupPrefix('urn:a')).toBe('a');
    expect((r.getAttributeNode('xmlns:a') as Attr).lookupPrefix('urn:p1')).toBe('p');
    expect(newDocument().lookupPrefix('urn:a')).toBeNull();
  });

  it('looks up from the ancestor element for text', () => {
    const document = build('<r xmlns:p="urn:p">t</r>');
    expect(document.documentElement?.firstChild?.lookupPrefix('urn:p')).toBe('p');
  });

  it('gives null where there is no element', () => {
    expect(newDocument().createTextNode('t').lookupPrefix('urn:p')).toBeNull();
  });
});

describe('Node.isDefaultNamespace (DOM Level 3 Appendix B.3)', () => {
  it('compares a namespace with the default namespace in scope', () => {
    const { r, d } = scopes();
    expect([r.isDefaultNamespace('urn:d1'), d.isDefaultNamespace('urn:d2'), d.isDefaultNamespace('urn:d1')]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('reads the default namespace from the element own name', () => {
    const e = newDocument().createElementNS('urn:own', 'e');
    expect(e.isDefaultNamespace('urn:own')).toBe(true);
  });

  it('reads the empty string as no namespace', () => {
    const document = build('<r><c/></r>');
    expect([
      document.documentElement?.isDefaultNamespace(''),
      document.documentElement?.isDefaultNamespace(null),
    ]).toEqual([true, true]);
  });

  it('asks the document element for a document', () => {
    const { document } = scopes();
    expect(document.isDefaultNamespace('urn:d1')).toBe(true);
  });

  it('asks the ancestor element for text, and gives false with none', () => {
    const document = build('<r xmlns="urn:d">t</r>');
    expect(document.documentElement?.firstChild?.isDefaultNamespace('urn:d')).toBe(true);
    expect(newDocument().createTextNode('t').isDefaultNamespace(null)).toBe(false);
    expect(newDocument().isDefaultNamespace(null)).toBe(false);
  });

  it('asks the owner element for an attribute', () => {
    const document = build('<p:r xmlns:p="urn:p" xmlns="urn:d" a="1"/>');
    const attr = document.documentElement?.getAttributeNode('a') as Node;
    expect([attr.isDefaultNamespace('urn:d'), attr.isDefaultNamespace('urn:p')]).toEqual([true, false]);
  });

  it('answers from the own namespace of an element with no prefix, whatever is declared above it', () => {
    const document = build('<r xmlns="urn:a"/>');
    const c = document.createElementNS(null, 'c');
    document.documentElement?.appendChild(c);
    const text = c.appendChild(document.createTextNode('t'));
    for (const node of [c, text]) {
      expect([node.isDefaultNamespace(null), node.isDefaultNamespace(''), node.isDefaultNamespace('urn:a')]).toEqual([
        true,
        true,
        false,
      ]);
    }
  });

  it('answers from the own namespace of a DOM Level 1 element, which is none', () => {
    const document = build('<r xmlns="urn:a"/>');
    const e = document.documentElement?.appendChild(document.createElement('e')) as Element;
    expect([e.isDefaultNamespace(null), e.isDefaultNamespace('urn:a')]).toEqual([true, false]);
  });

  it('answers from the default declaration of a prefixed element, before its ancestors', () => {
    const document = build('<r xmlns="urn:a"><p:c xmlns:p="urn:p" xmlns=""/><p:d xmlns:p="urn:p"/></r>');
    const [c, d] = [document.documentElement?.firstChild as Element, document.documentElement?.lastChild as Element];
    expect([c.isDefaultNamespace(null), c.isDefaultNamespace('urn:a')]).toEqual([true, false]);
    expect([d.isDefaultNamespace(null), d.isDefaultNamespace('urn:a')]).toEqual([false, true]);
  });

  it('asks the element above an entity reference', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "<p:c xmlns:p=\'urn:p\'/>">]><r xmlns="urn:a">&e;</r>', {
      replaceEntityReferences: false,
    });
    const c = document.documentElement?.firstChild?.firstChild as Element;
    expect([c.nodeName, c.isDefaultNamespace('urn:a')]).toEqual(['p:c', true]);
  });

  it('gives false for a document type, an entity, a notation and a fragment', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "x"><!NOTATION n SYSTEM "n">]><r/>');
    const doctype = document.doctype as DocumentType;
    for (const node of [
      doctype,
      doctype.entities.item(0) as Node,
      doctype.notations.item(0) as Node,
      document.createDocumentFragment(),
    ]) {
      expect(node.isDefaultNamespace(null), node.nodeName).toBe(false);
    }
  });
});
