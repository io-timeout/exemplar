import { XMLNS_NAMESPACE, localPartOf, prefixOf } from '@exemplarjs/xml/internal';
import { DOMConfiguration, normalizeDocument } from '../config.ts';
import { checkName, checkQualifiedName, fail, orNull } from '../names.ts';
import { NodeType } from '../node-type.ts';
import { Attr } from './attr.ts';
import { CDATASection } from './cdata-section.ts';
import { Comment } from './comment.ts';
import { DocumentFragment } from './document-fragment.ts';
import type { DocumentType } from './document-type.ts';
import { DOMImplementation } from './dom-implementation.ts';
import { Element, attributesChanged } from './element.ts';
import { EntityReference } from './entity-reference.ts';
import { NodeList } from './lists.ts';
import { Node, UserDataOperation } from './node.ts';
import { ProcessingInstruction } from './processing-instruction.ts';
import { Text } from './text.ts';
import { copyBelow, following, isDeclaration, skipping } from './tree.ts';
import { TypeInfo } from './type-info.ts';

// Module-level constants, so V8 can inline them.
const { ELEMENT_NODE, ATTRIBUTE_NODE, ENTITY_REFERENCE_NODE, ENTITY_NODE, DOCUMENT_NODE, DOCUMENT_TYPE_NODE } =
  NodeType;

/** A DTD attribute default, which removing the attribute brings back. */
export interface AttributeDefault {
  readonly value: string;
  readonly id: boolean;
  readonly type: string;
}

/**
 * A document: the root of a tree, and the factory for its nodes (`createElement`, `createTextNode`, …),
 * which belong to it from then on. It also keeps what the DTD says that the tree needs later, such as
 * the attribute defaults that come back when an attribute is removed.
 */
export class Document extends Node {
  readonly implementation: DOMImplementation;
  /** Changes with every change to the tree, so live lists know when to look again. @internal */
  _version = 0;
  /** The URI the document was read from. @internal */ _documentURI: string | null = null;
  /** @internal */ _inputEncoding: string | null = null;
  /** @internal */ _xmlEncoding: string | null = null;
  /** @internal */ _xmlStandalone = false;
  /** @internal */ _xmlVersion = '1.0';
  /** Kept for DOM Level 3; exemplar checks every operation either way. */
  strictErrorChecking = true;
  /** The DTD's attribute defaults, by element name and attribute name. @internal */
  _defaults = new Map<string, Map<string, AttributeDefault>>();
  /** The configuration, made the first time `domConfig` is read. */
  #config: DOMConfiguration | undefined;

  constructor(implementation: DOMImplementation = new DOMImplementation()) {
    super(null);
    this._holdsChildren();
    this.implementation = implementation;
  }

  get nodeType(): number {
    return DOCUMENT_NODE;
  }

  get nodeName(): string {
    return '#document';
  }

  override get ownerDocument(): Document | null {
    return null;
  }

  override get textContent(): string | null {
    return null;
  }

  override set textContent(_text: string | null) {
    // A document has no text content to set (DOM Level 3).
  }

  /** The parameters `normalizeDocument` follows. */
  get domConfig(): DOMConfiguration {
    this.#config ??= new DOMConfiguration();
    return this.#config;
  }

  /** Normalizes the document as `domConfig` says (DOM Level 3). */
  normalizeDocument(): void {
    normalizeDocument(this, this.domConfig);
  }

  get documentElement(): Element | null {
    for (let child = this.firstChild; child !== null; child = child._next)
      if (child.nodeType === ELEMENT_NODE) return child as Element;
    return null;
  }

  get doctype(): DocumentType | null {
    for (let child = this.firstChild; child !== null; child = child._next) {
      if (child.nodeType === DOCUMENT_TYPE_NODE) return child as DocumentType;
    }
    return null;
  }

  get documentURI(): string | null {
    return this._documentURI;
  }

  set documentURI(uri: string | null) {
    this._documentURI = uri;
  }

  override get baseURI(): string | null {
    return this._documentURI;
  }

