import { DocumentPosition, NodeType } from '../node-type.ts';
import type { Attr } from './attr.ts';
import type { DocumentType } from './document-type.ts';
import type { Element } from './element.ts';
import type { Node } from './node.ts';
import { isDeclaration } from './tree.ts';

// Module-level constants, so V8 can inline them.
const { ATTRIBUTE_NODE, ENTITY_NODE } = NodeType;
const { DOCUMENT_POSITION_PRECEDING, DOCUMENT_POSITION_FOLLOWING, DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC } =
  DocumentPosition;

/** A number for each node, used to order nodes in different trees consistently. */
const identities = new WeakMap<Node, number>();
let nextIdentity = 0;

export function identity(node: Node): number {
  let id = identities.get(node);
  if (id === undefined) {
    id = ++nextIdentity;
    identities.set(node, id);
  }
  return id;
}

/** The node that holds a node: an attribute's element, a declaration's document type, or the parent. */
function container(node: Node): Node | null {
  if (node.nodeType === ATTRIBUTE_NODE) return (node as Attr)._ownerElement;
  if (!isDeclaration(node)) return node._parent;
  const doctype = node._owner?.doctype ?? null;
  return doctype !== null && [...doctype._entities, ...doctype._notations].includes(node) ? doctype : null;
}

/** A node and the nodes that hold it, outermost first. */
export function ancestry(node: Node): Node[] {
  const chain: Node[] = [];
  for (let holder: Node | null = node; holder !== null; holder = container(holder)) chain.push(holder);
  return chain.toReversed();
}

/** How a node relates to another with the same holder, as Xerces orders them. */
export function siblingOrder(first: Node, second: Node): number {
  if (first.nodeType === ATTRIBUTE_NODE || second.nodeType === ATTRIBUTE_NODE) return attributeOrder(first, second);
  if (isDeclaration(first)) return declarationOrder(first, second);
  for (let sibling = first._next; sibling !== null; sibling = sibling._next)
    if (sibling === second) return DOCUMENT_POSITION_FOLLOWING;
  return DOCUMENT_POSITION_PRECEDING;
}

/** Following when the first node comes first, preceding when the second does. */
export function orderOf(firstComesFirst: boolean): number {
  return firstComesFirst ? DOCUMENT_POSITION_FOLLOWING : DOCUMENT_POSITION_PRECEDING;
}

/** Following or preceding, as one node comes before another in a list, marked implementation-specific. */
function listOrder(list: readonly Node[], first: Node, second: Node): number {
  return orderOf(list.indexOf(first) < list.indexOf(second)) | DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
}

/** Attributes come before their element's children, in the order of the element's map. */
function attributeOrder(first: Node, second: Node): number {
  if (first.nodeType !== second.nodeType) return orderOf(first.nodeType === ATTRIBUTE_NODE);
  return listOrder(((first as Attr)._ownerElement as Element)._attributes, first, second);
}

/** Entities come before notations, each in the order of their document type's map. */
function declarationOrder(first: Node, second: Node): number {
  if (first.nodeType !== second.nodeType) return orderOf(first.nodeType === ENTITY_NODE);
  const doctype = container(first) as DocumentType;
  return listOrder(first.nodeType === ENTITY_NODE ? doctype._entities : doctype._notations, first, second);
}
