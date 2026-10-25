import { NodeType } from '../node-type.ts';
import { Declared } from './declared.ts';
import type { Document } from './document.ts';
import { type Node, holdsNoChildren } from './node.ts';

// Module-level constants, so V8 can inline them.
const { NOTATION_NODE } = NodeType;

/** A notation the DTD declares. */
export class Notation extends Declared {
  get nodeType(): number {
    return NOTATION_NODE;
  }

  override get textContent(): string | null {
    return null;
  }

  override set textContent(_text: string | null) {
    // Setting it has no effect where it is null (DOM Level 3).
  }

  _shallow(owner: Document): Node {
    return new Notation(owner, this.nodeName, this.publicId, this.systemId);
  }
}

holdsNoChildren(Notation);
