import type { Location } from '../errors/xml-error.ts';
import { lastIndexAtOrBefore } from '../util/arrays.ts';
import { Char } from '../util/chars.ts';
import { Needle, type SearchCache } from './search.ts';
import type { Tokenizer } from './tokenizer.ts';

// Module-level constants, so V8 can inline them.
const { CARRIAGE_RETURN, LINE_FEED, LINE_SEPARATOR, NEXT_LINE } = Char;

/**
 * Where the lines start in one segment of a document, so that an event object can find its
 * line and column long after the tokenizer has moved on.
 *
 * An event object only works out its location when something asks for it, and by then the
 * tokenizer may have dropped the event's text from its buffer. So, once event objects are in
 * use, the line counter records where each line starts as it passes it. A segment holds the
 * starts recorded between two drops of the buffer; each event keeps the segment it came from.
 *
 * Positions here are document offsets: counted from the start of the whole document, not of
 * the tokenizer's buffer.
 */
export class LineSegment {
  /** The line the segment begins on. */
  readonly firstLine: number;
  /** The document offset where that line starts, which may be before the segment begins. */
  readonly firstLineStart: number;
  /** The document offsets of the lines that start in the segment, in order. */
  readonly lineStarts: number[] = [];
  readonly systemId: string | undefined;
  /**
   * The line counter, while it is still recording this segment; undefined once it has finished.
   * An offset it hasn't counted up to yet is located by asking it.
   */
  counter: Pick<LineCounter, 'checkpointOffset' | 'locationOfOffset'> | undefined;

  constructor(
    firstLine: number,
    firstLineStart: number,
    systemId: string | undefined,
    counter: Pick<LineCounter, 'checkpointOffset' | 'locationOfOffset'>
  ) {
    this.firstLine = firstLine;
    this.firstLineStart = firstLineStart;
    this.systemId = systemId;
    this.counter = counter;
  }

  /** The location of a document offset in this segment. */
  locate(offset: number): Location {
    let line: number;
    let column: number;
    const counter = this.counter;
    if (counter !== undefined && offset >= counter.checkpointOffset) {
      ({ line, column } = counter.locationOfOffset(offset));
    } else {
      const startIndex = lastIndexAtOrBefore(this.lineStarts, offset);
      line = this.firstLine + startIndex + 1;
      const lineStart = startIndex < 0 ? this.firstLineStart : (this.lineStarts[startIndex] as number);
      column = offset - lineStart + 1;
    }
    const systemId = this.systemId;
    return systemId === undefined ? { line, column, offset } : { line, column, offset, systemId };
  }
}

/**
 * Works out line and column numbers for positions in a tokenizer's buffer.
 *
 * Counting from the start of the document every time would be slow, so the counter keeps a
 * checkpoint: a position it has counted the lines up to, which only moves forward. To find
 * the line of a later position, it counts the line ends between the checkpoint and that
 * position. The checkpoint itself moves up to the start of the current token, since nothing
 * before that is asked about again.
 *
 * It also records line starts into a `LineSegment` for event objects, once something asks for
 * them with `recordLineStarts`.
 *
 * Two kinds of position appear here. A buffer index counts from the start of the tokenizer's
 * buffer, which drops text as it goes; a document offset counts from the start of the whole
 * document. The offset is the tokenizer's `bufferOffset` plus the index.
 */
export class LineCounter {
  readonly #tokenizer: Tokenizer;
  readonly #search: SearchCache;
  /** The buffer index the lines have been counted up to. */
  #checkpoint = 0;
  /** The line the checkpoint is on. */
  #checkpointLine = 1;
  /** The document offset where the checkpoint's line starts. */
  #checkpointLineStart = 0;
  /** Where line starts are recorded for event objects, once something has asked for them. */
  #segment: LineSegment | undefined;
  /**
   * The line the last count reached, and the document offset where it starts. They are fields
   * rather than a returned object so that counting allocates nothing.
   */
  #countedLine = 1;
  #countedLineStart = 0;

  constructor(tokenizer: Tokenizer, search: SearchCache) {
    this.#tokenizer = tokenizer;
    this.#search = search;
  }

  /** The document offset the lines have been counted up to. */
  get checkpointOffset(): number {
    return this.#tokenizer.bufferOffset + this.#checkpoint;
  }

  /** Starts counting again from the beginning of a new text. */
  reset(): void {
    this.#checkpoint = 0;
    this.#checkpointLine = 1;
    this.#checkpointLineStart = 0;
    this.#segment = undefined;
  }

