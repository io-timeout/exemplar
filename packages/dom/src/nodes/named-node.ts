import { prefixOf } from '@exemplarjs/xml/internal';
import { checkName, checkPrefix, fail, orNull } from '../names.ts';
import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import { Node } from './node.ts';

// Module-level constants, so V8 can inline them.
const { ATTRIBUTE_NODE } = NodeType;

/** A name with its namespace: an element's or attribute's. */
export abstract class NamedNode extends Node {
  /** @internal */ declare _name: string;
  /** @internal */ declare _namespaceURI: string | null;
  /** @internal */ declare _localName: string | null;

  constructor(owner: Document | null, name: string, namespaceURI: string | null, localName: string | null) {
    super(owner);
    this._holdsChildren();
    this._name = name;
    this._namespaceURI = namespaceURI;
    this._localName = localName;
  }

  override get nodeName(): string {
    return this._name;
  }

  override get namespaceURI(): string | null {
    return this._namespaceURI;
  }

  override get localName(): string | null {
    return this._localName;
  }

  override get prefix(): string | null {
    if (this._localName === null) return null;
    return orNull(prefixOf(this._name));
  }

  override set prefix(prefix: string | null) {
    this._checkWritable();
    if (this._localName === null) fail('NamespaceError', `${this._name} was not created with a namespace`);
    if (prefix !== null && prefix !== '') {
      checkName(prefix);
      if (prefix.includes(':')) fail('NamespaceError', `${prefix} is not a prefix`);
    }
    const value = orNull(prefix);
    if (this.nodeType === ATTRIBUTE_NODE && this._name === 'xmlns') fail('NamespaceError', 'xmlns takes no prefix');
    const name = value === null ? this._localName : `${value}:${this._localName}`;
    checkPrefix(this._namespaceURI, value, name);
    this._name = name;
  }
}
