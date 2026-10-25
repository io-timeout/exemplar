import { build, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it, vi } from 'vitest';
import {
  type Attr,
  type Document,
  DocumentPosition,
  type DocumentType,
  type Element,
  Entity,
  type Node,
} from '@/index.ts';

const { DOCUMENT_POSITION_DISCONNECTED: DISCONNECTED, DOCUMENT_POSITION_PRECEDING: PRECEDING } = DocumentPosition;

const { DOCUMENT_POSITION_FOLLOWING: FOLLOWING, DOCUMENT_POSITION_CONTAINS: CONTAINS } = DocumentPosition;

const { DOCUMENT_POSITION_CONTAINED_BY: CONTAINED_BY } = DocumentPosition;

const SPECIFIC = DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;

/** A document with a DTD, an element holding attributes x and y, and children c and d. */
function sample(): { document: Document; e: Element; x: Attr; y: Attr; c: Node; d: Node } {
  const document = build(
    '<!DOCTYPE r [<!ENTITY e1 "1"><!ENTITY e2 "2"><!NOTATION n1 SYSTEM "a"><!NOTATION n2 SYSTEM "b">]>' +
      '<r><e x="1" y="2"><c/><d/></e></r>'
  );
  const e = document.documentElement?.firstChild as Element;
  return {
    document,
    e,
    x: e.getAttributeNode('x') as Attr,
    y: e.getAttributeNode('y') as Attr,
    c: e.firstChild as Node,
    d: e.lastChild as Node,
  };
}

describe('Node.compareDocumentPosition (DOM Level 3)', () => {
  it('gives 0 for the node itself', () => {
    const { e } = sample();
    expect(e.compareDocumentPosition(e)).toBe(0);
  });

  it('gives preceding and following for siblings', () => {
    const { c, d } = sample();
    expect([c.compareDocumentPosition(d), d.compareDocumentPosition(c)]).toEqual([FOLLOWING, PRECEDING]);
  });

  it('gives contained-by and following for a descendant, contains and preceding for an ancestor', () => {
    const { document, c } = sample();
    expect(document.compareDocumentPosition(c)).toBe(CONTAINED_BY | FOLLOWING);
    expect(c.compareDocumentPosition(document)).toBe(CONTAINS | PRECEDING);
  });

  it('finds a following sibling that is not the next one', () => {
    const document = build('<r><a/><b/><c/></r>');
    const [a, , c] = [...(document.documentElement?.childNodes ?? [])];
    expect([a?.compareDocumentPosition(c as Node), c?.compareDocumentPosition(a as Node)]).toEqual([
      FOLLOWING,
      PRECEDING,
    ]);
  });

  it('orders nodes in different branches by their ancestors', () => {
    const document = build('<r><a><a1/></a><b><b1/></b></r>');
    const [a1, b1] = [document.getElementsByTagName('a1').item(0), document.getElementsByTagName('b1').item(0)];
    expect([a1?.compareDocumentPosition(b1 as Node), b1?.compareDocumentPosition(a1 as Node)]).toEqual([
      FOLLOWING,
      PRECEDING,
    ]);
  });

  it('treats an element as the container of its attributes', () => {
    const { e, x } = sample();
    expect([e.compareDocumentPosition(x), x.compareDocumentPosition(e)]).toEqual([
      CONTAINED_BY | FOLLOWING,
      CONTAINS | PRECEDING,
    ]);
  });

  it('puts attributes before the element children, as Xerces does', () => {
    const { x, c } = sample();
    expect([x.compareDocumentPosition(c), c.compareDocumentPosition(x)]).toEqual([FOLLOWING, PRECEDING]);
  });

  it('orders attributes of one element as their map does, marked implementation-specific', () => {
    const { x, y } = sample();
    expect([x.compareDocumentPosition(y), y.compareDocumentPosition(x)]).toEqual([
      FOLLOWING | SPECIFIC,
      PRECEDING | SPECIFIC,
    ]);
  });

  it('orders the text of an attribute after its attribute', () => {
    const { x, c } = sample();
    const text = x.firstChild as Node;
    expect([x.compareDocumentPosition(text), text.compareDocumentPosition(c)]).toEqual([
      CONTAINED_BY | FOLLOWING,
      FOLLOWING,
    ]);
  });

  it('treats a document type as the container of its entities and notations', () => {
    const { document } = sample();
    const doctype = document.doctype as Node;
    const entity = document.doctype?.entities.item(0) as Node;
    expect([doctype.compareDocumentPosition(entity), entity.compareDocumentPosition(doctype)]).toEqual([
      CONTAINED_BY | FOLLOWING,
      CONTAINS | PRECEDING,
    ]);
    expect(entity.compareDocumentPosition(document.documentElement as Node)).toBe(FOLLOWING);
  });

  it('puts entities before notations, each in the order of its map', () => {
    const { document } = sample();
    const [e1, e2] = [...(document.doctype?.entities ?? [])];
    const [n1, n2] = [...(document.doctype?.notations ?? [])];
    expect(e1?.compareDocumentPosition(n1 as Node)).toBe(FOLLOWING);
    expect(n2?.compareDocumentPosition(e2 as Node)).toBe(PRECEDING);
    expect([e1?.compareDocumentPosition(e2 as Node), n2?.compareDocumentPosition(n1 as Node)]).toEqual([
      FOLLOWING | SPECIFIC,
      PRECEDING | SPECIFIC,
    ]);
  });

  it('gives disconnected, implementation-specific and a consistent order for nodes in different trees', () => {
    const { e } = sample();
    const other = newDocument().createElement('o');
    const there = e.compareDocumentPosition(other);
    const back = other.compareDocumentPosition(e);
    expect(there & (DISCONNECTED | SPECIFIC)).toBe(DISCONNECTED | SPECIFIC);
    expect(back & (DISCONNECTED | SPECIFIC)).toBe(DISCONNECTED | SPECIFIC);
    expect((there | back) & (PRECEDING | FOLLOWING)).toBe(PRECEDING | FOLLOWING);
    expect(e.compareDocumentPosition(other)).toBe(there);
  });

  it('treats an attribute with no element as disconnected', () => {
    const { document, e } = sample();
    const attr = document.createAttribute('lone');
    expect(attr.compareDocumentPosition(e) & DISCONNECTED).toBe(DISCONNECTED);
  });

  it('treats an entity outside any document type as disconnected', () => {
    const { document } = sample();
    const entity = new Entity(document, 'loose', null, null, null);
    expect(entity.compareDocumentPosition(document) & DISCONNECTED).toBe(DISCONNECTED);
    expect(new Entity(null, 'none', null, null, null).compareDocumentPosition(document) & DISCONNECTED).toBe(
      DISCONNECTED
    );
  });

  it('treats a node removed from the tree as disconnected', () => {
    const { e, c } = sample();
    e.removeChild(c);
    expect(c.compareDocumentPosition(e) & DISCONNECTED).toBe(DISCONNECTED);
  });
});

