import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import type { Element } from './element.ts';
import type { Entity } from './entity.ts';
import type { Node } from './node.ts';
import type { Notation } from './notation.ts';
import type { Text } from './text.ts';

// Module-level constants, so V8 can inline them.
const {
  ELEMENT_NODE,
  TEXT_NODE,
  CDATA_SECTION_NODE,
  ENTITY_REFERENCE_NODE,
  ENTITY_NODE,
  DOCUMENT_NODE,
  NOTATION_NODE,
} = NodeType;

/** Whether two property values are the same, taking undefined as null. */
export function same(value: unknown, other: unknown): boolean {
  return (value ?? null) === (other ?? null);
}

/** The document a node belongs to: itself, for a document. */
export function documentOf(node: Node): Document | null {
  return node.nodeType === DOCUMENT_NODE ? (node as Document) : node._owner;
}

/** Whether a node is text: a text node or a CDATA section. */
export function isText(node: Node): node is Text {
  return node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE;
}

/** Whether a node is an entity or notation the DTD declares. */
export function isDeclaration(node: Node): node is Entity | Notation {
  return node.nodeType === ENTITY_NODE || node.nodeType === NOTATION_NODE;
}

/** Whether a node is another or one of its descendants. */
export function within(node: Node, ancestor: Node): boolean {
  for (let current: Node | null = node; current !== null; current = current._parent)
    if (current === ancestor) return true;
  return false;
}

/** The node after one in document order, staying below a root; null after the root's last descendant. */
export function following(node: Node, root: Node): Node | null {
  return node._first ?? skipping(node, root);
}

/** The node after one and its descendants in document order, staying below a root. */
export function skipping(node: Node, root: Node): Node | null {
  for (let current: Node | null = node; current !== null && current !== root; current = current._parent)
    if (current._next !== null) return current._next;
  return null;
}

/** Appends a copy of each node below a source to the source's copy, in place; entity references are copied whole. */
export function copyBelow(source: Node, target: Node, copy: (node: Node) => Node): void {
  let into = target;
  let current = source._first;
  while (current !== null) {
    const made = copy(current);
    into._append(made);
    if (current.nodeType !== ENTITY_REFERENCE_NODE && current._first !== null) {
      into = made;
      current = current._first;
      continue;
    }
    // Climb to the nearest node with a next sibling, and its copy's parent with it.
    while (current._next === null) {
      current = current._parent as Node;
      if (current === source) return;
      into = into._parent as Node;
    }
    current = current._next;
  }
}

/** The nearest element above a node, past entity references (DOM Level 3 Appendix B). */
export function elementAbove(node: Node): Element | null {
  let current: Node | null = node._parent;
  while (current !== null && current.nodeType !== ELEMENT_NODE)
    current = current.nodeType === ENTITY_REFERENCE_NODE ? current._parent : null;
  return current as Element | null;
}

/** Makes a node and everything below it, attributes included, read-only or writable. */
export function markReadonly(root: Node, readonly: boolean): void {
  for (let current: Node | null = root; current !== null; current = following(current, root)) {
    current._readonly = readonly;
    if (current.nodeType === ELEMENT_NODE)
      for (const attr of (current as Element)._attributes) markReadonly(attr, readonly);
  }
}

/** Normalizes the text of a node and everything below it, attributes included. */
export function normalizeBelow(root: Node, nfc: boolean): void {
  for (let current: Node | null = root; current !== null; current = following(current, root)) {
    if (current._first !== null) normalizeText(current, nfc);
    if (current.nodeType === ELEMENT_NODE) for (const attr of (current as Element)._attributes) attr.normalize();
  }
}

/** Joins a node's adjacent text children and drops empty ones; NFC-normalizes text and CDATA when asked. */
function normalizeText(parent: Node, nfc: boolean): void {
  for (let child = parent.firstChild; child !== null;) {
    if (child.nodeType === TEXT_NODE) {
      child = normalizeTextChild(child as Text, nfc);
      continue;
    }
    if (nfc && child.nodeType === CDATA_SECTION_NODE) normalizeCharacters(child as Text);
    child = child._next;
  }
}

/** Drops an empty text child, or joins the text nodes after it into it, NFC-normalized when asked; returns the next child. */
function normalizeTextChild(text: Text, nfc: boolean): Node | null {
  const next = text._next;
  if (text._data === '') {
    text.remove();
    return next;
  }
  for (let sibling = next; sibling?.nodeType === TEXT_NODE; sibling = text._next) {
    text.appendData((sibling as Text)._data);
    sibling.remove();
  }
  if (nfc) normalizeCharacters(text);
  return text._next;
}

/** NFC-normalizes a text node, setting its data only when that changes it. */
export function normalizeCharacters(text: Text): void {
  const data = text._data.normalize('NFC');
  if (data !== text._data) text.data = data;
}
