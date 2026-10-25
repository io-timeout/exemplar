import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import { Node } from './node.ts';

// Module-level constants, so V8 can inline them.
const { ENTITY_REFERENCE_NODE } = NodeType;

/** A reference to an entity; its children are the entity's, and read-only. */
export class EntityReference extends Node {
  readonly #name: string;

  constructor(owner: Document | null, name: string) {
    super(owner);
    this._holdsChildren();
    this.#name = name;
  }

  get nodeType(): number {
    return ENTITY_REFERENCE_NODE;
  }

  get nodeName(): string {
    return this.#name;
  }

  /** The base URI of the entity it refers to. */
  override get baseURI(): string | null {
    return this._owner?.doctype?.entities.getNamedItem(this.#name)?.baseURI ?? null;
  }

  _shallow(owner: Document): Node {
    return owner._entityReference(this.#name);
  }

  override _clone(owner: Document, _deep: boolean): Node {
    return this._shallow(owner);
  }
}
