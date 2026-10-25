import { XML_NAMESPACE, escapeAndResolveURI } from '@exemplarjs/xml/internal';
import { checkName, checkQualifiedName, fail, orNull } from '../names.ts';
import { NodeType } from '../node-type.ts';
import { Attr } from './attr.ts';
import type { Document } from './document.ts';
import { NamedNodeMap, type NodeList } from './lists.ts';
import { NamedNode } from './named-node.ts';
import { namespaceOf } from './namespaces.ts';
import { type Node, NodeFlag } from './node.ts';
import { NO_TYPE, type TypeInfo } from './type-info.ts';

// Module-level constants, so V8 can inline them.
const { ELEMENT_NODE, ENTITY_REFERENCE_NODE } = NodeType;
const { ATTRIBUTE_MAP } = NodeFlag;

/** The attribute maps of elements that have one in use, kept beside them. */
const attributeMaps = new WeakMap<Element, NamedNodeMap>();

/** Brings an element's attribute map, if it has one, up to date with its attributes. */
export function attributesChanged(element: Element): void {
  if ((element._flags & ATTRIBUTE_MAP) !== 0) (attributeMaps.get(element) as NamedNodeMap)._sync();
}

/** The URIs of the external entities elements were read from, for the elements at their tops. */
const entityBases = new WeakMap<Element, string>();

/** Records the external entity an element was read from, which its base URI comes from. @internal */
export function setEntityBase(element: Element, uri: string): void {
  entityBases.set(element, uri);
}

/** The attributes of every element that has none, until one is added. @internal */
export const NO_ATTRIBUTES: Attr[] = [];

/**
 * An element. Its attributes live in a plain array, `_attributes`, which elements without attributes
 * share (`NO_ATTRIBUTES`) until one is added; the live `attributes` map is made only when asked for.
 */
export class Element extends NamedNode {
  /** The attributes, in document order. @internal */ declare _attributes: Attr[];

  /** Creates an element; the builder passes an array sized for its attributes. */
  constructor(
    owner: Document | null,
    name: string,
    namespaceURI: string | null,
    localName: string | null,
    attributes: Attr[] = NO_ATTRIBUTES
  ) {
    super(owner, name, namespaceURI, localName);
    this._attributes = attributes;
  }

  /** The element's own attribute array, made when the shared empty one would have to change. @internal */
  _ownAttributes(): Attr[] {
    if (this._attributes === NO_ATTRIBUTES) this._attributes = [];
    return this._attributes;
  }

  get nodeType(): number {
    return ELEMENT_NODE;
  }

  get tagName(): string {
    return this._name;
  }

  override get attributes(): NamedNodeMap {
    let map = attributeMaps.get(this);
    if (map === undefined) {
      map = new NamedNodeMap(this, this._ownAttributes());
      attributeMaps.set(this, map);
      this._flags |= ATTRIBUTE_MAP;
    }
    return map;
  }

  override _changed(): void {
    super._changed();
    attributesChanged(this);
  }

  get schemaTypeInfo(): TypeInfo {
    return NO_TYPE;
  }

  override hasAttributes(): boolean {
    return this._attributes.length > 0;
  }

  /** The `xml:base` attribute resolved against the parent's base URI, or that base (XML Base). */
  override get baseURI(): string | null {
    return elementBase(this);
  }

  getAttribute(name: string): string {
    return this.getAttributeNode(name)?.value ?? '';
  }

  getAttributeNS(namespaceURI: string | null, localName: string): string {
    return this.getAttributeNodeNS(namespaceURI, localName)?.value ?? '';
  }

  hasAttribute(name: string): boolean {
    return this.getAttributeNode(name) !== null;
  }

  hasAttributeNS(namespaceURI: string | null, localName: string): boolean {
    return this.getAttributeNodeNS(namespaceURI, localName) !== null;
  }

  getAttributeNode(name: string): Attr | null {
    return this._attributes.find((attr) => attr._name === name) ?? null;
  }

