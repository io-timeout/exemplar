import { ErrorCode } from '../errors/codes.ts';
import type { Location } from '../errors/xml-error.ts';
import { scanError } from '../scan/scanner.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';

/** The location of the document's first character. */
const DOCUMENT_START: Location = { line: 1, column: 1, offset: 0 };

/** An entity being expanded in content. */
export interface EntityFrame {
  readonly entityName: string;
  /** The tokenizer of the text that referred to it, read again when it ends. */
  readonly parent: Tokenizer;
  /** How many elements were open where it began, as many as must be open where it ends. */
  readonly elementDepth: number;
  /** For an internal entity, where it was referred to, which its events report; worked out when asked. */
  readonly locate: (() => Location) | undefined;
  /** For an external entity, the URI it was read from. */
  readonly systemId: string | undefined;
}

/**
 * The texts being read, as a stack: the document at the bottom, then each entity being expanded in
 * content, innermost last. The reader always reads the innermost text.
 *
 * Each text has a tokenizer of its own. Expanding `&chapter;` pushes a tokenizer for the entity's
 * text; when that text ends, the stack pops back to the text that referred to it, which carries on
 * after the reference. An entity must close every element it opens, so each frame remembers how
 * many elements were open where it began.
 *
 * Locations follow the innermost entity: inside an internal entity, events report where the entity
 * was referred to, and inside an external one, a place in its own file.
 */
export class EntityStack {
  /** The document entity's tokenizer, under every entity. */
  readonly document: Tokenizer;
  /** The tokenizer being read: the document's, or the innermost entity's. */
  current: Tokenizer;
  /** The document's system id. */
  readonly #systemId: string | undefined;
  readonly #frames: EntityFrame[] = [];
  /** How many entities are open. */
  depth = 0;
  /** How many elements were open where the innermost entity began; 0 in the document. */
  entityStartDepth = 0;
  /** Tokenizers of internal entities that have ended, kept to read the next one without allocating. */
  readonly #spareTokenizers: Tokenizer[] = [];

  constructor(document: Tokenizer, systemId: string | undefined) {
    this.document = document;
    this.current = document;
    this.#systemId = systemId;
  }

  /** Whether the entity `name` is open, so that expanding it again would recurse. */
  isOpen(name: string): boolean {
    return this.depth > 0 && this.#frames.some((frame) => frame.entityName === name);
  }

  /** The names of the open entities, outermost first. */
  openEntityNames(): string[] {
    return this.#frames.map((frame) => frame.entityName);
  }

  /** A tokenizer an internal entity has finished with, to read the next one; undefined when none is kept. */
  takeSpareTokenizer(): Tokenizer | undefined {
    return this.#spareTokenizers.pop();
  }

  /**
   * Starts reading entity `name` with `tokenizer`. It was referred to at buffer index `referenceIndex`
   * in the current text, with `openElements` elements open.
   */
  enter(
    name: string,
    tokenizer: Tokenizer,
    referenceIndex: number,
    openElements: number,
    isInternal: boolean,
    systemId: string | undefined
  ): void {
    const parent = this.current;
    const framesOutside = this.#frames.length;
    let location: Location | undefined;
    const locate = isInternal ? () => (location ??= this.locationIn(parent, referenceIndex, framesOutside)) : undefined;
    this.#frames.push({ entityName: name, parent, elementDepth: openElements, locate, systemId });
    this.current = tokenizer;
    this.depth++;
    this.entityStartDepth = openElements;
  }

  /** Closes the innermost entity, which must have closed the elements it opened, and reads on around it; returns its frame. */
  leave(openElements: number): EntityFrame {
    const frame = this.#frames.at(-1) as EntityFrame;
    const tokenizer = this.current;
    if (openElements !== frame.elementDepth) {
      throw scanError(
        ErrorCode.WF_ENTITY_CONTENT,
        tokenizer.buffer.length,
        'An entity must end the elements it starts'
      );
    }
    if (tokenizer.isReplacementText) this.#spareTokenizers.push(tokenizer);
    this.#frames.pop();
    this.current = frame.parent;
    this.depth--;
    this.entityStartDepth = this.#frames.at(-1)?.elementDepth ?? 0;
    return frame;
  }

  /** The location of buffer index `index` in `tokenizer`'s text, as seen inside the first `frames` open entities, by default all of them. */
  locationIn(tokenizer: Tokenizer, index: number, frames = this.#frames.length): Location {
    // The innermost entity decides: an internal one reports its reference, an external one its own text, id or none.
    const frame = frames > 0 ? (this.#frames[frames - 1] as EntityFrame) : undefined;
    if (frame?.locate !== undefined) return frame.locate();
    const systemId = frame === undefined ? this.#systemId : frame.systemId;
    const location = tokenizer.lines.locationAt(index);
    return systemId === undefined ? location : { ...location, systemId };
  }

  /** A location with the document's system id added, when it has none of its own. */
  withDocumentSystemId(location: Location): Location {
    const systemId = this.#systemId;
    return systemId === undefined || location.systemId !== undefined ? location : { ...location, systemId };
  }

  /** The location of the document's first character. */
  documentStart(): Location {
    return this.withDocumentSystemId(DOCUMENT_START);
  }

  /** The location of buffer index `index` in the document's own text. */
  documentLocation(index: number): Location {
    const systemId = this.#systemId;
    return { ...this.document.lines.locationAt(index), ...(systemId !== undefined && { systemId }) };
  }
}
