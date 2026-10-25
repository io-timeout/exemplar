import { fail } from '../names.ts';
import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import type { Element } from './element.ts';
import { NamedNode } from './named-node.ts';
import { type Node, NodeFlag } from './node.ts';
import { Text } from './text.ts';
import { NO_TYPE, type TypeInfo } from './type-info.ts';

// Module-level constants, so V8 can inline them.
const { ATTRIBUTE_NODE } = NodeType;
const { SPECIFIED, ID, CHILD_LIST } = NodeFlag;

/**
 * An attribute. Its value is kept as a string until something asks for its children, as DOM attributes
 * hold text and entity references as children; only then is the value turned into a text child.
 */
export class Attr extends NamedNode {
  /** The value while it has no children; null once children replace it, the first time they are asked for. @internal */
  declare _value: string | null;
  /** The element it is set on, if any. @internal */ declare _ownerElement: Element | null;
  /** Its DTD type. @internal */ declare _type: TypeInfo;

  constructor(owner: Document | null, name: string, namespaceURI: string | null, localName: string | null, value = '') {
    super(owner, name, namespaceURI, localName);
    this._value = value;
    this._ownerElement = null;
    this._type = NO_TYPE;
    this._flags = SPECIFIED;
  }

  /** @internal */
  get _specified(): boolean {
    return (this._flags & SPECIFIED) !== 0;
  }

  set _specified(on: boolean) {
    this._flags = on ? this._flags | SPECIFIED : this._flags & ~SPECIFIED;
  }

  /** @internal */
  get _isId(): boolean {
    return (this._flags & ID) !== 0;
  }

  set _isId(on: boolean) {
    this._flags = on ? this._flags | ID : this._flags & ~ID;
  }

  get nodeType(): number {
    return ATTRIBUTE_NODE;
  }

  get name(): string {
    return this._name;
  }

  get specified(): boolean {
    return this._specified;
  }

  get ownerElement(): Element | null {
    return this._ownerElement;
  }

  get isId(): boolean {
    return this._isId;
  }

  get schemaTypeInfo(): TypeInfo {
    return this._type;
  }

  get value(): string {
    if (this._value !== null) return this._value;
    let value = '';
    for (let child = super.firstChild; child !== null; child = child._next) value += child.textContent as string;
    return value;
  }

  set value(value: string) {
    this._checkWritable();
    if (this._ownerElement?._readonly === true) fail('NoModificationAllowedError', 'The element cannot change');
    if (this._value === null) while (super.firstChild !== null) this._unlink(super.firstChild);
    this._value = String(value);
    if ((this._flags & CHILD_LIST) !== 0) materialize(this);
    this._specified = true;
    this._changed();
  }

  override get nodeValue(): string {
    return this.value;
  }

  override set nodeValue(value: string | null) {
    this.value = value ?? '';
  }

  override get textContent(): string {
    return this.value;
  }

  override set textContent(text: string | null) {
    this.value = text ?? '';
  }

  override get firstChild(): Node | null {
    materialize(this);
    return super.firstChild;
  }

  override get lastChild(): Node | null {
    materialize(this);
    return super.lastChild;
  }

  override _insert(child: Node, before: Node | null): void {
    materialize(this);
    super._insert(child, before);
    this._specified = true;
  }

  override _unlink(child: Node): void {
    materialize(this);
    super._unlink(child);
  }

  override _changed(): void {
    super._changed();
    if (this._ownerElement !== null && this._isId) (this._owner as Document)._version++;
  }

  override _namespaceElement(): Element | null {
    return this._ownerElement;
  }

  /** Normalizes the attribute's children, once it has any. */
  override normalize(): void {
    if (this._value === null) super.normalize();
  }

  _shallow(owner: Document): Node {
    const copy = new Attr(owner, this._name, this._namespaceURI, this._localName);
    copy._type = this._type;
    return copy;
  }

  /** A copy with the value and children; specified, as a copy of an attribute alone is (DOM Level 3 cloneNode). */
  override _clone(owner: Document, _deep: boolean): Node {
    const copy = this._shallow(owner) as Attr;
    copy._value = this._value;
    if (this._value === null) {
      for (let child = super.firstChild; child !== null; child = child._next) copy._append(child._clone(owner, true));
    }
    return copy;
  }

  /** Sets the value as the parser or a default gives it, without the checks. @internal */
  _setParsed(value: string, specified: boolean): void {
    this._value = value;
    this._specified = specified;
  }
}

/** Turns an attribute's value into a text child, the first time its children are asked for. */
function materialize(attr: Attr): void {
  const value = attr._value;
  if (value === null) return;
  attr._value = null;
  if (value === '') return;
  const text = new Text(attr._owner, value);
  text._readonly = attr._readonly;
  attr._append(text);
}