  get inputEncoding(): string | null {
    return this._inputEncoding;
  }

  get xmlEncoding(): string | null {
    return this._xmlEncoding;
  }

  get xmlStandalone(): boolean {
    return this._xmlStandalone;
  }

  set xmlStandalone(standalone: boolean) {
    this._xmlStandalone = standalone;
  }

  get xmlVersion(): string {
    return this._xmlVersion;
  }

  set xmlVersion(version: string) {
    if (version !== '1.0' && version !== '1.1') fail('NotSupportedError', `XML ${version} is not supported`);
    this._xmlVersion = version;
  }

  /** Takes ownership of a document type created without a document as it is inserted (DOM Level 3). @internal */
  override _insert(child: Node, before: Node | null): void {
    if (child.nodeType === DOCUMENT_TYPE_NODE && child._owner === null) {
      const doctype = child as DocumentType;
      for (const node of [doctype, ...doctype._entities, ...doctype._notations]) node._owner = this;
    }
    super._insert(child, before);
  }

  /** The checks a document makes on its own children: one element, one document type. @internal */
  _checkDocumentChild(child: Node, kinds: readonly number[], replacing: Node | undefined): void {
    for (const kind of kinds) {
      if (kind !== ELEMENT_NODE && kind !== DOCUMENT_TYPE_NODE) continue;
      const element = kind === ELEMENT_NODE;
      const existing = element ? this.documentElement : this.doctype;
      const taken = existing !== null && existing !== replacing && existing !== child;
      if (taken || kinds.filter((other) => other === kind).length > 1) {
        fail('HierarchyRequestError', `A document has only one ${element ? 'element' : 'document type'}`);
      }
    }
  }

  createElement(tagName: string): Element {
    checkName(tagName);
    return this._applyDefaults(new Element(this, tagName, null, null));
  }

  createElementNS(namespaceURI: string | null, qualifiedName: string): Element {
    const uri = orNull(namespaceURI);
    const [, localName] = checkQualifiedName(uri, qualifiedName);
    return this._applyDefaults(new Element(this, qualifiedName, uri, localName));
  }

  createAttribute(name: string): Attr {
    checkName(name);
    return new Attr(this, name, null, null);
  }

  createAttributeNS(namespaceURI: string | null, qualifiedName: string): Attr {
    const uri = orNull(namespaceURI);
    const [, localName] = checkQualifiedName(uri, qualifiedName);
    return new Attr(this, qualifiedName, uri, localName);
  }

  createTextNode(data: string): Text {
    return new Text(this, String(data));
  }

  createComment(data: string): Comment {
    return new Comment(this, String(data));
  }

  createCDATASection(data: string): CDATASection {
    return new CDATASection(this, String(data));
  }

  createProcessingInstruction(target: string, data: string): ProcessingInstruction {
    checkName(target);
    return new ProcessingInstruction(this, target, String(data));
  }

  createDocumentFragment(): DocumentFragment {
    return new DocumentFragment(this);
  }

  createEntityReference(name: string): EntityReference {
    checkName(name);
    return this._entityReference(name);
  }

  /** An entity reference whose children copy the entity's, read-only. @internal */
  _entityReference(name: string): EntityReference {
    const reference = new EntityReference(this, name);
    const entity = this.doctype?.entities.getNamedItem(name);
    if (entity !== null && entity !== undefined) {
      for (let c = entity.firstChild; c !== null; c = c._next) reference._append(c._clone(this, true));
    }
    reference._setReadonly(true);
    return reference;
  }

  getElementsByTagName(name: string): NodeList<Element> {
    return this._liveList(this, (element) => name === '*' || element._name === name);
  }

  getElementsByTagNameNS(namespaceURI: string | null, localName: string): NodeList<Element> {
    const uri = orNull(namespaceURI);
    return this._liveList(
      this,
      (element) =>
        (uri === '*' || element._namespaceURI === uri) && (localName === '*' || element._localName === localName)
    );
  }

