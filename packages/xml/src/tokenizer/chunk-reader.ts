import { type Chunk, DecodingFailureError, PENDING, type ChunkSource } from '../input/source.ts';
import { Char } from '../util/chars.ts';
import type { Tokenizer } from './tokenizer.ts';

// A module-level constant, so V8 can inline it.
const { LESS_THAN } = Char;

/**
 * Moves text from the source into the tokenizer's buffer.
 *
 * The source hands over the document's text a chunk at a time, and the tokenizer splits the
 * text in its buffer into tokens: a tag, a comment, a run of text. Often a token starts in the
 * buffer but doesn't end there. The buffer might hold `<!-- a long comm`, with the rest of the
 * comment still to come. The tokenizer then calls `fill` for more text, and scans the token
 * again from its start.
 *
 * `fill` decides how much text to add before that next scan:
 *
 * - Normally, at least as much as the token already has. Adding a little at a time would mean
 *   scanning a long token over and over; doubling it each time keeps the total work to about
 *   twice the token's length.
 * - Less, when a character that could end the token has arrived and the source has nothing
 *   more for now. Trying the scan is better than waiting.
 */
export class ChunkReader {
  #source: ChunkSource;
  /** How many more characters the current fill adds before it stops; 0 when no fill is under way. */
  #charsToAppend = 0;
  /** Whether the token being filled starts with `<`, so it is markup that only `>` ends. */
  #sawMarkupStart = false;
  /**
   * Whether this fill has added a character that ends this kind of token: `>` for markup, and
   * `<`, `&` or `;` for text. It isn't always the end, since a `>` can sit inside an attribute
   * value, but only scanning again can tell.
   */
  #sawTokenEnd = false;

  constructor(source: ChunkSource) {
    this.#source = source;
  }

  /** Starts reading another source from its beginning. */
  reset(source: ChunkSource): void {
    this.#source = source;
    this.#charsToAppend = 0;
  }

  /**
   * Adds one chunk to the tokenizer's buffer, or marks the buffer final when the source has ended.
   * Returns false if the source has nothing yet.
   */
  read(tokenizer: Tokenizer): boolean {
    const chunk = this.#source.read();
    if (chunk === PENDING) return false;
    if (chunk === undefined) tokenizer.markFinal();
    else tokenizer.append(chunk);
    return true;
  }

  /**
   * Adds enough text for the tokenizer to scan its unfinished token again.
   * Returns false if the source ran out for now; the next call carries on with the same fill.
   */
  fill(tokenizer: Tokenizer): boolean {
    if (this.#charsToAppend === 0) {
      this.#charsToAppend = Math.max(1, tokenizer.buffer.length - tokenizer.tokenStart);
      // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
      this.#sawMarkupStart = tokenizer.buffer.charCodeAt(tokenizer.tokenStart) === LESS_THAN;
      this.#sawTokenEnd = false;
    }
    let appended = false;
    for (;;) {
      const chunk = this.#readDeferringFailure(appended);
      if (chunk === null) break;
      if (chunk === PENDING) {
        // Scan what has arrived if it could end the token; otherwise wait for more.
        if (!this.#sawTokenEnd) return false;
        break;
      }
      if (chunk === undefined) {
        tokenizer.markFinal();
        break;
      }
      tokenizer.append(chunk);
      this.#charsToAppend -= chunk.length;
      appended = true;
      if (this.#charsToAppend <= 0) break;
      // Looking at the chunk rather than the buffer keeps V8 from flattening the buffer on every append.
      this.#sawTokenEnd ||= this.#sawMarkupStart ? chunk.includes('>') : /[<&;]/.test(chunk);
    }
    this.#charsToAppend = 0;
    return true;
  }

  /**
   * Reads a chunk from the source. If its bytes can't be decoded after this fill has already
   * added text, returns null instead of throwing, so that text is tokenized first; the source
   * throws the same error on the next read.
   */
  #readDeferringFailure(appendedAlready: boolean): Chunk<string> | null {
    try {
      return this.#source.read();
    } catch (error) {
      if (!(error instanceof DecodingFailureError) || !appendedAlready) throw error;
      return null;
    }
  }
}
