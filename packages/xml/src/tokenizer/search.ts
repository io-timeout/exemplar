/** The strings the cache can search for, which the XML 1.0 fast paths and the line counter look for with `indexOf`. */
export const Needle = {
  /** `<` */
  LESS_THAN: 0,
  /** `&` */
  AMPERSAND: 1,
  /** A CR, `\r` */
  CARRIAGE_RETURN: 2,
  /** An LF, `\n` */
  LINE_FEED: 3,
  /** `]]>`, which ends a CDATA section */
  CDATA_END: 4,
  /** `--`, which may only appear in a comment as part of the `-->` that ends it */
  DOUBLE_HYPHEN: 5,
  /** `?>`, which ends a PI */
  PI_END: 6,
} as const;

/** Each needle's text, in `Needle`'s order. */
const NEEDLES = ['<', '&', '\r', '\n', ']]>', '--', '?>'];

/** Where a needle hasn't been searched for since the buffer last changed: before any index, so no search reuses it. */
const NOT_SEARCHED = -1;
/**
 * The position given when a needle isn't in the buffer. It is larger than any string index, so
 * a caller compares it with an end position just as it would a real one. It is 2^30 - 1, the
 * largest number V8 can keep as a small integer.
 */
const NOT_FOUND = 0x3f_ff_ff_ff;

/**
 * Remembers where the tokenizer's searches found each needle, so that a repeated search can be
 * answered without looking again.
 *
 * Say a search for `<` from index 0 finds one at index 500. A later search for `<` from index
 * 120 must also find the one at 500, because the first search showed there is no `<` between 0
 * and 500. So while a new search starts between where the last one started and what it found,
 * the cache gives the last answer. This matters in text full of references, such as
 * `a &amp; b &amp; c … <`: the text is read in runs that stop at each `&`, and each run asks for
 * the next `<` again.
 *
 * The answers are buffer indexes, so the owner must call `clear` whenever the buffer's text changes.
 */
export class SearchCache {
  /**
   * Two numbers for each needle, side by side in one array: where the last search found it (an
   * index, NOT_FOUND or NOT_SEARCHED), then where that search started.
   */
  readonly #searches: number[] = NEEDLES.flatMap(() => [NOT_SEARCHED, NOT_SEARCHED]);

  /** The index of the next `needle` in `text` at or after `from`, or NOT_FOUND, which is past any index. */
  find(text: string, needle: number, from: number): number {
    const searches = this.#searches;
    const foundAtSlot = needle * 2;
    const foundAt = searches[foundAtSlot] as number;
    if ((searches[foundAtSlot + 1] as number) <= from && from <= foundAt) return foundAt;
    const found = text.indexOf(NEEDLES[needle] as string, from);
    const answer = found === -1 ? NOT_FOUND : found;
    searches[foundAtSlot] = answer;
    searches[foundAtSlot + 1] = from;
    return answer;
  }

  /** Forgets every search, for when the buffer's text has changed. */
  clear(): void {
    this.#searches.fill(NOT_SEARCHED);
  }
}
