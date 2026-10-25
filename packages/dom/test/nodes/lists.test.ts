import { build, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it, vi } from 'vitest';
import {
  type Attr,
  type Document,
  type DocumentFragment,
  Element,
  type NamedNodeMap,
  type Node,
  NodeList,
  Text,
} from '@/index.ts';

/** A document `<r><a/><b/><c/></r>` and its nodes. */
function tree(): { document: Document; r: Element; a: Element; b: Element; c: Element } {
  const document = build('<r><a/><b/><c/></r>');
  const r = document.documentElement as Element;
  const [a, b, c] = [...r.childNodes] as Element[];
  return { document, r, a: a as Element, b: b as Element, c: c as Element };
}

/** The node names a list holds by index, up to its length. */
function names(list: { readonly length: number; readonly [index: number]: Node }): string[] {
  return Array.from({ length: list.length }, (_, i) => list[i]?.nodeName ?? 'missing');
}

describe('NodeList', () => {
  const document = build('<r><a/><b/><c/></r>');
  const list = (document.documentElement as Element).childNodes;

  it('gives its length and its items, null outside it (DOM Level 3 NodeList)', () => {
    expect(list).toHaveLength(3);
    expect(list.item(0)?.nodeName).toBe('a');
    expect([list.item(3), list.item(-1), list.item(1.5), list.item(Number.NaN)]).toEqual([null, null, null, null]);
  });

  it('answers to indexes, as browsers lists do', () => {
    const indexed = list as unknown as Record<string, Node | undefined>;
    expect(indexed[2]?.nodeName).toBe('c');
    expect(indexed[3]).toBeUndefined();
    expect([0 in list, 3 in list, 'length' in list, 'nothing' in list]).toEqual([true, false, true, false]);
  });

  it('iterates its nodes in order', () => {
    expect([...list].map((n) => n.nodeName)).toEqual(['a', 'b', 'c']);
  });

  it('calls forEach with each node, its index and the list', () => {
    const seen = vi.fn();
    // oxlint-disable-next-line unicorn/no-array-for-each -- NodeList.forEach is the method under test
    list.forEach((node, index, of) => seen(node, index, of));
    expect(seen.mock.calls.map(([node, index, of]) => [node.nodeName, index, of === list])).toEqual([
      ['a', 0, true],
      ['b', 1, true],
      ['c', 2, true],
    ]);
  });

  it('is live: it follows changes to the children, index properties included', () => {
    const doc = build('<r><a/><c/></r>');
    const r = doc.documentElement as Element;
    const live = r.childNodes;
    const b = r.insertBefore(doc.createElement('b'), r.lastChild);
    const d = r.appendChild(doc.createElement('d'));
    expect([live.length, live[1], live[3]]).toEqual([4, b, d]);
    r.removeChild(d);
    (r.firstChild as Node).remove();
    expect([live.length, live[0], live[2], 2 in live]).toEqual([2, b, undefined, false]);
  });
});

