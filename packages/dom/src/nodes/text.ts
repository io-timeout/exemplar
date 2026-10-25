import { fail } from '../names.ts';
import { NodeType } from '../node-type.ts';
import { CharacterData } from './character-data.ts';
import type { Document } from './document.ts';
import { type Node, NodeFlag } from './node.ts';
import { isText, normalizeCharacters } from './tree.ts';

// Module-level constants, so V8 can inline them.
const { TEXT_NODE, ENTITY_REFERENCE_NODE } = NodeType;
const { IGNORABLE } = NodeFlag;

/** A text node: character data in an element, an attribute or an entity. CDATA sections extend it. */
export class Text extends CharacterData {
  /** Whether the parser found it to be whitespace in element content. @internal */
  get _ignorable(): boolean {
    return (this._flags & IGNORABLE) !== 0;
  }

  set _ignorable(on: boolean) {
    this._flags = on ? this._flags | IGNORABLE : this._flags & ~IGNORABLE;
  }

  get nodeType(): number {
    return TEXT_NODE;
  }

  get nodeName(): string {
    return '#text';
  }

  get isElementContentWhitespace(): boolean {
    return this._ignorable;
  }

  /** NFC-normalizes the text when the document's `normalize-characters` is on. */
  override normalize(): void {
    if (this._owner?.domConfig._is('normalize-characters') === true) normalizeCharacters(this);
  }

  _shallow(owner: Document): Node {
    const copy = new Text(owner, this._data);
    copy._ignorable = this._ignorable;
    return copy;
  }

  splitText(offset: number): Text {
    this._checkWritable();
    if (offset < 0 || offset > this._data.length) fail('IndexSizeError', 'The offset is outside the text');
    const rest = this._shallow(this._owner as Document) as Text;
    rest._data = this._data.slice(offset);
    this._data = this._data.slice(0, offset);
    this._parent?._insert(rest, this._next);
    return rest;
  }

  /** The text of this node and the text nodes logically next to it (DOM Level 3). */
  get wholeText(): string {
    return logicalText(this)
      .map((node) => node.data)
      .join('');
  }

  /** Replaces this node and the text logically next to it with one node holding the text (DOM Level 3). */
  replaceWholeText(content: string): Text | null {
    const parent = this._parent;
    if (content === '') {
      this.remove();
      return null;
    }
    if (!replaceable(this, false) || !replaceable(this, true)) {
      fail('NoModificationAllowedError', 'The text runs into an entity reference that holds more than text');
    }
    if (!this._readonly) {
      this.data = content;
      removeLogicalText(this);
      return this;
    }
    const keep = (this._owner as Document).createTextNode(content);
    if (parent === null) return keep;
    parent.insertBefore(keep, this);
    this.remove();
    removeLogicalText(keep);
    return keep;
  }
}

/** Removes the text nodes, CDATA sections and text-only entity references either side of a text node. */
function removeLogicalText(text: Text): void {
  if (text._parent === null) return;
  for (let sibling = text._prev; sibling !== null && isLogicalText(sibling); sibling = text._prev) sibling.remove();
  for (let sibling = text._next; sibling !== null && isLogicalText(sibling); sibling = text._next) sibling.remove();
}

/** The text nodes logically adjacent to one, across entity references, in document order. */
function logicalText(text: Text): Text[] {
  const after: Text[] = [text];
  const before: Text[] = [];
  for (let sibling = text._prev; sibling !== null && isLogicalText(sibling); sibling = sibling._prev)
    before.unshift(...textsOf(sibling));
  for (let sibling = text._next; sibling !== null && isLogicalText(sibling); sibling = sibling._next)
    after.push(...textsOf(sibling));
  return [...before, ...after];
}

/** The next or previous sibling. */
function siblingOf(node: Node, forward: boolean): Node | null {
  return forward ? node._next : node._prev;
}

/** Whether replacing a node's whole text can remove what lies after (or before) it without changing inside an entity reference. */
function replaceable(node: Node, forward: boolean): boolean {
  const seen = { text: false };
  for (let sibling = siblingOf(node, forward); sibling !== null; sibling = siblingOf(sibling, forward)) {
    if (isText(sibling)) continue;
    if (sibling.nodeType !== ENTITY_REFERENCE_NODE) return true;
    const verdict = insideReference(sibling, forward, seen);
    if (verdict !== undefined) return verdict;
  }
  return true;
}

/** Reads into an entity reference as Xerces does: false when it blocks the replacement, true when the text ends in it. */
function insideReference(reference: Node, forward: boolean, seen: { text: boolean }): boolean | undefined {
  let child = forward ? reference.firstChild : reference.lastChild;
  if (child === null) return false;
  for (; child !== null; child = siblingOf(child, forward)) {
    if (child.nodeType === ENTITY_REFERENCE_NODE && !replaceable(child, forward)) return false;
    if (!isText(child) && child.nodeType !== ENTITY_REFERENCE_NODE) return !seen.text;
    seen.text = true;
  }
  return undefined;
}

/** Whether a node is text, or an entity reference holding only text. */
function isLogicalText(node: Node): boolean {
  return isText(node) || (node.nodeType === ENTITY_REFERENCE_NODE && textOnly(node));
}

/** The text nodes a node is or holds. */
function textsOf(node: Node): Text[] {
  return node.nodeType === ENTITY_REFERENCE_NODE ? textsIn(node) : [node as Text];
}

/** Whether every child of a node is text, or an entity reference holding only text. */
function textOnly(node: Node): boolean {
  for (let child = node.firstChild; child !== null; child = child._next) if (!isLogicalText(child)) return false;
  return true;
}

/** The text nodes below an entity reference that holds only text, in document order. */
function textsIn(node: Node): Text[] {
  const texts: Text[] = [];
  for (let child = node.firstChild; child !== null; child = child._next) {
    if (isText(child)) texts.push(child);
    else texts.push(...textsIn(child));
  }
  return texts;
}
