import type { AsyncStreamReader, StreamReader } from '@exemplarjs/xml';
import { XML_NAMESPACE, escapeAndResolveURI, namespacesInScope } from '@exemplarjs/xml/internal';

/** The namespace bindings in scope, by prefix. */
export type Namespaces = ReadonlyMap<string, string>;

/** The base URI, language and namespaces in scope at an element. */
export interface Scope {
  readonly base: string;
  readonly lang: string | undefined;
  readonly namespaces: Namespaces;
}

/** What the include parent is like, which included elements are fixed up against. */
export interface Parent extends Scope {
  /** Whether the xi:include is the document element, which only one element may replace. */
  readonly isRoot: boolean;
}

/**
 * The base URI, language and namespaces in scope at each open element of a document, and at depth 0
 * the document's. An included element is fixed up by comparing what is in scope at it with what is in
 * scope at the xi:include it replaces, so both documents keep one of these.
 */
export class ScopeStack {
  /** The depth of the innermost open element, 0 outside the document element. */
  depth = 0;
  /** The base URI at each depth. */
  readonly #bases: string[];
  /** The xml:lang at each depth; undefined where none is in scope. */
  readonly #langs: (string | undefined)[] = [undefined];
  /** The namespace bindings at each depth. */
  readonly #namespaces: Namespaces[] = [new Map()];

  constructor(base: string) {
    this.#bases = [base];
  }

  /** Enters the element a start tag opens, recording what is in scope there. */
  enter(tag: StreamReader | AsyncStreamReader): void {
    const depth = ++this.depth;
    let base: string | undefined;
    let lang: string | undefined;
    // One pass finds both, reading local names only for the rare attributes in the XML namespace.
    for (let i = 0, count = tag.attributeCount(); i < count; i++) {
      if (tag.attributeNamespace(i) !== XML_NAMESPACE) continue;
      const name = tag.attributeLocalName(i);
      if (name === 'base') base = tag.attributeValue(i);
      else if (name === 'lang') lang = tag.attributeValue(i);
    }
    this.#bases[depth] = baseOf(base, this.#bases[depth - 1] as string);
    this.#langs[depth] = lang ?? this.#langs[depth - 1];
    this.#namespaces[depth] = namespacesInScope(this.#namespaces[depth - 1] as Namespaces, tag);
  }

  /** Leaves the innermost open element; returns the depth it was at. */
  leave(): number {
    return this.depth--;
  }

  /** What is in scope at an open element, or at depth 0 the document's. */
  scopeAt(depth: number): Scope {
    return {
      base: this.#bases[depth] as string,
      lang: this.#langs[depth],
      namespaces: this.#namespaces[depth] as Namespaces,
    };
  }

  /** The base URI in scope at an open element. */
  baseAt(depth: number): string {
    return this.#bases[depth] as string;
  }

  /** Puts what is in scope above a part of a document at depth 0, for elements read from it. */
  setOrigin(origin: Scope): void {
    this.#bases[0] = origin.base;
    this.#langs[0] = origin.lang;
    this.#namespaces[0] = origin.namespaces;
  }
}

/** An element's base URI: its xml:base made absolute against its parent's, or else the parent's. */
function baseOf(base: string | undefined, parentBase: string): string {
  return base === undefined ? parentBase : (escapeAndResolveURI(base, parentBase || undefined) ?? base);
}
