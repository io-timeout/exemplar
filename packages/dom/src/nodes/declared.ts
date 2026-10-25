import type { Document } from './document.ts';
import { Node } from './node.ts';

/** An entity or notation the DTD declares. */
export abstract class Declared extends Node {
  readonly #name: string;
  readonly publicId: string | null;
  readonly systemId: string | null;
  /** The base URI of the entity holding the declaration. @internal */
  _baseURI: string | null = null;

  constructor(owner: Document | null, name: string, publicId: string | null, systemId: string | null) {
    super(owner);
    this.#name = name;
    this.publicId = publicId;
    this.systemId = systemId;
  }

  get nodeName(): string {
    return this.#name;
  }

  override get baseURI(): string | null {
    return this._baseURI ?? this._owner?.baseURI ?? null;
  }
}