  /** The location of a buffer index, which must be at or after the start of the current token. */
  locationAt(index: number): Location {
    const tokenizer = this.#tokenizer;
    const to = Math.min(index, tokenizer.buffer.length);
    this.#moveCheckpoint(Math.min(tokenizer.tokenStart, to));
    this.#countLines(this.#checkpoint, to, this.#checkpointLine, this.#checkpointLineStart);
    const offset = tokenizer.bufferOffset + index;
    return { line: this.#countedLine, column: offset - this.#countedLineStart + 1, offset };
  }

  /** The location of a document offset, which must be at or after the start of the current token. */
  locationOfOffset(offset: number): Location {
    return this.locationAt(offset - this.#tokenizer.bufferOffset);
  }

  /** Starts recording line starts for event objects, if it hasn't already, and returns the segment it records into. */
  recordLineStarts(systemId: string | undefined): LineSegment {
    this.#segment ??= new LineSegment(this.#checkpointLine, this.#checkpointLineStart, systemId, this);
    return this.#segment;
  }

  /** Records the line starts up to the end of the text, then lets the last segment go of this counter. */
  finish(): void {
    if (this.#segment === undefined) return;
    this.#moveCheckpoint(this.#tokenizer.buffer.length);
    this.#segment.counter = undefined;
  }

  /**
   * Counts past the first `count` characters, which the buffer is about to drop, and starts a
   * new segment if line starts are being recorded.
   */
  drop(count: number): void {
    this.#moveCheckpoint(count);
    const segment = this.#segment;
    if (segment !== undefined) {
      segment.counter = undefined;
      this.#segment = new LineSegment(this.#checkpointLine, this.#checkpointLineStart, segment.systemId, this);
    }
    this.#checkpoint -= count;
  }

  /** Moves the checkpoint forward to buffer index `to`, recording the line starts it passes if asked to. */
  #moveCheckpoint(to: number): void {
    if (to <= this.#checkpoint) return;
    this.#countLines(this.#checkpoint, to, this.#checkpointLine, this.#checkpointLineStart, this.#segment?.lineStarts);
    this.#checkpointLine = this.#countedLine;
    this.#checkpointLineStart = this.#countedLineStart;
    this.#checkpoint = to;
  }

  /**
   * Counts the line ends in buffer indexes `[from, to)`, starting on `fromLine`, whose start is at
   * document offset `fromLineStart`. Leaves the result in `#countedLine` and `#countedLineStart`,
   * and adds each line start it passes to `recordedStarts`, if given.
   */
  #countLines(from: number, to: number, fromLine: number, fromLineStart: number, recordedStarts?: number[]): void {
    const tokenizer = this.#tokenizer;
    if (tokenizer.version11) {
      this.#countLines11(from, to, fromLine, fromLineStart, recordedStarts);
      return;
    }
    // Two fast searches, one for LF and one for CR, rather than a look at every character.
    const search = this.#search;
    const text = tokenizer.buffer;
    let line = fromLine;
    let lineStart = fromLineStart;
    for (
      let pos = search.find(text, Needle.LINE_FEED, from);
      pos < to;
      pos = search.find(text, Needle.LINE_FEED, pos + 1)
    ) {
      line++;
      lineStart = tokenizer.bufferOffset + pos + 1;
      recordedStarts?.push(lineStart);
    }
    let sawLoneCr = false;
    for (
      let pos = search.find(text, Needle.CARRIAGE_RETURN, from);
      pos < to;
      pos = search.find(text, Needle.CARRIAGE_RETURN, pos + 1)
    ) {
      // A CR followed by LF is one line end, already counted with the LF.
      // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
      if (text.charCodeAt(pos + 1) === LINE_FEED) continue;
      sawLoneCr = true;
      line++;
      lineStart = Math.max(lineStart, tokenizer.bufferOffset + pos + 1);
      recordedStarts?.push(tokenizer.bufferOffset + pos + 1);
    }
    // The LF search recorded its starts first, so lone CRs' starts need putting back in order.
    if (recordedStarts !== undefined && sawLoneCr) {
      const firstAdded = recordedStarts.length - (line - fromLine);
      const added = recordedStarts.slice(firstAdded).toSorted((a, b) => a - b);
      recordedStarts.splice(firstAdded, added.length, ...added);
    }
    this.#countedLine = line;
    this.#countedLineStart = lineStart;
  }

  /** Counts XML 1.1 line ends, as `#countLines` does: NEL and LS end lines too, and CR joins a following LF or NEL. */
  #countLines11(from: number, to: number, fromLine: number, fromLineStart: number, recordedStarts?: number[]): void {
    const tokenizer = this.#tokenizer;
    const text = tokenizer.buffer;
    let line = fromLine;
    let lineStart = fromLineStart;
    for (let pos = from; pos < to; pos++) {
      // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
      const char = text.charCodeAt(pos);
      // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
      const next = text.charCodeAt(pos + 1);
      // A CR before LF or NEL ends no line itself; the LF or NEL does.
      const lineEnd =
        char === LINE_FEED ||
        char === NEXT_LINE ||
        char === LINE_SEPARATOR ||
        (char === CARRIAGE_RETURN && next !== LINE_FEED && next !== NEXT_LINE);
      if (!lineEnd) continue;
      line++;
      lineStart = tokenizer.bufferOffset + pos + 1;
      recordedStarts?.push(lineStart);
    }
    this.#countedLine = line;
    this.#countedLineStart = lineStart;
  }
}
