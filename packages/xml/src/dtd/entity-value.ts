import { ErrorCode } from '../errors/codes.ts';
import { Char, isChar } from '../util/chars.ts';
import { isXmlName } from '../util/names.ts';
import { codePointOfReference } from '../util/references.ts';
import { type DtdInput, type Frame, PE_IN_INTERNAL_SUBSET } from './input.ts';

// Module-level constants, so V8 can inline them.
const { PERCENT } = Char;

/**
 * Builds an entity's replacement text from the value in its declaration (§4.5): character references
 * and parameter-entity references are expanded, while general-entity references are kept as they are,
 * to be expanded when the entity is used. Errors are reported at `literalStart`, where the value's
 * literal starts in `frame`; `openEntities` lists the parameter entities being included.
 */
export function expandEntityValue(
  input: DtdInput,
  value: string,
  frame: Frame,
  literalStart: number,
  openEntities: string[]
): string {
  let expanded = '';
  let copiedTo = 0;
  for (let start = findNextReference(value, 0); start !== -1; start = findNextReference(value, copiedTo)) {
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const isParameterReference = value.charCodeAt(start) === PERCENT;
    if (isParameterReference && !frame.isExternal) {
      input.failAt(ErrorCode.WF_PE_IN_INTERNAL_SUBSET, PE_IN_INTERNAL_SUBSET, frame.locate(literalStart));
    }
    const semicolon = findReferenceEnd(input, value, start, frame, literalStart);
    const reference = value.slice(start, semicolon + 1);
    const expansion = isParameterReference
      ? includeParameterEntity(input, reference.slice(1, -1), frame, literalStart, openEntities)
      : decodeOrBypass(input, reference, frame, literalStart);
    expanded += value.slice(copiedTo, start) + expansion;
    copiedTo = semicolon + 1;
  }
  return expanded + value.slice(copiedTo);
}

/** The index of the `;` that ends the reference at `start`. */
function findReferenceEnd(input: DtdInput, value: string, start: number, frame: Frame, literalStart: number): number {
  const semicolon = value.indexOf(';', start);
  if (semicolon === -1)
    input.failAt(ErrorCode.WF_REFERENCE, 'Expected ; to end the reference', frame.locate(literalStart));
  return semicolon;
}

/** Includes a parameter entity in an entity value, its replacement text expanded in turn (§4.4.5). */
function includeParameterEntity(
  input: DtdInput,
  name: string,
  frame: Frame,
  literalStart: number,
  openEntities: string[]
): string {
  if (!isXmlName(name))
    input.failAt(ErrorCode.WF_REFERENCE, 'Expected a parameter entity name', frame.locate(literalStart));
  if (openEntities.includes(name)) {
    input.failAt(ErrorCode.WF_RECURSIVE_ENTITY, `The entity %${name}; refers to itself`, frame.locate(literalStart));
  }
  const replacement = input.replacementOf(name, frame, literalStart);
  if (replacement === undefined) return '';
  const exceeded = input.countExpansion(replacement, true);
  if (exceeded) input.failAt(exceeded.code, exceeded.message, frame.locate(literalStart));
  openEntities.push(name);
  const text = expandEntityValue(input, replacement.text, frame, literalStart, openEntities);
  openEntities.pop();
  return text;
}

/**
 * Handles a reference other than a parameter-entity one: a character reference becomes its
 * character, and a general-entity reference is bypassed (§4.4.7), kept once its syntax is checked.
 */
function decodeOrBypass(input: DtdInput, reference: string, frame: Frame, literalStart: number): string {
  if (!reference.startsWith('&#')) {
    if (!isXmlName(reference.slice(1, -1))) {
      input.failAt(ErrorCode.WF_REFERENCE, 'Expected a name or # after &', frame.locate(literalStart));
    }
    return reference;
  }
  const codePoint = codePointOfReference(reference.slice(1, -1));
  if (!isChar(codePoint, input.version11)) {
    input.failAt(
      ErrorCode.WF_CHARACTER_REFERENCE,
      `${reference} does not refer to a legal character`,
      frame.locate(literalStart)
    );
  }
  return String.fromCodePoint(codePoint);
}

/** The index of the next `%` or `&` at or after `from`, or -1. */
function findNextReference(value: string, from: number): number {
  const percent = value.indexOf('%', from);
  const ampersand = value.indexOf('&', from);
  if (percent === -1) return ampersand;
  return ampersand === -1 ? percent : Math.min(percent, ampersand);
}