  getElementById(id: string): Element | null {
    for (let node = following(this, this); node !== null; node = following(node, this)) {
      if (
        node.nodeType === ELEMENT_NODE &&
        (node as Element)._attributes.some((attr) => attr._isId && attr.value === id)
      ) {
        return node as Element;
      }
    }
    return null;
  }

  /** A live list of the elements below a node that match, recomputed when the tree has changed. @internal */
  _liveList(root: Node, matches: (element: Element) => boolean): NodeList<Element> {
    const list = new NodeList<Element>();
    // No version yet, so the first read collects.
    let version = -1;
    const refresh = (): void => {
      if (version === this._version) return;
      version = this._version;
      const found: Element[] = [];
      collect(root, matches, found);
      list._set(found);
    };
    return new Proxy(list, {
      get(target, key) {
        refresh();
        return Reflect.get(target, key) as unknown;
      },
      has(target, key) {
        refresh();
        return Reflect.has(target, key);
      },
      ownKeys(target) {
        refresh();
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        refresh();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  }

  importNode<T extends Node>(node: T, deep = false): T {
    if (node.nodeType === DOCUMENT_NODE || node.nodeType === DOCUMENT_TYPE_NODE) {
      fail('NotSupportedError', 'Documents and document types cannot be imported');
    }
    const copy = this._import(node, deep);
    node._notify(UserDataOperation.NODE_IMPORTED, copy);
    return copy as T;
  }

  /** A copy of a node owned by this document; attributes come out specified. @internal */
  _import(node: Node, deep: boolean): Node {
    if (node.nodeType === ATTRIBUTE_NODE) {
      const copy = node._clone(this, true) as Attr;
      copy._specified = true;
      return copy;
    }
    const copy = this._importAlone(node);
    if (deep && node.nodeType !== ENTITY_REFERENCE_NODE)
      copyBelow(node, copy, (descendant) => this._importAlone(descendant));
    if (node.nodeType === ENTITY_NODE) copy._setReadonly(true);
    return copy;
  }

  /** A writable copy of a node without its children; an entity reference takes this document's expansion. @internal */
  _importAlone(node: Node): Node {
    if (node.nodeType === ENTITY_REFERENCE_NODE) return this._entityReference(node.nodeName);
    const copy = node.nodeType === ELEMENT_NODE ? this.#importElement(node as Element) : node._shallow(this);
    copy._readonly = false;
    return copy;
  }

  /** A copy of an element and its specified attributes, with this document's defaults. */
  #importElement(element: Element): Element {
    const copy = new Element(this, element._name, element._namespaceURI, element._localName);
    for (const source of element._attributes) {
      if (!source._specified) continue;
      const attr = this._import(source, true) as Attr;
      attr._ownerElement = copy;
      copy._ownAttributes().push(attr);
    }
    return this._applyDefaults(copy);
  }

  /** Gives an element the attributes the DTD defaults that it lacks, and returns it. @internal */
  _applyDefaults(element: Element): Element {
    for (const [name, value] of this._defaults.get(element._name) ?? []) {
      if (element.getAttributeNode(name) !== null) continue;
      const namespaced = element._localName !== null;
      const uri = namespaced ? defaultNamespace(element, name) : null;
      const attr = new Attr(this, name, uri, namespaced ? localPartOf(name) : null, value.value);
      attr._specified = false;
      attr._isId = value.id;
      attr._type = new TypeInfo(value.type);
      attr._ownerElement = element;
      element._ownAttributes().push(attr);
    }
    attributesChanged(element);
    return element;
  }

  adoptNode<T extends Node>(node: T): T | null {
    if (node.nodeType === DOCUMENT_NODE || node.nodeType === DOCUMENT_TYPE_NODE) {
      fail('NotSupportedError', 'Documents and document types cannot be adopted');
    }
    if (node._readonly) fail('NoModificationAllowedError', 'A read-only node cannot be adopted');
    if (isDeclaration(node)) fail('NotSupportedError', 'Entities and notations cannot be adopted');
    node.remove();
    if (node.nodeType === ATTRIBUTE_NODE) {
      const attr = node as unknown as Attr;
      attr._ownerElement?.removeAttributeNode(attr);
      attr._specified = true;
    }
    this._adopt(node);
    node._notify(UserDataOperation.NODE_ADOPTED, null);
    return node;
  }

  /** Makes this document own a node and its descendants; entity references take this document's entities. @internal */
  _adopt(node: Node): void {
    for (let current: Node | null = node; current !== null;) {
      current._owner = this;
      if (current.nodeType === ENTITY_REFERENCE_NODE) {
        this.#adoptReference(current);
        // Its new children are this document's already.
        current = skipping(current, node);
        continue;
      }
      if (current.nodeType === ELEMENT_NODE) this.#adoptAttributes(current as Element);
      current = following(current, node);
    }
  }

  /** Swaps an adopted entity reference's children for this document's expansion of its entity. */
  #adoptReference(reference: Node): void {
    while (reference._first !== null) reference._unlink(reference._first);
    const fresh = this._entityReference(reference.nodeName);
    while (fresh._first !== null) {
      const child = fresh._first;
      fresh._unlink(child);
      reference._append(child);
    }
  }

  /** Drops an adopted element's defaulted attributes, adopts the rest, and gives it this document's defaults. */
  #adoptAttributes(element: Element): void {
    // In place, as the element's attribute map holds the array.
    const specified = element._attributes.filter((attr) => attr._specified);
    element._ownAttributes().splice(0, element._attributes.length, ...specified);
    for (const attr of element._attributes) this._adopt(attr);
    this._applyDefaults(element);
  }

