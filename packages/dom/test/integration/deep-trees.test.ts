import { build, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { type Document, DocumentPosition, type Element, type Text, XMLSerializer } from '@/index.ts';

const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** How deep the trees go: deeper than the call stack lets a recursive walk go. */
const DEPTH = 10_000;

/** A tree of DEPTH nested p:a elements under r, the innermost with an xml:base, an xml:id and text. */
function deep(): { document: Document; root: Element; leaf: Element } {
  const document = build(
    '<r xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q" xml:base="http://example.com/a/">' +
      `${'<p:a>'.repeat(DEPTH - 1)}<p:a xml:base="b/" xml:id="deep">t</p:a>${'</p:a>'.repeat(DEPTH - 1)}</r>`,
    { limits: { elementDepth: DEPTH + 1 } }
  );
  const root = document.documentElement as Element;
  return { document, root, leaf: document.getElementById('deep') as Element };
}

/** How many elements a node holds. */
function count(node: Document | Element): number {
  return node.getElementsByTagNameNS('*', '*').length;
}

describe(`a tree ${DEPTH} elements deep`, () => {
  it('serializes it (XMLSerializer)', () => {
    const xml = new XMLSerializer().serializeToString(deep().document);
    expect(xml.split('<p:a').length - 1).toBe(DEPTH);
    expect(xml.endsWith(`t</p:a>${'</p:a>'.repeat(DEPTH - 1)}</r>`)).toBe(true);
  });

  it('finds elements by name and by ID', () => {
    const { document, leaf } = deep();
    expect([document.getElementsByTagName('p:a').length, count(document), leaf.firstChild?.nodeValue]).toEqual([
      DEPTH,
      DEPTH + 1,
      't',
    ]);
  });

  it('gives the text content', () => {
    expect(deep().root.textContent).toBe('t');
  });

  it('gives the base URI of the innermost element (XML Base)', () => {
    expect(deep().leaf.baseURI).toBe('http://example.com/a/b/');
  });

  it('looks up namespaces and prefixes declared at the top (DOM Level 3 Appendix B)', () => {
    const { leaf } = deep();
    expect([
      leaf.lookupNamespaceURI(null),
      leaf.lookupPrefix('urn:q'),
      leaf.isDefaultNamespace('urn:d'),
      leaf.isDefaultNamespace(null),
    ]).toEqual(['urn:d', 'q', true, false]);
  });

  it('compares the positions of the root and the innermost element', () => {
    const { root, leaf } = deep();
    expect(root.compareDocumentPosition(leaf)).toBe(
      DocumentPosition.DOCUMENT_POSITION_CONTAINED_BY | DocumentPosition.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('clones and compares the whole tree', () => {
    const { document } = deep();
    const copy = document.cloneNode(true) as Document;
    expect([count(copy), copy.isEqualNode(document)]).toEqual([DEPTH + 1, true]);
    ((copy.getElementById('deep') as Element).firstChild as Text).data = 'u';
    expect(copy.isEqualNode(document)).toBe(false);
  });

  it('imports and adopts the whole tree', () => {
    const { root } = deep();
    const imported = newDocument().importNode(root, true);
    const adopted = newDocument().adoptNode(deep().root) as Element;
    expect([count(imported), count(adopted)]).toEqual([DEPTH, DEPTH]);
    expect(adopted.getElementsByTagName('p:a').item(DEPTH - 1)?.ownerDocument).toBe(adopted.ownerDocument);
  });

  it('normalizes the text at the bottom', () => {
    const { document, leaf } = deep();
    leaf.appendChild(document.createTextNode('u'));
    document.normalize();
    expect([leaf.childNodes.length, leaf.textContent]).toEqual([1, 'tu']);
  });

  it('normalizes the document, declaring a namespace at the bottom (DOM Level 3 Appendix B.1)', () => {
    const { document, leaf } = deep();
    const inner = leaf.appendChild(document.createElementNS('urn:x', 'x:e'));
    document.normalizeDocument();
    expect(inner.getAttributeNS(XMLNS, 'x')).toBe('urn:x');
  });
});
