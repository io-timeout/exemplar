import { NodeType } from '../node-type.ts';
import { Declared } from './declared.ts';
import type { Document } from './document.ts';
import type { Node } from './node.ts';

// Module-level constants, so V8 can inline them.
const { ENTITY_NODE } = NodeType;

/** An entity the DTD declares. */
export class Entity extends Declared {
  readonly notationName: string | null;
  /** @internal */ _inputEncoding: string | null = null;
  /** @internal */ _xmlEncoding: string | null = null;
  /** @internal */ _xmlVersion: string | null = null;

  constructor(
    owner: Document | null,
    name: string,
    publicId: string | null,
    systemId: string | null,
    notationName: string | null
  ) {
    super(owner, name, publicId, systemId);
    this._holdsChildren();
    this.notationName = notationName;
  }

  get nodeType(): number {
    return ENTITY_NODE;
  }

  get inputEncoding(): string | null {
    return this._inputEncoding;
  }

  get xmlEncoding(): string | null {
    return this._xmlEncoding;
  }

  get xmlVersion(): string | null {
    return this._xmlVersion;
  }

  _shallow(owner: Document): Node {
    return new Entity(owner, this.nodeName, this.publicId, this.systemId, this.notationName);
  }

  /** A copy, read-only as every entity is, as in Xerces. @internal */
  override _clone(owner: Document, deep: boolean): Node {
    const copy = super._clone(owner, deep);
    copy._setReadonly(true);
    return copy;
  }
}
