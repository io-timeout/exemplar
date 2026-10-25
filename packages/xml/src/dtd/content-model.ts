import { ErrorCode } from '../errors/codes.ts';
import { Char } from '../util/chars.ts';
import type { DtdInput, Frame } from './input.ts';

// Module-level constants, so V8 can inline them.
const { ASTERISK, COMMA, LEFT_PAREN, PLUS, QUESTION, RIGHT_PAREN, VERTICAL_BAR } = Char;

/** Reads a mixed or children content model (§3.2.1, §3.2.2), returned without whitespace. */
export function readContentModel(input: DtdInput): string {
  if (input.currentChar() !== LEFT_PAREN) input.fail(ErrorCode.WF_DECLARATION, 'Expected EMPTY, ANY or (');
  const openFrame = input.currentFrame();
  input.advance();
  input.optionalWhitespace();
  if (input.startsWith('#PCDATA')) return readMixedContent(input, openFrame);
  return `${readGroup(input, openFrame)}${readRepetition(input)}`;
}

/** `(#PCDATA | a | b)*` or `(#PCDATA)`, after the opening parenthesis. */
function readMixedContent(input: DtdInput, openFrame: Frame): string {
  input.advance('#PCDATA'.length);
  let choices = '';
  for (;;) {
    input.optionalWhitespace();
    if (input.currentChar() !== VERTICAL_BAR) break;
    input.advance();
    input.optionalWhitespace();
    choices += `|${input.readCheckedName('an element name', true)}`;
  }
  if (input.currentChar() !== RIGHT_PAREN)
    input.fail(ErrorCode.WF_DECLARATION, 'Expected ) to end the mixed content model');
  input.checkSameEntity(openFrame, 'A group');
  input.advance();
  const star = input.startsWith('*');
  if (choices !== '' && !star) input.fail(ErrorCode.WF_DECLARATION, 'Mixed content with element names must end in )*');
  if (star) input.advance();
  return `(#PCDATA${choices})${star ? '*' : ''}`;
}

/** A choice or sequence after its opening parenthesis (§3.2.1 [49], [50]). */
function readGroup(input: DtdInput, openFrame: Frame): string {
  const parts = [readParticle(input)];
  let separator = '';
  for (;;) {
    input.optionalWhitespace();
    const char = input.currentChar();
    if (char === RIGHT_PAREN) break;
    const sign = char === VERTICAL_BAR ? '|' : ',';
    if ((char !== VERTICAL_BAR && char !== COMMA) || (separator !== '' && sign !== separator)) {
      input.fail(ErrorCode.WF_DECLARATION, 'Expected |, , or ) in the content model');
    }
    separator = sign;
    input.advance();
    input.optionalWhitespace();
    parts.push(readParticle(input));
  }
  input.checkSameEntity(openFrame, 'A group');
  input.advance();
  return `(${parts.join(separator)})`;
}

/** One content particle: a name or a nested group, with its repetition (§3.2.1 [48]). */
function readParticle(input: DtdInput): string {
  if (input.currentChar() === LEFT_PAREN) {
    const openFrame = input.currentFrame();
    input.advance();
    input.optionalWhitespace();
    if (input.startsWith('#PCDATA')) input.fail(ErrorCode.WF_DECLARATION, '#PCDATA may only start the outer group');
    return `${readGroup(input, openFrame)}${readRepetition(input)}`;
  }
  return `${input.readCheckedName('an element name or (', true)}${readRepetition(input)}`;
}

/** An optional `?`, `*` or `+`. */
function readRepetition(input: DtdInput): string {
  const char = input.currentChar();
  if (char !== QUESTION && char !== ASTERISK && char !== PLUS) return '';
  input.advance();
  // eslint-disable-next-line prefer-code-point -- char is ?, * or +
  return String.fromCharCode(char);
}
