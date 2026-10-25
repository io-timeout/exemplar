import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import { NamedNodeMap } from './lists.ts';
import { Node, holdsNoChildren } from './node.ts';

// Module-level constants, so V8 can inline them.
const { DOCUMENT_TYPE_NODE } = NodeType;

/** The DOCTYPE, with the entities and notations the DTD declares. */
export class DocumentType extends Node {
  readonly name: string;
  readonly publicId: string | null;
  readonly systemId: string | null;
  readonly internalSubset: string | null;
  /** @internal */ _entities: Node[] = [];
  /** @internal */ _notations: Node[] = [];
  readonly entities: NamedNodeMap;
  readonly notations: NamedNodeMap;

  constructor(
    owner: Document | null,
    name: string,
    publicId: string | null,
    systemId: string | null,
    internalSubset: string | null
  ) {
    super(owner);
    this.name = name;
    this.publicId = publicId;
    this.systemId = systemId;
    this.internalSubset = internalSubset;
    this.entities = new NamedNodeMap(undefined, this._entities);
    this.notations = new NamedNodeMap(undefined, this._notations);
  }

  get nodeType(): number {
    return DOCUMENT_TYPE_NODE;
  }

  get nodeName(): string {
    return this.name;
  }

  override get textContent(): string | null {
    return null;
  }

  override set textContent(_text: string | null) {
    // Setting it has no effect where it is null (DOM Level 3).
  }

  override _equalDetails(other: Node): boolean {
    const theirs = other as DocumentType;
    if (
      this.publicId !== theirs.publicId ||
      this.systemId !== theirs.systemId ||
      this.internalSubset !== theirs.internalSubset
    ) {
      return false;
    }
    return sameNodes(this._entities, theirs._entities) && sameNodes(this._notations, theirs._notations);
  }

  _shallow(owner: Document): Node {
    const copy = new DocumentType(owner, this.name, this.publicId, this.systemId, this.internalSubset);
    for (const entity of this._entities) copy._entities.push(entity._clone(owner, true));
    for (const notation of this._notations) copy._notations.push(notation._clone(owner, true));
    copy.entities._sync();
    copy.notations._sync();
    for (const declaration of [...copy._entities, ...copy._notations]) declaration._setReadonly(true);
    return copy;
  }
}

/** Whether two lists hold equal nodes, in any order. */
function sameNodes(ours: readonly Node[], theirs: readonly Node[]): boolean {
  return ours.length === theirs.length && ours.every((node) => theirs.some((other) => node.isEqualNode(other)));
}

holdsNoChildren(DocumentType);
