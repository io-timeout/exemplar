import { ErrorCode } from '../errors/codes.ts';
import { MORE, scanError, Terminator, scanSpan, scanTo } from '../scan/scanner.ts';
import { Char, isPubidText } from '../util/chars.ts';
import {
  bufferEnded,
  COMMENT_OPEN_LENGTH,
  couldBecomeWord,
  DECLARATION_OPEN_LENGTH,
  DOCTYPE_OPEN_LENGTH,
  PI_CLOSE_LENGTH,
  PI_OPEN_LENGTH,
  scanCommentClose,
  scanRequiredName,
  skipWhitespace,
  throwUnexpected,
} from './syntax.ts';
import type { Tokenizer } from './tokenizer.ts';

// Module-level constants, so V8 can inline them.
const { APOSTROPHE, DOUBLE_QUOTE, GREATER_THAN, LEFT_BRACKET, LESS_THAN, PERCENT, RIGHT_BRACKET, SEMICOLON } = Char;

/** The keywords that start an external identifier. */
const EXTERNAL_ID_KEYWORDS = ['SYSTEM', 'PUBLIC'];

/**
 * Scans a document type declaration, and keeps what the rest of the parser needs from it.
 *
 * A document type declaration, or DOCTYPE, names the root element. It can also point to an
 * external file of declarations, called the external subset, and hold declarations of its own
 * between brackets, called the internal subset (§2.8 [28]):
 *
 * ```xml
 * <!DOCTYPE book PUBLIC "-//OASIS//DTD DocBook XML V4.5//EN" "docbook.dtd" [
 *   <!ENTITY version "1.0">
 * ]>
 * ```
 *
 * The tokenizer records the name itself. This class keeps the rest: the public and system
 * identifiers, and where the internal subset is. It doesn't read the declarations in the
 * subset; the DTD parser does that later. It only walks through them to find the `]` that
 * ends the subset, which can't simply be searched for, because a `]` can also appear inside a
 * quoted value, a comment or a PI. As it walks, it checks that every character is allowed.
 *
 * Like the rest of the tokenizer, each scan returns the index just after what it read, or MORE
 * when the buffer ends before it can tell. The tokenizer then adds text and calls `scan` again
 * from the start of the DOCTYPE.
 */
export class DoctypeToken {
  /** The public identifier, from `PUBLIC "…"`; undefined when there is none. */
  publicId: string | undefined;
  /** The system identifier, the external subset's URI; undefined when there is none. */
  systemId: string | undefined;
  /** Where the internal subset's text starts in the buffer, just inside `[`; -1 when there is none. */
  subsetStart = -1;
  /** Where the internal subset's text ends in the buffer, at `]`; -1 when there is none. */
  subsetEnd = -1;
  /** The text of the literal `#scanLiteral` read last. */
  #lastLiteral = '';

  /**
   * Scans `<!DOCTYPE name ExternalID? [subset]? >`, which starts at `start` in the tokenizer's
   * buffer, and records its name in the tokenizer. Returns the index after the closing `>`, or MORE.
   */
  scan(tokenizer: Tokenizer, start: number): number {
    // A scan that returns MORE starts again from the beginning, so it clears what the last attempt found.
    this.publicId = undefined;
    this.systemId = undefined;
    this.subsetStart = -1;
    this.subsetEnd = -1;
    const keywordEnd = start + DOCTYPE_OPEN_LENGTH;
    let pos = skipWhitespace(tokenizer, keywordEnd);
    if (pos === MORE) return MORE;
    if (pos === keywordEnd) throw scanError(ErrorCode.WF_DOCTYPE, pos, 'Expected whitespace after <!DOCTYPE');
    const nameEnd = scanRequiredName(tokenizer, pos, ErrorCode.WF_DOCTYPE, 'the document type name');
    if (nameEnd === MORE) return MORE;
    tokenizer.recordName(pos, nameEnd);
    pos = this.#scanExternalId(tokenizer, nameEnd);
    if (pos === MORE) return MORE;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (tokenizer.buffer.charCodeAt(pos) === LEFT_BRACKET) {
      const subsetEnd = findSubsetEnd(tokenizer, pos + 1);
      if (subsetEnd === MORE) return MORE;
      this.subsetStart = pos + 1;
      this.subsetEnd = subsetEnd;
      pos = skipWhitespace(tokenizer, subsetEnd + 1);
      if (pos === MORE) return MORE;
    }
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (tokenizer.buffer.charCodeAt(pos) !== GREATER_THAN) {
      return throwUnexpected(tokenizer, pos, ErrorCode.WF_DOCTYPE, 'Expected > to end the DOCTYPE');
    }
    return pos + 1;
  }

