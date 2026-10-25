import { holdsAt, sameSpan } from '../scan/scanner.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';

/**
 * The elements open around the current event, outermost first. An element is pushed at its start
 * tag and left at its end tag, and its depth, its position in the stack, identifies it to the other
 * parts of the reader.
 *
 * Like the tokenizer, the stack avoids building strings: an element's name is kept as document
 * offsets into the tokenizer's buffer, and sliced only when asked for, or just before the buffer
 * drops the text it is in. The stack also tells the tokenizer the open element's name, so that the
 * common end tag that repeats it can be matched by comparing code units.
 */
export class ElementStack {
  /** How many elements are open. */
  depth = 0;
  /** Where each open element's name starts, as a document offset. */
  readonly nameStarts: number[] = [];
  /** Where each open element's name ends, as a document offset. */
  readonly nameEnds: number[] = [];
  /** Each open element's name, once sliced; a buffer about to drop a name slices it first. */
  readonly names: (string | undefined)[] = [];
  /** Where the first colon is in each open element's name, counted from the name's start, or -1. */
  readonly nameFirstColons: number[] = [];
  /** Whether the root element has ended, after which no element may start. */
  rootEnded = false;
  /** The depth before the last element was left, for a call that then fails to put it back. */
  #previousDepth = -1;

  /** Whether no element has started yet: the reader is in the prolog. */
  get inProlog(): boolean {
    return this.depth === 0 && !this.rootEnded;
  }

  /** Opens the element of the start tag `tokenizer` holds, and has `tokenizer` expect its end tag; returns its depth. */
  push(tokenizer: Tokenizer): number {
    const elementDepth = this.depth;
    this.nameStarts[elementDepth] = tokenizer.bufferOffset + tokenizer.nameStart;
    this.nameEnds[elementDepth] = tokenizer.bufferOffset + tokenizer.nameEnd;
    this.names[elementDepth] = undefined;
    this.nameFirstColons[elementDepth] =
      tokenizer.nameFirstColon < 0 ? -1 : tokenizer.nameFirstColon - tokenizer.nameStart;
    tokenizer.openElementNameOffset = tokenizer.bufferOffset + tokenizer.nameStart;
    tokenizer.openElementNameLength = tokenizer.nameEnd - tokenizer.nameStart;
    this.depth = elementDepth + 1;
    return elementDepth;
  }

  /** The qualified name of the open element at depth `elementDepth`, sliced from `tokenizer`'s buffer the first time. */
  nameAt(elementDepth: number, tokenizer: Tokenizer): string {
    let name = this.names[elementDepth];
    if (name === undefined) {
      name = tokenizer.buffer.slice(
        (this.nameStarts[elementDepth] as number) - tokenizer.bufferOffset,
        (this.nameEnds[elementDepth] as number) - tokenizer.bufferOffset
      );
      this.names[elementDepth] = name;
    }
    return name;
  }

  /** Whether the end tag `tokenizer` holds names the open element at depth `elementDepth`. */
  endTagMatches(elementDepth: number, tokenizer: Tokenizer): boolean {
    const length = tokenizer.nameEnd - tokenizer.nameStart;
    const name = this.names[elementDepth];
    if (name !== undefined) return name.length === length && holdsAt(tokenizer.buffer, tokenizer.nameStart, name);
    const start = (this.nameStarts[elementDepth] as number) - tokenizer.bufferOffset;
    return (
      (this.nameEnds[elementDepth] as number) - tokenizer.bufferOffset - start === length &&
      sameSpan(tokenizer.buffer, start, tokenizer.nameStart, length)
    );
  }

  /**
   * Closes the innermost element and returns its depth. `tokenizer` is then told to expect the
   * parent's end tag, if the parent opened in the same text: at `entityStartDepth` or deeper.
   */
  leave(tokenizer: Tokenizer, entityStartDepth: number): number {
    const elementDepth = --this.depth;
    if (elementDepth === 0) this.rootEnded = true;
    const parent = elementDepth - 1;
    if (parent >= entityStartDepth) {
      tokenizer.openElementNameOffset = this.nameStarts[parent] as number;
      tokenizer.openElementNameLength = (this.nameEnds[parent] as number) - tokenizer.openElementNameOffset;
    } else {
      tokenizer.openElementNameLength = -1;
    }
    this.#previousDepth = elementDepth + 1;
    return elementDepth;
  }

  /** Whether the last change was leaving an element, which can then be put back. */
  get justLeft(): boolean {
    return this.depth === this.#previousDepth - 1;
  }

  /** Puts back the element last left; returns the depth it was left at. */
  reenter(): number {
    const elementDepth = this.depth;
    this.depth = this.#previousDepth;
    if (elementDepth === 0) this.rootEnded = false;
    return elementDepth;
  }

  /** Slices the names of open elements that start before `offset`, which the buffer is about to drop. */
  sliceBeforeDrop(tokenizer: Tokenizer, offset: number): void {
    for (let elementDepth = 0; elementDepth < this.depth; elementDepth++) {
      if (this.names[elementDepth] === undefined && (this.nameStarts[elementDepth] as number) < offset)
        this.nameAt(elementDepth, tokenizer);
    }
  }
}