  renameNode<T extends Node>(node: T, namespaceURI: string | null, qualifiedName: string): T {
    if (node.nodeType !== ELEMENT_NODE && node.nodeType !== ATTRIBUTE_NODE) {
      fail('NotSupportedError', 'Only elements and attributes can be renamed');
    }
    if (node._owner !== this) fail('WrongDocumentError', 'The node belongs to another document');
    if (node._readonly) fail('NoModificationAllowedError', 'A read-only node cannot be renamed');
    const named = node as unknown as Attr | Element;
    const uri = orNull(namespaceURI);
    const [, localName] = checkQualifiedName(uri, qualifiedName);
    const owner = node.nodeType === ATTRIBUTE_NODE ? (named as Attr)._ownerElement : null;
    owner?.removeAttributeNode(named as Attr);
    named._name = qualifiedName;
    named._namespaceURI = uri;
    named._localName = localName;
    if (owner !== null) owner.setAttributeNodeNS(named as Attr);
    if (node.nodeType === ELEMENT_NODE) this._applyDefaults(named as Element);
    this._version++;
    node._notify(UserDataOperation.NODE_RENAMED, node);
    return node;
  }

  override _shallow(_owner: Document): Node {
    const copy = new Document(this.implementation);
    copy._documentURI = this._documentURI;
    copy._xmlVersion = this._xmlVersion;
    copy._xmlStandalone = this._xmlStandalone;
    copy._xmlEncoding = this._xmlEncoding;
    copy._inputEncoding = this._inputEncoding;
    copy._defaults = this._defaults;
    return copy;
  }

  override _clone(_owner: Document, deep: boolean): Node {
    const copy = this._shallow(this) as Document;
    if (deep) copyBelow(this, copy, (node) => node._clone(copy, false));
    return copy;
  }

  override _namespaceElement(): Element | null {
    return this.documentElement;
  }
}

/** The namespace a defaulted attribute's name is in, from the element's scope. */
function defaultNamespace(element: Element, name: string): string | null {
  const prefix = prefixOf(name);
  if (name === 'xmlns' || prefix === 'xmlns') return XMLNS_NAMESPACE;
  return prefix === '' ? null : element.lookupNamespaceURI(prefix);
}

/** Collects the elements below a node that match, in document order. */
function collect(root: Node, matches: (element: Element) => boolean, found: Element[]): void {
  for (let node = following(root, root); node !== null; node = following(node, root)) {
    if (node.nodeType === ELEMENT_NODE && matches(node as Element)) found.push(node as Element);
  }
}