  getAttributeNodeNS(namespaceURI: string | null, localName: string): Attr | null {
    const uri = orNull(namespaceURI);
    return (
      this._attributes.find((attr) => attr._namespaceURI === uri && (attr._localName ?? attr._name) === localName) ??
      null
    );
  }

  setAttribute(name: string, value: string): void {
    this._checkWritable();
    checkName(name);
    const existing = this.getAttributeNode(name);
    if (existing !== null) {
      existing.value = value;
      return;
    }
    addAttribute(this, new Attr(this._owner, name, null, null, String(value)));
  }

  setAttributeNS(namespaceURI: string | null, qualifiedName: string, value: string): void {
    this._checkWritable();
    const uri = orNull(namespaceURI);
    const [prefix, localName] = checkQualifiedName(uri, qualifiedName);
    const existing = this.getAttributeNodeNS(uri, localName);
    if (existing !== null) {
      existing.value = value;
      if (prefix !== existing.prefix) existing._name = qualifiedName;
      return;
    }
    addAttribute(this, new Attr(this._owner, qualifiedName, uri, localName, String(value)));
  }

  setAttributeNode(attr: Attr): Attr | null {
    return putAttributeNode(this, attr, () => this.getAttributeNode(attr._name));
  }

  /** Sets an attribute node by namespace and local name; like Xerces, it reports one of the same qualified name it sits before. */
  setAttributeNodeNS(attr: Attr): Attr | null {
    const replaced = putAttributeNode(this, attr, () =>
      this.getAttributeNodeNS(attr._namespaceURI, attr._localName ?? attr._name)
    );
    return replaced ?? this._attributes.find((other) => other !== attr && other._name === attr._name) ?? null;
  }

  removeAttribute(name: string): void {
    this._checkWritable();
    const attr = this.getAttributeNode(name);
    if (attr !== null) this.removeAttributeNode(attr);
  }

  removeAttributeNS(namespaceURI: string | null, localName: string): void {
    this._checkWritable();
    const attr = this.getAttributeNodeNS(namespaceURI, localName);
    if (attr !== null) this.removeAttributeNode(attr);
  }

  /** Removes an attribute; one the DTD defaults comes back with its default value (DOM Level 1). */
  removeAttributeNode(attr: Attr): Attr {
    this._checkWritable();
    const attributes = this._ownAttributes();
    const at = attributes.indexOf(attr);
    if (at === -1) fail('NotFoundError', 'The attribute is not on this element');
    attributes.splice(at, 1);
    attr._ownerElement = null;
    const fallback = this._owner?._defaults.get(this._name)?.get(attr._name);
    if (fallback !== undefined) {
      const restored = new Attr(this._owner, attr._name, attr._namespaceURI, attr._localName, fallback.value);
      restored._specified = false;
      restored._type = attr._type;
      restored._isId = fallback.id;
      restored._ownerElement = this;
      attributes.splice(at, 0, restored);
    }
    this._changed();
    return attr;
  }

  getElementsByTagName(name: string): NodeList<Element> {
    return (this._owner as Document)._liveList(this, (element) => name === '*' || element._name === name);
  }

  getElementsByTagNameNS(namespaceURI: string | null, localName: string): NodeList<Element> {
    const uri = orNull(namespaceURI);
    return (this._owner as Document)._liveList(
      this,
      (element) =>
        (uri === '*' || element._namespaceURI === uri) && (localName === '*' || element._localName === localName)
    );
  }

  setIdAttribute(name: string, isId: boolean): void {
    markId(this, this.getAttributeNode(name), isId);
  }

  setIdAttributeNS(namespaceURI: string | null, localName: string, isId: boolean): void {
    markId(this, this.getAttributeNodeNS(namespaceURI, localName), isId);
  }

  setIdAttributeNode(attr: Attr, isId: boolean): void {
    markId(this, this._attributes.includes(attr) ? attr : null, isId);
  }

  /** The namespace a prefix is bound to in this element's scope (DOM Level 3 Appendix B.4). */
  override lookupNamespaceURI(prefix: string | null): string | null {
    return namespaceOf(this, prefix);
  }

