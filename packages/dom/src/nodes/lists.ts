import { fail, orNull } from '../names.ts';
import { NodeType } from '../node-type.ts';
import type { Attr } from './attr.ts';
import type { Element } from './element.ts';
import type { Node } from './node.ts';

// Module-level constants, so V8 can inline them.
const { ATTRIBUTE_NODE } = NodeType;

/** Walks a list as it is at each step, as `Array.prototype.values` does. */
class ListIterator<T> implements IterableIterator<T> {
  readonly #list: NodeList<T & Node>;
  #index = 0;

  constructor(list: NodeList<T & Node>) {
    this.#list = list;
  }

  next(): IteratorResult<T> {
    const list = this.#list;
    if (this.#index < list.length) return { value: list[this.#index++] as T, done: false };
    return { value: undefined, done: true };
  }

  [Symbol.iterator](): this {
    return this;
  }
}

/** A live list of nodes, holding them as its index properties so that `list[i]` reads as fast as an array. */
export class NodeList<T extends Node = Node> implements Iterable<T> {
  [index: number]: T;
  /** @internal */ _length = 0;

  get length(): number {
    return this._length;
  }

  item(index: number): T | null {
    return Number.isInteger(index) && index >= 0 && index < this.length ? (this[index] as T) : null;
  }

  forEach(callback: (node: T, index: number, list: NodeList<T>) => void): void {
    for (let i = 0; i < this.length; i++) callback(this[i] as T, i, this);
  }

  [Symbol.iterator](): IterableIterator<T> {
    return new ListIterator(this);
  }

  /** Makes the list hold a node and the siblings after it. @internal */
  _fill(first: Node | null): void {
    let i = 0;
    for (let node = first; node !== null; node = node._next) this[i++] = node as T;
    this._trim(i);
  }

  /** Makes the list hold the nodes of an array. @internal */
  _set(nodes: readonly T[]): void {
    for (let i = 0; i < nodes.length; i++) this[i] = nodes[i] as T;
    this._trim(nodes.length);
  }

  /** Adds a node at the end. @internal */
  _push(node: T): void {
    this[this._length++] = node;
  }

  /** Drops the index properties from `length` on. @internal */
  _trim(length: number): void {
    for (let i = length; i < this._length; i++) delete this[i];
    this._length = length;
  }
}

/**
 * A node's children. A change at the end keeps its index properties up to date; any other change drops them until the
 * list is next read, so a run of changes copies the children once.
 */
export class ChildList extends NodeList {
  /** @internal */ readonly _node: Node;
  /** Whether the index properties hold the children. @internal */ _current = true;
  /** The prototype that copies the children back at the next read, once made. @internal */ _stale: object | null =
    null;

  constructor(node: Node) {
    super();
    this._node = node;
    this._fill(node.firstChild);
  }

  /** Drops the index properties after a change, until the list is next read. @internal */
  _drop(): void {
    this._trim(0);
    this._current = false;
    this._stale ??= staleBase(this);
    Object.setPrototypeOf(this, this._stale);
  }
}

/** A prototype for a stale child list: reading anything the list does not hold copies the children back. */
function staleBase(list: ChildList): object {
  const revive = (): void => {
    Object.setPrototypeOf(list, ChildList.prototype);
    list._current = true;
    list._fill(list._node.firstChild);
  };
  return new Proxy(Object.create(ChildList.prototype) as object, {
    get(_base, key, receiver) {
      revive();
      return Reflect.get(list, key, receiver) as unknown;
    },
    has(_base, key) {
      revive();
      return Reflect.has(list, key);
    },
  });
}

/**
 * A live map of nodes by name: an element's attributes, or a document type's entities or notations.
 * It reads the owner's own array, so changes show at once; the index properties (`map[0]`) are copies
 * that `_sync()` brings up to date after each change.
 */
export class NamedNodeMap implements Iterable<Node> {
  [index: number]: Node;
  /** The element whose attributes it holds; undefined for a document type's read-only maps. @internal */
  readonly _owner: Element | undefined;
  /** The nodes, shared with the owner. @internal */ readonly _nodes: Node[];
  /** How many index properties the map holds. @internal */ _indexed = 0;

  constructor(owner: Element | undefined, nodes: Node[]) {
    this._owner = owner;
    this._nodes = nodes;
    this._sync();
  }

  get length(): number {
    return this._nodes.length;
  }

  item(index: number): Node | null {
    return Number.isInteger(index) && index >= 0 ? (this._nodes[index] ?? null) : null;
  }

  getNamedItem(name: string): Node | null {
    return this._nodes.find((node) => node.nodeName === name) ?? null;
  }

  /** The node with a namespace and local name; an element's DOM Level 1 attributes match by name when no namespace is given. */
  getNamedItemNS(namespaceURI: string | null, localName: string): Node | null {
    if (this._owner !== undefined) return this._owner.getAttributeNodeNS(namespaceURI, localName);
    const uri = orNull(namespaceURI);
    return this._nodes.find((node) => node.namespaceURI === uri && node.localName === localName) ?? null;
  }

  setNamedItem(node: Node): Node | null {
    if (this._owner === undefined) fail('NoModificationAllowedError', 'This map is read-only');
    if (node.nodeType !== ATTRIBUTE_NODE) fail('HierarchyRequestError', 'An attributes map holds only attributes');
    return this._owner.setAttributeNode(node as Attr);
  }

  setNamedItemNS(node: Node): Node | null {
    if (this._owner === undefined) fail('NoModificationAllowedError', 'This map is read-only');
    if (node.nodeType !== ATTRIBUTE_NODE) fail('HierarchyRequestError', 'An attributes map holds only attributes');
    return this._owner.setAttributeNodeNS(node as Attr);
  }

  removeNamedItem(name: string): Node {
    if (this._owner === undefined) fail('NoModificationAllowedError', 'This map is read-only');
    const node = this.getNamedItem(name);
    if (node === null) fail('NotFoundError', `There is no ${name}`);
    return this._owner.removeAttributeNode(node as Attr);
  }

  removeNamedItemNS(namespaceURI: string | null, localName: string): Node {
    if (this._owner === undefined) fail('NoModificationAllowedError', 'This map is read-only');
    const node = this.getNamedItemNS(namespaceURI, localName);
    if (node === null) fail('NotFoundError', `There is no ${localName}`);
    return this._owner.removeAttributeNode(node as Attr);
  }

  [Symbol.iterator](): Iterator<Node> {
    return this._nodes[Symbol.iterator]();
  }

  /** Copies the nodes into the map's index properties, after they change. @internal */
  _sync(): void {
    const nodes = this._nodes;
    for (let i = 0; i < nodes.length; i++) this[i] = nodes[i] as Node;
    for (let i = nodes.length; i < this._indexed; i++) delete this[i];
    this._indexed = nodes.length;
  }
}
