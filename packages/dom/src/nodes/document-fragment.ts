import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import { Node } from './node.ts';

// Module-level constants, so V8 can inline them.
const { DOCUMENT_FRAGMENT_NODE } = NodeType;

/** A document fragment. */
export class DocumentFragment extends Node {
  constructor(owner: Document | null) {
    super(owner);
    this._holdsChildren();
  }

  get nodeType(): number {
    return DOCUMENT_FRAGMENT_NODE;
  }

  get nodeName(): string {
    return '#document-fragment';
  }

  _shallow(owner: Document): Node {
    return new DocumentFragment(owner);
  }
}
