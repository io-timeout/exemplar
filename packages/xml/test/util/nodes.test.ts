import { describe, expect, it } from 'vitest';
import { XMLNS_NAMESPACE } from '@/util/namespaces.ts';
import { type NodeLike, NodeType, attributesOf, prefixDeclaredBy } from '@/util/nodes.ts';

/** An attribute node, namespaced unless its local name is null. */
function attr(nodeName: string, localName: string | null, namespaceURI: string | null = null): NodeLike<never> {
  return { nodeName, localName, namespaceURI } as NodeLike<never>;
}

describe('NodeType', () => {
  it('numbers the node types as DOM Level 3 does', () => {
    expect(Object.values(NodeType)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([NodeType.ELEMENT_NODE, NodeType.DOCUMENT_NODE, NodeType.NOTATION_NODE]).toEqual([1, 9, 12]);
  });
});

describe('prefixDeclaredBy', () => {
  it.each([
    ['xmlns, the default namespace', attr('xmlns', 'xmlns', XMLNS_NAMESPACE), ''],
    ['a DOM Level 2 xmlns:p in the xmlns namespace', attr('xmlns:p', 'p', XMLNS_NAMESPACE), 'p'],
    ['a DOM Level 1 xmlns:p', attr('xmlns:p', null), 'p'],
    ['a DOM Level 1 xmlns', attr('xmlns', null), ''],
    ['a DOM Level 2 xmlns:p in another namespace', attr('xmlns:p', 'p', 'urn:other'), undefined],
    ['an ordinary attribute', attr('a', null), undefined],
    ['a name that only starts with xmlns', attr('xmlnsx', null), undefined],
    ['xmlns: with no prefix', attr('xmlns:', null), undefined],
  ])('gives the prefix %s declares', (_title, node, prefix) => {
    expect(prefixDeclaredBy(node)).toBe(prefix);
  });
});

describe('attributesOf', () => {
  it("lists an element's attributes, and none when it has no attribute map", () => {
    const [a, b] = [attr('a', null), attr('b', null)];
    const element = { attributes: { length: 2, item: (i: number) => [a, b][i] ?? null } } as NodeLike<NodeLike<never>>;
    expect(attributesOf(element)).toEqual([a, b]);
    expect(attributesOf({ attributes: null } as NodeLike<never>)).toEqual([]);
  });
});