describe('Node.isSameNode (DOM Level 3)', () => {
  it('is true only for the node itself', () => {
    const { e, c } = sample();
    expect([e.isSameNode(e), e.isSameNode(c), e.isSameNode(null)]).toEqual([true, false, false]);
  });
});

describe('Node.isEqualNode (DOM Level 3)', () => {
  it('is true for equal trees in different documents', () => {
    const xml = '<r xmlns:p="urn:p" a="1" p:b="2"><c>text<!--x--><?pi d?><![CDATA[c]]></c></r>';
    expect(build(xml).isEqualNode(build(xml))).toBe(true);
  });

  it('is false for null and for a node of another type', () => {
    const { e } = sample();
    expect([e.isEqualNode(null), e.isEqualNode(e.ownerDocument?.createTextNode('e') as Node)]).toEqual([false, false]);
  });

  it('is false for children of different types with the same name', () => {
    const document = newDocument();
    const [x, y] = [document.createElement('r'), document.createElement('r')];
    x.appendChild(document.createElement('e'));
    y.appendChild(document.createEntityReference('e'));
    expect([x.isEqualNode(y), y.isEqualNode(x)]).toEqual([false, false]);
  });

  it.each([
    ['names', '<r/>', '<s/>'],
    ['namespaces', '<r xmlns="urn:a"/>', '<r xmlns="urn:b"/>'],
    ['prefixes', '<p:r xmlns:p="urn:a"/>', '<q:r xmlns:q="urn:a"/>'],
    ['text', '<r>a</r>', '<r>b</r>'],
    ['child counts', '<r><c/></r>', '<r><c/><c/></r>'],
    ['children', '<r><c/></r>', '<r><d/></r>'],
    ['attribute values', '<r a="1"/>', '<r a="2"/>'],
    ['attribute counts', '<r a="1"/>', '<r a="1" b="2"/>'],
    ['attribute names', '<r a="1"/>', '<r b="1"/>'],
    ['comments', '<r><!--a--></r>', '<r><!--b--></r>'],
    ['processing instructions', '<r><?a?></r>', '<r><?b?></r>'],
  ])('is false for documents that differ in %s', (_name, a, b) => {
    expect(build(a).isEqualNode(build(b))).toBe(false);
  });

  it('ignores the order of attributes', () => {
    expect(build('<r a="1" b="2"/>').isEqualNode(build('<r b="2" a="1"/>'))).toBe(true);
  });

  it('compares DOM Level 1 attributes by name', () => {
    const [x, y] = [newDocument().createElement('e'), newDocument().createElement('e')];
    x.setAttribute('a', '1');
    y.setAttribute('a', '1');
    expect(x.isEqualNode(y)).toBe(true);
    y.setAttribute('a', '2');
    expect(x.isEqualNode(y)).toBe(false);
  });

  it('does not match a DOM Level 1 attribute with a DOM Level 2 one of the same name', () => {
    const [x, y] = [newDocument().createElement('e'), newDocument().createElement('e')];
    x.setAttribute('a', '1');
    y.setAttributeNS(null, 'a', '1');
    expect(x.isEqualNode(y)).toBe(false);
  });

  it('compares document types by their identifiers, subsets, entities and notations', () => {
    const dtd = (id: string, subset: string): Node =>
      build(`<!DOCTYPE r SYSTEM "${id}" [${subset}]><r/>`, { accessExternalDTD: [] }).doctype as Node;
    const subset = '<!ENTITY e "x"><!NOTATION n SYSTEM "n">';
    expect(dtd('a.dtd', subset).isEqualNode(dtd('a.dtd', subset))).toBe(true);
    expect(dtd('a.dtd', subset).isEqualNode(dtd('b.dtd', subset))).toBe(false);
    expect(dtd('a.dtd', subset).isEqualNode(dtd('a.dtd', '<!ENTITY e "y"><!NOTATION n SYSTEM "n">'))).toBe(false);
    expect(dtd('a.dtd', subset).isEqualNode(dtd('a.dtd', '<!ENTITY e "x"><!NOTATION n SYSTEM "m">'))).toBe(false);
  });

  it('ignores the order of entities, but compares the internal subset as written', () => {
    const doctype = build('<!DOCTYPE r [<!ENTITY a "1"><!ENTITY b "2">]><r/>').doctype as DocumentType;
    const reordered = doctype.cloneNode() as DocumentType;
    const [a, b] = reordered._entities;
    reordered._entities.splice(0, 2, b as Node, a as Node);
    expect(doctype.isEqualNode(reordered)).toBe(true);
    const rewritten = build('<!DOCTYPE r [<!ENTITY b "2"><!ENTITY a "1">]><r/>').doctype as Node;
    expect(doctype.isEqualNode(rewritten)).toBe(false);
  });

  it('compares document types with a different number of entities', () => {
    const a = build('<!DOCTYPE r [<!ENTITY a "1">]><r/>').doctype as Node;
    const b = build('<!DOCTYPE r [<!ENTITY a "1"><!ENTITY b "2">]><r/>').doctype as Node;
    expect(a.isEqualNode(b)).toBe(false);
  });

  it('is true for a deep clone', () => {
    const { document } = sample();
    expect(document.documentElement?.isEqualNode(document.documentElement.cloneNode(true))).toBe(true);
  });
});

