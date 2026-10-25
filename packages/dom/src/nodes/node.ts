// Imports no subclass of Node: one loaded first would extend Node before it exists.
import { XMLNS_NAMESPACE } from '@exemplarjs/xml/internal';
import { fail, orNull } from '../names.ts';
import { DocumentPosition, NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import type { Element } from './element.ts';
import { hasFeature } from './features.ts';
import { ChildList, type NamedNodeMap, type NodeList } from './lists.ts';
import { boundPrefix } from './namespaces.ts';
import { ancestry, identity, orderOf, siblingOrder } from './order.ts';
import {
  copyBelow,
  documentOf,
  elementAbove,
  following,
  isText,
  markReadonly,
  normalizeBelow,
  same,
  within,
} from './tree.ts';

// Module-level constants, so V8 can inline them.
const {
  ELEMENT_NODE,
  ATTRIBUTE_NODE,
  TEXT_NODE,
  CDATA_SECTION_NODE,
  ENTITY_REFERENCE_NODE,
  ENTITY_NODE,
  PROCESSING_INSTRUCTION_NODE,
  COMMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_TYPE_NODE,
  DOCUMENT_FRAGMENT_NODE,
  NOTATION_NODE,
} = NodeType;
const {
  DOCUMENT_POSITION_DISCONNECTED,
  DOCUMENT_POSITION_PRECEDING,
  DOCUMENT_POSITION_FOLLOWING,
  DOCUMENT_POSITION_CONTAINS,
  DOCUMENT_POSITION_CONTAINED_BY,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC,
} = DocumentPosition;

/** What happened to a node with user data, as `UserDataHandler` hears of it. */
export const UserDataOperation = {
  NODE_CLONED: 1,
  NODE_IMPORTED: 2,
  NODE_DELETED: 3,
  NODE_RENAMED: 4,
  NODE_ADOPTED: 5,
} as const;

/** Hears when a node holding user data is cloned, imported, renamed or adopted; a function, or an object with `handle`. */
export type UserDataHandler =
  | ((operation: number, key: string, data: unknown, src: Node | null, dst: Node | null) => void)
  | { handle(operation: number, key: string, data: unknown, src: Node | null, dst: Node | null): void };

/** The bits of `_flags`. */
export const NodeFlag = {
  /** The node sits under an entity or entity reference, and cannot change. */
  READONLY: 1,
  /** A text node is whitespace in element content. */
  IGNORABLE: 2,
  /** An attribute was written in the document rather than defaulted. */
  SPECIFIED: 4,
  /** An attribute is an ID. */
  ID: 8,
  /** The node has a child list, or an element an attribute map, that changes must keep up to date. */
  CHILD_LIST: 16,
  ATTRIBUTE_MAP: 32,
} as const;
const { READONLY, CHILD_LIST } = NodeFlag;

/** What few nodes have, kept beside them: user data, and child arrays and lists while in use. */
const userData = new WeakMap<Node, Map<string, [unknown, UserDataHandler | null]>>();
const childArrays = new WeakMap<Node, Node[]>();
const childLists = new WeakMap<Node, ChildList>();

/** Keeps a node's child list up to date after a child was linked in: at the end, or by dropping its items. */
function childAdded(parent: Node, child: Node): void {
  const list = childLists.get(parent) as ChildList;
  if (!list._current) return;
  if (child._next === null) list._push(child);
  else list._drop();
}

/** Keeps a node's child list up to date after a child, the last or another, was unlinked. */
function childRemoved(parent: Node, wasLast: boolean): void {
  const list = childLists.get(parent) as ChildList;
  if (!list._current) return;
  if (wasLast) list._trim(list._length - 1);
  else list._drop();
}

/** The node types an element, entity, entity reference or document fragment may hold. */
const CONTENT_TYPES: ReadonlySet<number> = new Set<number>([
  ELEMENT_NODE,
  TEXT_NODE,
  CDATA_SECTION_NODE,
  ENTITY_REFERENCE_NODE,
  PROCESSING_INSTRUCTION_NODE,
  COMMENT_NODE,
]);

/** Which node types each type of node may hold as children. */
const ALLOWED_CHILD_TYPES: Readonly<Record<number, ReadonlySet<number>>> = {
  [ELEMENT_NODE]: CONTENT_TYPES,
  [ATTRIBUTE_NODE]: new Set<number>([TEXT_NODE, ENTITY_REFERENCE_NODE]),
  [ENTITY_REFERENCE_NODE]: CONTENT_TYPES,
  [ENTITY_NODE]: CONTENT_TYPES,
  [DOCUMENT_NODE]: new Set<number>([ELEMENT_NODE, PROCESSING_INSTRUCTION_NODE, COMMENT_NODE, DOCUMENT_TYPE_NODE]),
  [DOCUMENT_FRAGMENT_NODE]: CONTENT_TYPES,
};

/**
 * Any node of the tree, following DOM Level 3 Core's Node: elements, attributes, text, comments and
 * the rest all extend it. A node links to its parent, its first and last children and its siblings
 * (`_parent`, `_first`, `_last`, `_prev`, `_next`), so walking and changing the tree costs no arrays;
 * `childNodes` and the other lists are made only when asked for, and kept live.
 *
 * Fields starting with `_` are for exemplar's own use: the builder and the other node classes set
 * them directly, skipping the checks the public methods make, which keeps building a tree fast.
 */
// No #private methods here or in subclasses on the hot path: a private brand stops V8 inlining their constructors.
export abstract class Node {
  static readonly ELEMENT_NODE = ELEMENT_NODE;
  static readonly ATTRIBUTE_NODE = ATTRIBUTE_NODE;
  static readonly TEXT_NODE = TEXT_NODE;
  static readonly CDATA_SECTION_NODE = CDATA_SECTION_NODE;
  static readonly ENTITY_REFERENCE_NODE = ENTITY_REFERENCE_NODE;
  static readonly ENTITY_NODE = ENTITY_NODE;
  static readonly PROCESSING_INSTRUCTION_NODE = PROCESSING_INSTRUCTION_NODE;
  static readonly COMMENT_NODE = COMMENT_NODE;
  static readonly DOCUMENT_NODE = DOCUMENT_NODE;
  static readonly DOCUMENT_TYPE_NODE = DOCUMENT_TYPE_NODE;
  static readonly DOCUMENT_FRAGMENT_NODE = DOCUMENT_FRAGMENT_NODE;
  static readonly NOTATION_NODE = NOTATION_NODE;
  static readonly DOCUMENT_POSITION_DISCONNECTED = DOCUMENT_POSITION_DISCONNECTED;
  static readonly DOCUMENT_POSITION_PRECEDING = DOCUMENT_POSITION_PRECEDING;
  static readonly DOCUMENT_POSITION_FOLLOWING = DOCUMENT_POSITION_FOLLOWING;
  static readonly DOCUMENT_POSITION_CONTAINS = DOCUMENT_POSITION_CONTAINS;
  static readonly DOCUMENT_POSITION_CONTAINED_BY = DOCUMENT_POSITION_CONTAINED_BY;
  static readonly DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;

  // Fields are declared and set once in the constructor, which builds nodes faster than class fields do.
  /** @internal */ declare _owner: Document | null;
  /** @internal */ declare _parent: Node | null;
  /** @internal */ declare _first: Node | null;
  /** @internal */ declare _last: Node | null;
  /** @internal */ declare _prev: Node | null;
  /** @internal */ declare _next: Node | null;
  /** Bits for the node's booleans, kept in one field to save memory. @internal */
  declare _flags: number;

  constructor(owner: Document | null) {
    this._owner = owner;
    this._parent = null;
    this._prev = null;
    this._next = null;
    this._flags = 0;
  }

  /** Gives a node that can hold children its child links; nodes that cannot read null ones from their prototype. @internal */
  _holdsChildren(): void {
    this._first = null;
    this._last = null;
  }

  /** Whether the node sits under an entity, and so cannot change. @internal */
  get _readonly(): boolean {
    return (this._flags & READONLY) !== 0;
  }

  set _readonly(on: boolean) {
    this._flags = on ? this._flags | READONLY : this._flags & ~READONLY;
  }

  abstract get nodeType(): number;
  abstract get nodeName(): string;

  get nodeValue(): string | null {
    return null;
  }

  set nodeValue(_value: string | null) {
    // Setting it has no effect where it is null (DOM Level 1).
  }

  get ownerDocument(): Document | null {
    return this._owner;
  }

  get parentNode(): Node | null {
    return this._parent;
  }

  get parentElement(): Element | null {
    return this._parent?.nodeType === ELEMENT_NODE ? (this._parent as Element) : null;
  }

  get firstChild(): Node | null {
    return this._first;
  }

  get lastChild(): Node | null {
    return this._last;
  }

  get previousSibling(): Node | null {
    return this._prev;
  }

  get nextSibling(): Node | null {
    return this._next;
  }

  get childNodes(): NodeList {
    let list = childLists.get(this);
    if (list === undefined) {
      list = new ChildList(this);
      childLists.set(this, list);
      this._flags |= CHILD_LIST;
    }
    return list;
  }

  /** The children as an array, cached until they change. @internal */
  _children(): readonly Node[] {
    let children = childArrays.get(this);
    if (children === undefined) {
      children = [];
      for (let child = this.firstChild; child !== null; child = child._next) children.push(child);
      childArrays.set(this, children);
    }
    return children;
  }

  get attributes(): NamedNodeMap | null {
    return null;
  }

  get namespaceURI(): string | null {
    return null;
  }

  get prefix(): string | null {
    return null;
  }

  set prefix(_prefix: string | null) {
    // Only elements and attributes have a prefix to set.
  }

  get localName(): string | null {
    return null;
  }

  /** Null, but for the nodes XML Base gives a base URI to. */
  get baseURI(): string | null {
    return null;
  }

  /** The text below the node, without comments, processing instructions or whitespace in element content (DOM Level 3). */
  get textContent(): string | null {
    let text = '';
    for (let node = following(this, this); node !== null; node = following(node, this)) {
      if (isText(node) && !node._ignorable) text += node._data;
    }
    return text;
  }

  set textContent(text: string | null) {
    this._checkWritable();
    while (this.firstChild !== null) this.firstChild.remove();
    if (text !== null && text !== '') this.appendChild((this._owner as Document).createTextNode(text));
  }

  hasChildNodes(): boolean {
    return this.firstChild !== null;
  }

  hasAttributes(): boolean {
    return false;
  }

  isSupported(feature: string, version: string | null): boolean {
    return hasFeature(feature, version);
  }

  getFeature(feature: string, version: string | null): unknown {
    return this.isSupported(feature, version) ? this : null;
  }

  /** Throws when the node cannot change. @internal */
  _checkWritable(): void {
    if (this._readonly) fail('NoModificationAllowedError', `This ${this.nodeName} cannot change`);
  }

  /** Marks that the children changed: the cached array goes, and the document's live lists see a new version. @internal */
  _changed(): void {
    childArrays.delete(this);
    const document = documentOf(this);
    if (document !== null) document._version++;
  }

  insertBefore<T extends Node>(newChild: T, refChild: Node | null): T {
    this._checkInsert(newChild, refChild);
    if (newChild.nodeType === DOCUMENT_FRAGMENT_NODE) {
      for (const child of newChild._children()) this._insert(child, refChild);
    } else if (newChild !== refChild) {
      this._insert(newChild, refChild);
    }
    return newChild;
  }

  appendChild<T extends Node>(newChild: T): T {
    return this.insertBefore(newChild, null);
  }

  removeChild<T extends Node>(oldChild: T): T {
    if (oldChild?._parent !== this) fail('NotFoundError', 'The node is not a child of this node');
    oldChild.remove();
    return oldChild;
  }

  /** Removes this node from its parent, if it has one (WHATWG DOM). */
  remove(): void {
    const parent = this._parent;
    if (parent === null) return;
    parent._checkWritable();
    parent._unlink(this);
  }

  replaceChild<T extends Node>(newChild: Node, oldChild: T): T {
    if (oldChild._parent !== this) {
      this._checkInsert(newChild, null);
      fail('NotFoundError', 'The node to replace is not a child of this node');
    }
    if (newChild === oldChild) return oldChild;
    this._checkInsert(newChild, oldChild, oldChild);
    const next = oldChild._next;
    this._unlink(oldChild);
    this.insertBefore(newChild, next === newChild ? newChild._next : next);
    return oldChild;
  }

  /** The checks insertBefore and replaceChild make, in the order Xerces makes them. @internal */
  _checkInsert(newChild: Node, refChild: Node | null, replacing?: Node): void {
    this._checkWritable();
    const document = documentOf(this);
    const unowned = newChild.nodeType === DOCUMENT_TYPE_NODE && newChild._owner === null;
    if (newChild._owner !== document && newChild !== document && !unowned) {
      fail('WrongDocumentError', 'The node belongs to another document');
    }
    if (newChild._parent?._readonly === true) fail('NoModificationAllowedError', 'The node cannot be moved');
    const kinds =
      newChild.nodeType === DOCUMENT_FRAGMENT_NODE
        ? [...newChild._children()].map((child) => child.nodeType)
        : [newChild.nodeType];
    const allowed = ALLOWED_CHILD_TYPES[this.nodeType];
    if (allowed === undefined || kinds.some((kind) => !allowed.has(kind))) {
      fail('HierarchyRequestError', `A ${this.nodeName} cannot hold this node`);
    }
    if (within(this, newChild)) fail('HierarchyRequestError', 'A node cannot hold itself or its ancestor');
    if (this.nodeType === DOCUMENT_NODE) (this as unknown as Document)._checkDocumentChild(newChild, kinds, replacing);
    if (refChild !== null && refChild._parent !== this) fail('NotFoundError', 'The reference node is not a child');
  }

  /** Links a child before another, or at the end; moves it from wherever it was. @internal */
  _insert(child: Node, before: Node | null): void {
    if (child._parent !== null) child._parent._unlink(child);
    child._parent = this;
    child._next = before;
    child._prev = before === null ? this._last : before._prev;
    if (child._prev === null) this._first = child;
    else child._prev._next = child;
    if (before === null) this._last = child;
    else before._prev = child;
    this._changed();
    if ((this._flags & CHILD_LIST) !== 0) childAdded(this, child);
  }

  /** Appends a child the builder made, with none of the checks. @internal */
  _append(child: Node): void {
    child._parent = this;
    child._next = null;
    child._prev = this._last;
    if (this._last === null) this._first = child;
    else this._last._next = child;
    this._last = child;
    if ((this._flags & CHILD_LIST) !== 0) childAdded(this, child);
  }

  /** Unlinks a child. @internal */
  _unlink(child: Node): void {
    const wasLast = child._next === null;
    if (child._prev === null) this._first = child._next;
    else child._prev._next = child._next;
    if (child._next === null) this._last = child._prev;
    else child._next._prev = child._prev;
    child._parent = null;
    child._prev = null;
    child._next = null;
    this._changed();
    if ((this._flags & CHILD_LIST) !== 0) childRemoved(this, wasLast);
  }

  cloneNode(deep = false): Node {
    const clone = this._clone(this._owner as Document, deep);
    this._notify(UserDataOperation.NODE_CLONED, clone);
    return clone;
  }

  /** A copy of this node owned by a document, with its descendants when deep. @internal */
  _clone(owner: Document, deep: boolean): Node {
    const copy = this._shallow(owner);
    if (deep) copyBelow(this, copy, (node) => node._clone(owner, false));
    return copy;
  }

  /** A copy of this node alone. @internal */
  abstract _shallow(owner: Document): Node;

  /** Joins adjacent text and drops empty text below the node, attributes included; NFC-normalizes it when `normalize-characters` is on. */
  normalize(): void {
    normalizeBelow(this, documentOf(this)?.domConfig._is('normalize-characters') === true);
  }

  isSameNode(other: Node | null): boolean {
    return this === other;
  }

  isEqualNode(other: Node | null): boolean {
    if (other?.nodeType !== this.nodeType) return false;
    // Pairs still to compare, on a stack rather than the call stack.
    const pending: Node[] = [this, other];
    while (pending.length > 0) {
      const second = pending.pop() as Node;
      const first = pending.pop() as Node;
      if (!first._equalNode(second)) return false;
      let ours = first.firstChild;
      let theirs = second.firstChild;
      for (; ours !== null && theirs !== null; ours = ours._next, theirs = theirs._next) pending.push(ours, theirs);
      if (ours !== theirs) return false;
    }
    return true;
  }

  /** Whether this node equals another, leaving out their children. @internal */
  _equalNode(other: Node): boolean {
    if (other.nodeType !== this.nodeType) return false;
    if (!same(this.nodeName, other.nodeName) || !same(this.localName, other.localName)) return false;
    if (!same(this.namespaceURI, other.namespaceURI) || !same(this.prefix, other.prefix)) return false;
    return same(this.nodeValue, other.nodeValue) && this._equalDetails(other);
  }

  /** What else isEqualNode compares for this kind of node. @internal */
  _equalDetails(_other: Node): boolean {
    return true;
  }

  compareDocumentPosition(other: Node): number {
    // A node has no position relative to itself, so no bits are set.
    if (other === this) return 0;
    const [ours, theirs] = [ancestry(this), ancestry(other)];
    if (ours[0] !== theirs[0]) {
      const order = orderOf(identity(this) < identity(other));
      return DOCUMENT_POSITION_DISCONNECTED | DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | order;
    }
    // Skip the holders the two nodes share.
    let shared = 0;
    while (shared < ours.length && shared < theirs.length && ours[shared] === theirs[shared]) shared++;
    if (shared === ours.length) return DOCUMENT_POSITION_CONTAINED_BY | DOCUMENT_POSITION_FOLLOWING;
    if (shared === theirs.length) return DOCUMENT_POSITION_CONTAINS | DOCUMENT_POSITION_PRECEDING;
    return siblingOrder(ours[shared] as Node, theirs[shared] as Node);
  }

  /** The prefix bound to a namespace here (DOM Level 3 Appendix B.2). */
  lookupPrefix(namespaceURI: string | null): string | null {
    if (namespaceURI === null || namespaceURI === '') return null;
    const element = this._namespaceElement();
    return element === null ? null : boundPrefix(element, namespaceURI);
  }

  /** Whether a namespace is the default one here, as DOM Level 3 Appendix B.3 decides. */
  isDefaultNamespace(namespaceURI: string | null): boolean {
    const uri = orNull(namespaceURI);
    for (let element = this._namespaceElement(); element !== null; element = elementAbove(element)) {
      // An element with no prefix answers from its own namespace; a prefixed one from its default declaration.
      if (element.prefix === null) return element._namespaceURI === uri;
      for (const attr of element._attributes) {
        if (attr._namespaceURI === XMLNS_NAMESPACE && attr._name === 'xmlns') return orNull(attr.value) === uri;
      }
    }
    return false;
  }

  lookupNamespaceURI(prefix: string | null): string | null {
    return this._namespaceElement()?.lookupNamespaceURI(prefix) ?? null;
  }

  /** The element whose scope namespace lookups use (DOM Level 3 Appendix B). @internal */
  _namespaceElement(): Element | null {
    return elementAbove(this);
  }

  setUserData(key: string, data: unknown, handler: UserDataHandler | null): unknown {
    let map = userData.get(this);
    if (map === undefined) {
      map = new Map();
      userData.set(this, map);
    }
    const previous = map.get(key)?.[0] ?? null;
    if (data === null) map.delete(key);
    else map.set(key, [data, handler]);
    return previous;
  }

  getUserData(key: string): unknown {
    return userData.get(this)?.get(key)?.[0] ?? null;
  }

  /** Tells the user-data handlers of an operation. @internal */
  _notify(operation: number, dst: Node | null): void {
    for (const [key, [data, handler]] of userData.get(this) ?? []) {
      if (typeof handler === 'function') handler(operation, key, data, this, dst);
      else handler?.handle(operation, key, data, this, dst);
    }
  }

  /** Makes this node and its descendants read-only, as entities and their references are, or writable. @internal */
  _setReadonly(readonly: boolean): void {
    markReadonly(this, readonly);
  }
}

/** Gives a class whose nodes never hold children null child links on its prototype, saving two fields a node. */
export function holdsNoChildren(type: abstract new (...args: never[]) => Node): void {
  Object.defineProperties(type.prototype, { _first: { value: null }, _last: { value: null } });
}
