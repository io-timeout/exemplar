import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import { Node, holdsNoChildren } from './node.ts';

// Module-level constants, so V8 can inline them.
const { PROCESSING_INSTRUCTION_NODE } = NodeType;

/** A processing instruction. */
export class ProcessingInstruction extends Node {
  readonly target: string;
  /** @internal */ _data: string;

  constructor(owner: Document | null, target: string, data: string) {
    super(owner);
    this.target = target;
    this._data = data;
  }

  get nodeType(): number {
    return PROCESSING_INSTRUCTION_NODE;
  }

  get nodeName(): string {
    return this.target;
  }

  override get baseURI(): string | null {
    return (this._parent ?? this._owner)?.baseURI ?? null;
  }

  get data(): string {
    return this._data;
  }

  set data(data: string) {
    this._checkWritable();
    this._data = data;
  }

  override get nodeValue(): string {
    return this._data;
  }

  override set nodeValue(value: string | null) {
    this.data = value ?? '';
  }

  override get textContent(): string {
    return this._data;
  }

  override set textContent(text: string | null) {
    this.data = text ?? '';
  }

  _shallow(owner: Document): Node {
    return new ProcessingInstruction(owner, this.target, this._data);
  }
}

holdsNoChildren(ProcessingInstruction);