describe('Node.setUserData and getUserData (DOM Level 3)', () => {
  it('keeps data by key and returns what the key held before', () => {
    const node = newDocument().createElement('e');
    expect(node.setUserData('k', 'one', null)).toBeNull();
    expect(node.setUserData('k', 'two', null)).toBe('one');
    expect([node.getUserData('k'), node.getUserData('other')]).toEqual(['two', null]);
  });

  it('removes data set to null', () => {
    const node = newDocument().createElement('e');
    node.setUserData('k', 'v', null);
    expect(node.setUserData('k', null, null)).toBe('v');
    expect(node.getUserData('k')).toBeNull();
  });

  it('keeps data apart for each node', () => {
    const document = newDocument();
    const [a, b] = [document.createElement('a'), document.createElement('b')];
    a.setUserData('k', 1, null);
    expect(b.getUserData('k')).toBeNull();
  });

  it('calls every handler, function or object, and none for data without one', () => {
    const node = newDocument().createElement('e');
    const fn = vi.fn();
    const object = { handle: vi.fn() };
    node.setUserData('f', 1, fn);
    node.setUserData('o', 2, object);
    node.setUserData('none', 3, null);
    const clone = node.cloneNode();
    expect(fn).toHaveBeenCalledWith(1, 'f', 1, node, clone);
    expect(object.handle).toHaveBeenCalledWith(1, 'o', 2, node, clone);
  });

  it('does not copy user data to a clone', () => {
    const node = newDocument().createElement('e');
    node.setUserData('k', 'v', null);
    expect(node.cloneNode().getUserData('k')).toBeNull();
  });
});
