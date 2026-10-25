import type { NamespaceDeclaration } from './overlay.ts';
import { type PointerPart, Selection } from './pointer.ts';
import type { XIncludeReader } from './reader.ts';
import { type Parent, ScopeStack } from './scopes.ts';

/** What an included start or end tag is to the including document: passed over, given, or the top one given. */
export type TagOutcome = 'skipped' | 'given' | 'top';

/**
 * A document being included, whole or as a pointer selects: its reader, and which of its events are
 * given. With `xpointer="element(/1/2)"` the reader reads the whole document, but only the second
 * child of its root and what that holds are given; the selected element is the top one, which is
 * fixed up with xml:base, xml:lang and the namespace declarations it needs.
 */
export class Inclusion {
  readonly reader: XIncludeReader;
  readonly uri: string;
  readonly parent: Parent;
  /** The resource and pointer, as the chain of inclusions knows them. */
  readonly key: string;
  /** Whether it refers into the including document, whose reader selects from its source. */
  readonly isIntraDocument: boolean;
  /** What is in scope at each open element of the included document, and its depth. */
  readonly scopes: ScopeStack;
  /** The namespace declarations added to the top start tag given, for its end tag. */
  declarations: readonly NamespaceDeclaration[] = [];
  /** What a pointer into another document selects, after that document's own inclusions; undefined for all of it. */
  readonly #selection: Selection | undefined;
  /** Whether it has given all it gives. */
  #done = false;

  constructor(
    reader: XIncludeReader,
    uri: string,
    parts: readonly PointerPart[],
    parent: Parent,
    key: string,
    isIntraDocument: boolean
  ) {
    this.reader = reader;
    this.uri = uri;
    this.parent = parent;
    this.key = key;
    this.isIntraDocument = isIntraDocument;
    this.scopes = new ScopeStack(uri);
    // A pointer into this document has its reader select from the source, which gives only what it selects.
    this.#selection = parts.length > 0 && !isIntraDocument ? new Selection(parts) : undefined;
  }

  /** Whether the inclusion has given all it gives. */
  get done(): boolean {
    return this.#done;
  }

  /** Enters an included start tag: given inside what the pointer selects, the top one fixed up. */
  enter(): TagOutcome {
    const { reader, scopes } = this;
    // Within this document, what is in scope at depth 0 is what was above the selected element.
    if (this.isIntraDocument && scopes.depth === 0) scopes.setOrigin(reader._selectionOrigin());
    scopes.enter(reader);
    const selection = this.#selection;
    if (selection === undefined) return scopes.depth === 1 ? 'top' : 'given';
    if (selection.depth !== undefined) return 'given';
    // A later part's match is noted, to read the document again if no earlier part matches.
    return selection.select(reader, scopes.depth) ? 'top' : 'skipped';
  }

  /** Leaves an included end tag: given inside what the pointer selects; the selected element's ends the inclusion. */
  leave(): TagOutcome {
    const depth = this.scopes.leave();
    const selection = this.#selection;
    if (selection === undefined) return depth === 1 ? 'top' : 'given';
    if (selection.depth === undefined) {
      selection.end();
      return 'skipped';
    }
    if (depth !== selection.depth) return 'given';
    this.#done = true;
    return 'top';
  }

  /** Whether text, a comment or a PI here is given: inside the selected element, or anywhere in a whole document. */
  givesContent(): boolean {
    const selected = this.#selection === undefined ? 0 : this.#selection.depth;
    return selected !== undefined && this.scopes.depth >= selected;
  }

  /** Ends the inclusion at the document's end: 'selected' if it gave what was asked for, else what a later part found. */
  end(): 'selected' | readonly number[] | undefined {
    this.#done = true;
    if (this.isIntraDocument) return this.reader._selectionOutcome();
    return this.#selection === undefined ? 'selected' : this.#selection.outcome();
  }
}
