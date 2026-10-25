import { XMLNS_NAMESPACE } from './namespaces.ts';

/** The node types, numbered as DOM Level 3 numbers them. */
export const NodeType = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5,
  ENTITY_NODE: 6,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12,
} as const;

/** How the name of an attribute that declares a prefix starts, as in `xmlns:p="…"`. */
const XMLNS_COLON = 'xmlns:';

/**
 * The parts of a DOM Level 2 node that the writer and canonicalization read, so they work on any
 * DOM: exemplar's own, or another library's. `N` is that DOM's node type.
 */
export interface NodeLike<N> {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly namespaceURI: string | null;
  readonly localName: string | null;
  readonly firstChild: N | null;
  readonly nextSibling: N | null;
  readonly parentNode: N | null;
  readonly attributes?: { readonly length: number; item(index: number): N | null } | null;
}

/**
 * The prefix an attribute declares, if it is a namespace declaration: `p` for `xmlns:p`, `''` for
 * `xmlns`, which declares the default namespace. Undefined for any other attribute.
 */
export function prefixDeclaredBy(attribute: NodeLike<unknown>): string | undefined {
  const name = attribute.nodeName;
  if (name === 'xmlns') return '';
  if (
    name.length > XMLNS_COLON.length &&
    name.startsWith(XMLNS_COLON) &&
    (attribute.localName === null || attribute.namespaceURI === XMLNS_NAMESPACE)
  ) {
    return name.slice(XMLNS_COLON.length);
  }
  return undefined;
}

/** An element's attributes as a list. */
export function attributesOf<N>(node: NodeLike<N>): N[] {
  const attributes = node.attributes;
  return Array.from({ length: attributes?.length ?? 0 }, (_, i) => attributes?.item(i) as N);
}