describe('NamedNodeMap of attributes', () => {
  /** An element with attributes a="1" and p:b="2" in urn:p. */
  function element(): Element {
    return build('<r a="1" xmlns:p="urn:p" p:b="2"/>').documentElement as Element;
  }

  it('gives its length and items by index, null outside it (DOM Level 3 NamedNodeMap)', () => {
    const map = element().attributes;
    expect(map).toHaveLength(3);
    expect([map.item(0)?.nodeName, map.item(3), map.item(-1), map.item(0.5)]).toEqual(['a', null, null, null]);
  });

  it('answers to indexes and iterates', () => {
    const map = element().attributes;
    expect((map as unknown as Record<number, Node>)[1]?.nodeName).toBe('xmlns:p');
    expect([...map].map((a) => a.nodeName)).toEqual(['a', 'xmlns:p', 'p:b']);
    expect(2 in map).toBe(true);
  });

  it('finds a node by name, and by namespace and local name', () => {
    const map = element().attributes;
    expect(map.getNamedItem('p:b')?.nodeValue).toBe('2');
    expect(map.getNamedItem('b')).toBeNull();
    expect(map.getNamedItemNS('urn:p', 'b')?.nodeValue).toBe('2');
    expect(map.getNamedItemNS('', 'a')?.nodeValue).toBe('1');
  });

  it('sets an attribute with setNamedItem and returns the one it replaces', () => {
    const r = element();
    const attr = (r.ownerDocument as NonNullable<Element['ownerDocument']>).createAttribute('a');
    const old = r.attributes.setNamedItem(attr);
    expect(old?.nodeValue).toBe('1');
    expect(r.getAttributeNode('a')).toBe(attr);
  });

  it('sets an attribute with setNamedItemNS', () => {
    const r = element();
    const attr = (r.ownerDocument as NonNullable<Element['ownerDocument']>).createAttributeNS('urn:p', 'q:b');
    expect(r.attributes.setNamedItemNS(attr)?.nodeName).toBe('p:b');
    expect(r.getAttributeNodeNS('urn:p', 'b')).toBe(attr);
  });

  it('raises HIERARCHY_REQUEST_ERR when setting a node that is not an attribute', () => {
    const r = element();
    const text = (r.ownerDocument as NonNullable<Element['ownerDocument']>).createTextNode('t');
    expect(() => r.attributes.setNamedItem(text)).toThrow(domException('HierarchyRequestError'));
    expect(() => r.attributes.setNamedItemNS(text)).toThrow(domException('HierarchyRequestError'));
  });

  it('removes an attribute by name or by namespace and local name', () => {
    const r = element();
    expect(r.attributes.removeNamedItem('a').nodeValue).toBe('1');
    expect(r.attributes.removeNamedItemNS('urn:p', 'b').nodeValue).toBe('2');
    expect([...r.attributes].map((a) => a.nodeName)).toEqual(['xmlns:p']);
  });

  it('raises NOT_FOUND_ERR when removing an attribute that is not there', () => {
    const r = element();
    expect(() => r.attributes.removeNamedItem('x')).toThrow(domException('NotFoundError'));
    expect(() => r.attributes.removeNamedItemNS('urn:p', 'x')).toThrow(domException('NotFoundError'));
  });

  it('is live: it sees attributes added later', () => {
    const r = element();
    const map = r.attributes;
    r.setAttribute('c', '3');
    expect(map.getNamedItem('c')?.nodeValue).toBe('3');
  });

  it('stays the same map, and live, for an element that had no attributes', () => {
    const r = build('<r/>').documentElement as Element;
    const map = r.attributes;
    expect(r.attributes).toBe(map);
    r.setAttribute('a', '1');
    expect(map).toHaveLength(1);
  });
});

describe('NamedNodeMap of declarations', () => {
  const document = build('<!DOCTYPE r [<!ENTITY e "x"><!NOTATION n SYSTEM "n">]><r/>');
  const entities = document.doctype?.entities as NamedNodeMap;

  it('finds a declaration by name', () => {
    expect(entities.getNamedItem('e')?.nodeType).toBe(6);
    expect(document.doctype?.notations.getNamedItem('n')?.nodeType).toBe(12);
  });

  it('finds no entity by namespace, as entities have no local name (DOM Level 2 getNamedItemNS)', () => {
    expect(entities.getNamedItemNS(null, 'e')).toBeNull();
    expect(entities.getNamedItemNS('', 'e')).toBeNull();
  });

  it.each([
    ['setNamedItem', (map: NamedNodeMap) => map.setNamedItem(document.createAttribute('x'))],
    ['setNamedItemNS', (map: NamedNodeMap) => map.setNamedItemNS(document.createAttribute('x'))],
    ['removeNamedItem', (map: NamedNodeMap) => map.removeNamedItem('e')],
    ['removeNamedItemNS', (map: NamedNodeMap) => map.removeNamedItemNS(null, 'e')],
  ])('raises NO_MODIFICATION_ALLOWED_ERR from %s, as the map is read-only', (_name, change) => {
    expect(() => change(entities)).toThrow(domException('NoModificationAllowedError'));
  });

  it('answers to indexes', () => {
    expect((entities as unknown as Record<number, Node>)[0]?.nodeName).toBe('e');
  });
});

