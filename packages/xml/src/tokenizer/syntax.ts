/**
 * Helpers the tokenizer and the DOCTYPE scanner share.
 *
 * Every scan function in the tokenizer follows one rule. It returns the index just after what it
 * read, or MORE when the buffer ends before it can tell, which means "add text and call me again".
 * Once the input is final no more text can come, so running out is an error instead. Scanning
 * `<!-- abc` returns MORE while the source may send more, and fails with `WF_UNEXPECTED_END`
 * once it can't. `bufferEnded` and `throwUnexpected` apply that rule.
 */
import { ErrorCode } from '../errors/codes.ts';
import { MORE, scanError, scanName } from '../scan/scanner.ts';
import { Char } from '../util/chars.ts';
import { isWhitespaceChar } from '../util/whitespace.ts';
import type { Tokenizer } from './tokenizer.ts';

/** The lengths of the markup the tokenizer steps over, defined once for every scanner. */
export const XML_DECLARATION_OPEN_LENGTH = '<?xml'.length;
export const DOCTYPE_OPEN_LENGTH = '<!DOCTYPE'.length;
export const DECLARATION_OPEN_LENGTH = '<!'.length;
export const END_TAG_OPEN_LENGTH = '</'.length;
export const EMPTY_TAG_CLOSE_LENGTH = '/>'.length;
export const COMMENT_OPEN_LENGTH = '<!--'.length;
const COMMENT_CLOSE_LENGTH = '-->'.length;
const DOUBLE_HYPHEN_LENGTH = '--'.length;
export const PI_OPEN_LENGTH = '<?'.length;
export const PI_CLOSE_LENGTH = '?>'.length;
export const CDATA_OPEN_LENGTH = '<![CDATA['.length;
export const CDATA_CLOSE_LENGTH = ']]>'.length;

/**
 * For a scan that has reached the end of the buffer at `pos`: returns MORE while more text can
 * come, and once the input is final throws `WF_UNEXPECTED_END` with `message`.
 */
export function bufferEnded(tokenizer: Tokenizer, pos: number, message: string): typeof MORE {
  if (tokenizer.final) throw scanError(ErrorCode.WF_UNEXPECTED_END, pos, message);
  return MORE;
}

/**
 * For a scan that found the wrong character at `pos`: throws `errorCode` with `message`. If `pos`
 * is past the end of the buffer there is no character yet, so it acts as `bufferEnded` instead.
 */
export function throwUnexpected(tokenizer: Tokenizer, pos: number, errorCode: ErrorCode, message: string): typeof MORE {
  if (pos >= tokenizer.buffer.length) return bufferEnded(tokenizer, pos, message);
  throw scanError(errorCode, pos, message);
}

/**
 * Scans a name that must be at `start`, such as an element or entity name. Throws `errorCode`
 * ("Expected <description>") if there is none, or `LIMIT_NAME_LENGTH` if it is too long.
 * Returns the index after it, or MORE.
 */
export function scanRequiredName(
  tokenizer: Tokenizer,
  start: number,
  errorCode: ErrorCode,
  description: string
): number {
  const end = scanName(tokenizer, start);
  if (end === MORE) return MORE;
  if (end === start) throw scanError(errorCode, start, `Expected ${description}`);
  if (end - start > tokenizer.maxNameLength) nameTooLong(tokenizer, start);
  return end;
}

/** Throws `LIMIT_NAME_LENGTH` for the name at `start`; kept apart so `scanRequiredName` stays small. */
function nameTooLong(tokenizer: Tokenizer, start: number): never {
  throw scanError(ErrorCode.LIMIT_NAME_LENGTH, start, `A name is longer than ${tokenizer.maxNameLength} characters`);
}

/**
 * Skips whitespace in markup: space, tab, CR and LF, and in XML 1.1 NEL and LS too. Returns the
 * index after it, or MORE if it runs to the end of the buffer while more text can come.
 * (The scanner's `skipSpacesTabsAndLineFeeds` is different: it stops at CR, so text runs can note one.)
 */
export function skipWhitespace(tokenizer: Tokenizer, start: number): number {
  const text = tokenizer.buffer;
  let pos = start;
  // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
  while (isWhitespaceChar(text.charCodeAt(pos), tokenizer.version11)) pos++;
  return pos >= text.length && !tokenizer.final ? MORE : pos;
}

/**
 * Whether the rest of the buffer, from `pos`, could still grow into one of `words` once more
 * text arrives: `SYS` at the end of the buffer could become `SYSTEM`. Always false once the
 * input is final.
 */
export function couldBecomeWord(tokenizer: Tokenizer, pos: number, words: readonly string[]): boolean {
  if (tokenizer.final) return false;
  const rest = tokenizer.buffer.slice(pos);
  return words.some((word) => word.startsWith(rest));
}

/**
 * Scans the end of a comment from the `--` at `hyphens`, which must be followed by `>`: a comment
 * may not hold `--` anywhere else. Returns the index after `-->`, or MORE.
 */
export function scanCommentClose(tokenizer: Tokenizer, hyphens: number): number {
  // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
  const close = tokenizer.buffer.charCodeAt(hyphens + DOUBLE_HYPHEN_LENGTH);
  if (Number.isNaN(close)) return bufferEnded(tokenizer, hyphens, 'Unterminated comment');
  if (close !== Char.GREATER_THAN) {
    throw scanError(ErrorCode.WF_COMMENT, hyphens, '-- is not allowed inside a comment');
  }
  return hyphens + COMMENT_CLOSE_LENGTH;
}