  /**
   * Scans the external identifier after the name, if there is one: `SYSTEM "uri"`, or
   * `PUBLIC "public id" "uri"` (§4.2.2 [75]). Returns the index after it and any whitespace, or MORE.
   */
  #scanExternalId(tokenizer: Tokenizer, nameEnd: number): number {
    const keywordStart = skipWhitespace(tokenizer, nameEnd);
    if (keywordStart === MORE) return MORE;
    const text = tokenizer.buffer;
    const keyword = EXTERNAL_ID_KEYWORDS.find((word) => text.startsWith(word, keywordStart));
    if (keyword === undefined) {
      // `SYS` at the end of the buffer may yet become `SYSTEM`.
      const partialKeyword = couldBecomeWord(tokenizer, keywordStart, EXTERNAL_ID_KEYWORDS);
      return partialKeyword ? MORE : keywordStart;
    }
    const keywordEnd = keywordStart + keyword.length;
    let pos = this.#scanLiteral(tokenizer, keywordEnd);
    if (pos === MORE) return MORE;
    if (keyword === 'PUBLIC') {
      this.publicId = this.#lastLiteral;
      if (!isPubidText(this.#lastLiteral)) {
        throw scanError(
          ErrorCode.WF_DOCTYPE,
          keywordEnd,
          'The public identifier holds a character PubidChar does not allow'
        );
      }
      pos = this.#scanLiteral(tokenizer, pos);
      if (pos === MORE) return MORE;
    }
    this.systemId = this.#lastLiteral;
    return skipWhitespace(tokenizer, pos);
  }

  /**
   * Scans the whitespace that must come before a quoted literal, then the literal, and keeps its
   * text in `#lastLiteral`. Returns the index after the closing quote, or MORE.
   */
  #scanLiteral(tokenizer: Tokenizer, start: number): number {
    const openingQuote = skipWhitespace(tokenizer, start);
    if (openingQuote === MORE) return MORE;
    if (openingQuote === start) {
      throw scanError(ErrorCode.WF_DOCTYPE, openingQuote, 'Expected whitespace before a literal');
    }
    const text = tokenizer.buffer;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const quote = text.charCodeAt(openingQuote);
    if (quote !== DOUBLE_QUOTE && quote !== APOSTROPHE) {
      return throwUnexpected(tokenizer, openingQuote, ErrorCode.WF_DOCTYPE, 'Expected a quoted literal');
    }
    // eslint-disable-next-line prefer-code-point -- a quote character
    const closingQuote = text.indexOf(String.fromCharCode(quote), openingQuote + 1);
    if (closingQuote === -1) return bufferEnded(tokenizer, openingQuote, 'Unterminated literal');
    scanSpan(tokenizer, openingQuote + 1, closingQuote);
    this.#lastLiteral = text.slice(openingQuote + 1, closingQuote);
    return closingQuote + 1;
  }
}

/**
 * Finds the `]` that ends the internal subset, which starts at `start`. Steps over each
 * declaration, comment, PI and parameter-entity reference in turn. Returns the index of `]`, or MORE.
 */