describe('live lists', () => {
  it('see nodes added and removed (DOM Level 1 NodeList)', () => {
    const { document, r, a } = tree();
    const all = document.getElementsByTagName('*');
    expect(all).toHaveLength(4);
    a.appendChild(document.createElement('x'));
    expect([...all].map((e) => e.nodeName)).toEqual(['r', 'a', 'x', 'b', 'c']);
    r.removeChild(a);
    expect(all).toHaveLength(3);
  });

  it('see a child list change', () => {
    const { document, r } = tree();
    const list = r.childNodes;
    r.insertBefore(document.createComment('c'), r.firstChild);
    expect(list.item(0)?.nodeName).toBe('#comment');
  });

  it('reads the tree again only once it has changed', () => {
    const { document } = tree();
    const list = document.getElementsByTagName('*');
    const first = list.item(0);
    expect([list.length, list.item(0)]).toEqual([4, first]);
  });

  it('let nodes made without a document hold children', () => {
    const parent = new Element(null, 'p', null, null);
    const child = parent.appendChild(new Text(null, 't'));
    expect([parent.firstChild, child.parentNode, parent.textContent]).toEqual([child, parent, 't']);
    parent.removeChild(child);
    expect(parent.hasChildNodes()).toBe(false);
  });
});

describe('childNodes, kept up to date', () => {
  it('answers every kind of read after changes other than at the end', () => {
    const document = build('<r><a/><b/><c/></r>');
    const r = document.documentElement as Element;
    const list = r.childNodes;
    (r.firstChild as Node).remove();
    r.insertBefore(document.createElement('x'), r.firstChild);
    expect([list instanceof NodeList, 0 in list, 3 in list]).toEqual([true, true, false]);
    (r.firstChild as Node).remove();
    expect([list.length, list.item(1)?.nodeName, [...list].map((n) => n.nodeName)]).toEqual([2, 'c', ['b', 'c']]);
    r.insertBefore(document.createElement('y'), r.lastChild);
    const seen: string[] = [];
    // oxlint-disable-next-line unicorn/no-array-for-each -- NodeList.forEach is under test
    list.forEach((node) => seen.push(node.nodeName));
    expect([seen, list[1]?.nodeName]).toEqual([['b', 'y', 'c'], 'y']);
  });

  it('follows a child moved from one parent to another', () => {
    const document = build('<r><a><x/></a><b/></r>');
    const [a, b] = [...(document.documentElement as Element).childNodes] as Element[];
    const [fromA, toB] = [(a as Element).childNodes, (b as Element).childNodes];
    (b as Element).appendChild((a as Element).firstChild as Node);
    expect([names(fromA), names(toB), 0 in fromA]).toEqual([[], ['x'], false]);
  });

  it('follows a fragment whose children are inserted', () => {
    const document = build('<r><a/></r>');
    const r = document.documentElement as Element;
    const fragment: DocumentFragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('f1'));
    fragment.appendChild(document.createElement('f2'));
    const [list, fragmentList] = [r.childNodes, fragment.childNodes];
    r.insertBefore(fragment, r.firstChild);
    expect([names(list), names(fragmentList)]).toEqual([['f1', 'f2', 'a'], []]);
  });

  it('follows textContent replacing the children', () => {
    const document = build('<r><a/><b/>t</r>');
    const r = document.documentElement as Element;
    const list = r.childNodes;
    r.textContent = 'new';
    expect([names(list), (list[0] as Text).data, 1 in list]).toEqual([['#text'], 'new', false]);
  });

  it("follows an attribute's text child when its value is set again", () => {
    const document = newDocument();
    const attr = document.createAttribute('a');
    attr.value = 'old';
    const list = attr.childNodes;
    expect([(list[0] as Text).data, attr.value]).toEqual(['old', 'old']);
    attr.value = 'new';
    expect([list.length, (list[0] as Text).data]).toEqual([1, 'new']);
  });

  it('follows an entity reference given the expansion of the document it is adopted into', () => {
    const source = build('<!DOCTYPE r [<!ENTITY m "<b>ours</b>">]><r>&m;</r>');
    const fragment = source.createDocumentFragment();
    const list = fragment.appendChild(source.createEntityReference('m')).childNodes;
    expect(names(list)).toEqual(['b']);
    build('<!DOCTYPE r [<!ENTITY m "<i>theirs</i><j/>">]><r>&m;</r>').adoptNode(fragment);
    expect(names(list)).toEqual(['i', 'j']);
  });

  it('gives an iterator that is itself iterable, as array iterators are', () => {
    const list = (build('<r><a/><b/></r>').documentElement as Element).childNodes;
    const iterator = list[Symbol.iterator]();
    expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect(Array.from(iterator, (n) => n.nodeName)).toEqual(['a', 'b']);
  });

  it('iterates the nodes it holds when iteration reaches them, as browsers do', () => {
    const document = build('<r><a/></r>');
    const r = document.documentElement as Element;
    const seen: string[] = [];
    for (const child of r.childNodes) {
      seen.push(child.nodeName);
      if (seen.length === 1) r.appendChild(document.createElement('b'));
    }
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('attributes, kept up to date', () => {
  /** An element with a defaulted attribute d, a specified a, and its map. */
  function withDefault(): { document: Document; r: Element } {
    const document = build('<!DOCTYPE r [<!ATTLIST r d CDATA "dv">]><r a="1"/>');
    return { document, r: document.documentElement as Element };
  }

  it('follows attributes added, replaced and removed', () => {
    const { document, r } = withDefault();
    const map = r.attributes;
    r.setAttribute('b', '2');
    const replacement = document.createAttribute('a');
    r.setAttributeNode(replacement);
    expect([names(map), map[0] === replacement]).toEqual([['a', 'd', 'b'], true]);
    r.removeAttribute('b');
    expect([names(map), 2 in map]).toEqual([['a', 'd'], false]);
  });

  it('follows a removed default coming back', () => {
    const { r } = withDefault();
    const map = r.attributes;
    r.removeAttribute('d');
    expect([names(map), (map[1] as Attr).specified]).toEqual([['a', 'd'], false]);
  });

  it('follows the defaults an adopted element gains and loses', () => {
    const { r } = withDefault();
    const map = r.attributes;
    build('<!DOCTYPE r [<!ATTLIST r e CDATA "ev">]><x/>').adoptNode(r);
    expect(names(map)).toEqual(['a', 'e']);
  });
});

describe('entities and notations', () => {
  it('answer to indexes, in a built document and in its clone', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "x"><!ENTITY f "y"><!NOTATION n SYSTEM "n">]><r/>');
    const clone = document.cloneNode(true) as Document;
    for (const doctype of [document.doctype, clone.doctype]) {
      expect([names(doctype?.entities ?? []), names(doctype?.notations ?? [])]).toEqual([['e', 'f'], ['n']]);
    }
  });
});

describe('getElementsByTagName, kept up to date', () => {
  it('answers to indexes, keys and iteration after the tree changes', () => {
    const document = build('<r><a/><b><a/></b></r>');
    const list = document.getElementsByTagName('a');
    expect(names(list)).toEqual(['a', 'a']);
    (document.documentElement as Element).appendChild(document.createElement('a'));
    expect([list.length, 2 in list, Object.keys(list).filter((k) => /^\d+$/.test(k))]).toEqual([
      3,
      true,
      ['0', '1', '2'],
    ]);
    ((document.documentElement as Element).firstChild as Node).remove();
    expect([[...list].length, list[2], list.item(1)?.parentNode?.nodeName]).toEqual([2, undefined, 'r']);
  });
});