  /** An element's lookups start at itself. @internal */
  override _namespaceElement(): this {
    return this;
  }

  override _equalDetails(other: Node): boolean {
    const theirs = (other as Element)._attributes;
    if (theirs.length !== this._attributes.length) return false;
    return this._attributes.every((attr) => {
      const match =
        attr._localName === null
          ? (other as Element).getAttributeNode(attr._name)
          : (other as Element).getAttributeNodeNS(attr._namespaceURI, attr._localName);
      return match !== null && attr.isEqualNode(match);
    });
  }

  _shallow(owner: Document): Node {
    const copy = new Element(owner, this._name, this._namespaceURI, this._localName);
    for (const source of this._attributes) {
      const attr = source._clone(owner, true) as Attr;
      attr._specified = source._specified;
      attr._isId = source._isId;
      attr._ownerElement = copy;
      copy._ownAttributes().push(attr);
    }
    return copy;
  }
}

/** An element's base URI: the `xml:base` values up to the nearest base no element gives, resolved outermost first. */
function elementBase(element: Element): string | null {
  const bases: string[] = [];
  let inherited: string | null = null;
  for (let current = element; ;) {
    const base = xmlBase(current);
    if (base !== '') bases.push(base);
    // An external entity's top elements carry its URI themselves.
    const entity = entityBases.get(current);
    const above = baseParent(current);
    if (entity !== undefined || above?.nodeType !== ELEMENT_NODE) {
      inherited = entity ?? above?.baseURI ?? null;
      break;
    }
    current = above as Element;
  }
  for (let i = bases.length - 1; i >= 0; i--) inherited = resolveBase(bases[i] as string, inherited);
  return inherited;
}

/** An element's own `xml:base` value, or the empty string. */
function xmlBase(element: Element): string {
  return (element.getAttributeNodeNS(XML_NAMESPACE, 'base') ?? element.getAttributeNode('xml:base'))?.value ?? '';
}

/** The node an element inherits its base URI from: its parent or document, past the entity references that pass it on. */
function baseParent(element: Element): Node | null {
  let above = element._parent ?? element._owner;
  while (above?.nodeType === ENTITY_REFERENCE_NODE && above._parent !== null) above = above._parent;
  return above;
}

/** An `xml:base` value escaped and resolved against a base URI (XML Base §3.1); null when it cannot be. */
function resolveBase(base: string, against: string | null): string | null {
  return escapeAndResolveURI(base, against ?? undefined) ?? null;
}

/** Adds an attribute node and makes the element its owner; it goes before one of the same qualified name, as in Xerces. */
function addAttribute(element: Element, attr: Attr): void {
  attr._ownerElement = element;
  const attributes = element._ownAttributes();
  const sameName = attributes.findIndex((other) => other._name === attr._name);
  if (sameName === -1) attributes.push(attr);
  else attributes.splice(sameName, 0, attr);
  element._changed();
}

/** Sets an attribute node on an element, replacing the one `find` finds; returns the replaced node. */
function putAttributeNode(element: Element, attr: Attr, find: () => Attr | null): Attr | null {
  element._checkWritable();
  if (attr._owner !== element._owner) fail('WrongDocumentError', 'The attribute belongs to another document');
  if (attr._ownerElement !== null && attr._ownerElement !== element) {
    fail('InUseAttributeError', 'The attribute belongs to another element');
  }
  const existing = find();
  if (existing === attr) return attr;
  if (existing !== null) {
    const attributes = element._ownAttributes();
    attributes[attributes.indexOf(existing)] = attr;
    existing._ownerElement = null;
    attr._ownerElement = element;
    element._changed();
    return existing;
  }
  addAttribute(element, attr);
  return null;
}

/** Marks an element's attribute as an ID or not. */
function markId(element: Element, attr: Attr | null, isId: boolean): void {
  element._checkWritable();
  if (attr === null) fail('NotFoundError', 'The attribute is not on this element');
  attr._isId = isId;
  element._changed();
}