function findSubsetEnd(tokenizer: Tokenizer, start: number): number {
  let pos = start;
  for (;;) {
    pos = skipWhitespace(tokenizer, pos);
    if (pos === MORE) return MORE;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const char = tokenizer.buffer.charCodeAt(pos);
    if (char === RIGHT_BRACKET) return pos;
    if (char === PERCENT) pos = skipParameterReference(tokenizer, pos);
    else if (char === LESS_THAN) pos = skipSubsetMarkup(tokenizer, pos);
    else if (Number.isNaN(char)) return bufferEnded(tokenizer, pos, 'Unterminated internal subset');
    else throw scanError(ErrorCode.WF_DOCTYPE, pos, 'Unexpected character in the internal subset');
    if (pos === MORE) return MORE;
  }
}

/** Steps over a parameter-entity reference, `%name;`, whose `%` is at `percent`. Returns the index after `;`, or MORE. */
function skipParameterReference(tokenizer: Tokenizer, percent: number): number {
  const nameEnd = scanRequiredName(tokenizer, percent + 1, ErrorCode.WF_DOCTYPE, 'a parameter entity name');
  if (nameEnd === MORE) return MORE;
  // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
  if (tokenizer.buffer.charCodeAt(nameEnd) !== SEMICOLON) {
    return throwUnexpected(tokenizer, nameEnd, ErrorCode.WF_DOCTYPE, 'Expected ; after the parameter entity name');
  }
  return nameEnd + 1;
}

/**
 * Steps over a comment, a PI or a markup declaration such as `<!ENTITY …>`, which starts with
 * `<` at `start`. Returns the index after it, or MORE.
 */
function skipSubsetMarkup(tokenizer: Tokenizer, start: number): number {
  const text = tokenizer.buffer;
  // Four characters tell `<!--` from `<?` and `<!`.
  if (text.length < start + COMMENT_OPEN_LENGTH && !tokenizer.final) return MORE;
  if (text.startsWith('<!--', start)) {
    const hyphens = scanTo(tokenizer, start + COMMENT_OPEN_LENGTH, Terminator.COMMENT);
    if (hyphens === MORE) return bufferEnded(tokenizer, start, 'Unterminated comment');
    return scanCommentClose(tokenizer, hyphens);
  }
  if (text.startsWith('<?', start)) {
    const piClose = scanTo(tokenizer, start + PI_OPEN_LENGTH, Terminator.PI);
    if (piClose === MORE) return bufferEnded(tokenizer, start, 'Unterminated processing instruction');
    return piClose + PI_CLOSE_LENGTH;
  }
  // `<![` would start a conditional section, which only an external subset may hold.
  if (!text.startsWith('<!', start) || text.startsWith('<![', start)) {
    throw scanError(ErrorCode.WF_DOCTYPE, start, 'Expected a markup declaration in the internal subset');
  }
  const declarationStart = start + DECLARATION_OPEN_LENGTH;
  const declarationEnd = findDeclarationEnd(text, declarationStart);
  if (declarationEnd === -1) return bufferEnded(tokenizer, declarationStart, 'Unterminated declaration');
  scanSpan(tokenizer, declarationStart, declarationEnd);
  return declarationEnd + 1;
}

/**
 * Finds the `>` that ends a markup declaration, ignoring any `>` inside a quoted value such as
 * `<!ENTITY arrow "->">`. Returns its index, or -1 if it isn't in the buffer yet.
 */
function findDeclarationEnd(text: string, start: number): number {
  /** The quote of the value being read, or 0 outside one. */
  let openQuote = 0;
  for (let pos = start; pos < text.length; pos++) {
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const char = text.charCodeAt(pos);
    if (openQuote !== 0) {
      if (char === openQuote) openQuote = 0;
    } else if (char === DOUBLE_QUOTE || char === APOSTROPHE) {
      openQuote = char;
    } else if (char === GREATER_THAN) {
      return pos;
    }
  }
  return -1;
}
