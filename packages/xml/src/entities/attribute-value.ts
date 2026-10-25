import type { EntityDeclaration } from '../dtd/declarations.ts';
import type { DeclarationStore } from '../dtd/store.ts';
import { ErrorCode } from '../errors/codes.ts';
import { Char, isChar } from '../util/chars.ts';
import { isXmlName } from '../util/names.ts';
import { normalizeLineEnds } from '../util/normalize.ts';
import { PREDEFINED_ENTITIES, codePointOfReference } from '../util/references.ts';
import type { EntityCounter } from './limits.ts';

// Module-level constants, so V8 can inline them.
const { AMPERSAND, CARRIAGE_RETURN, LESS_THAN, LINE_FEED, TAB } = Char;

/** What a reference to a general entity finds under the Entity Declared rules (§4.1). */
export type Lookup =
  | { readonly kind: 'entity'; readonly entity: EntityDeclaration }
  /** Undeclared where that is a fatal error (WFC: Entity Declared). */
  | { readonly kind: 'fatal' }
  /** Not declared in what was read; the declaration may be in what was not. */
  | { readonly kind: 'unread' }
  /** Undeclared in a DTD that was read in full: a validity error (VC: Entity Declared). */
  | { readonly kind: 'undeclared' };

/** Looks up a general entity in the DTD, and then among the entities the options declare in advance. */
export function lookupGeneral(
  store: DeclarationStore,
  knownEntities: ReadonlyMap<string, string>,
  name: string
): Lookup {
  const entity = store.generalEntity(name);
  if (entity) return { kind: 'entity', entity };
  const value = knownEntities.get(name);
  if (value !== undefined)
    return { kind: 'entity', entity: { name, isParameterEntity: false, value, declaredExternally: false } };
  if (store.undeclaredEntityIsFatal) return { kind: 'fatal' };
  return store.hasUnreadDeclarations ? { kind: 'unread' } : { kind: 'undeclared' };
}

/** What expanding an attribute value needs from the reader. */
export interface ExpansionContext {
  readonly store: DeclarationStore;
  /** Entities the options declare in advance, by name, with their replacement text. */
  readonly known: ReadonlyMap<string, string>;
  readonly counter: EntityCounter;
  readonly version11: boolean;
  readonly namespaceAware: boolean;
  /** Throws a fatal error. */
  fail(code: ErrorCode, message: string): never;
  /** Reports a recoverable error. */
  error(code: ErrorCode, message: string): void;
}

/** Whether a code unit is one of the whitespace characters attribute-value normalization turns into a space. */
function isNormalizedWhitespace(char: number): boolean {
  return char === TAB || char === LINE_FEED || char === CARRIAGE_RETURN;
}

/**
 * Normalizes a value as §3.3.3 says for CDATA: each whitespace character becomes a space, and
 * references are expanded, recursively for entities. `openEntities` lists the entities being
 * expanded, so that one referring to itself is caught.
 */
function normalizeValue(text: string, context: ExpansionContext, openEntities: string[]): string {
  let normalized = '';
  let copiedTo = 0;
  let pos = 0;
  while (pos < text.length) {
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const char = text.charCodeAt(pos);
    if (char === AMPERSAND) {
      const semicolon = text.indexOf(';', pos);
      if (semicolon === -1) context.fail(ErrorCode.WF_REFERENCE, 'Expected ; to end the reference');
      normalized += text.slice(copiedTo, pos) + expandReference(text.slice(pos + 1, semicolon), context, openEntities);
      copiedTo = semicolon + 1;
      pos = copiedTo;
      continue;
    }
    if (isNormalizedWhitespace(char)) {
      normalized += `${text.slice(copiedTo, pos)} `;
      copiedTo = pos + 1;
    } else if (char === LESS_THAN) {
      context.fail(
        ErrorCode.WF_LT_IN_ATTRIBUTE,
        '< is not allowed in an attribute value, nor in entities it refers to'
      );
    }
    pos++;
  }
  return copiedTo === 0 ? text : normalized + text.slice(copiedTo);
}

/** Expands one reference in an attribute value, given what lies between its `&` and `;`: `#…`, `#x…` or an entity name. */
function expandReference(body: string, context: ExpansionContext, openEntities: string[]): string {
  if (body.startsWith('#')) return decodeCharacterReference(body, context);
  if (!isXmlName(body)) context.fail(ErrorCode.WF_REFERENCE, 'Expected a name or # after &');
  const predefined = PREDEFINED_ENTITIES.get(body);
  if (predefined !== undefined) return predefined;
  if (context.namespaceAware && body.includes(':')) {
    context.fail(ErrorCode.NS_COLON, 'An entity name must not contain a colon');
  }
  const found = lookupGeneral(context.store, context.known, body);
  if (found.kind !== 'entity') return handleUnusableEntity(body, found.kind, context);
  return expandEntity(found.entity, context, openEntities);
}

/** Decodes a character reference, which must name a Char (WFC: Legal Character). */
function decodeCharacterReference(body: string, context: ExpansionContext): string {
  const codePoint = codePointOfReference(body);
  if (!isChar(codePoint, context.version11)) {
    context.fail(ErrorCode.WF_CHARACTER_REFERENCE, `&${body}; does not refer to a legal character`);
  }
  return String.fromCodePoint(codePoint);
}

/** Handles a reference to an entity that can't be used here: a fatal error, or reported and expanded to nothing. */
function handleUnusableEntity(
  name: string,
  kind: 'fatal' | 'unread' | 'undeclared',
  context: ExpansionContext
): string {
  if (kind === 'fatal') context.fail(ErrorCode.WF_UNDECLARED_ENTITY, `The entity ${name} is not declared`);
  if (kind === 'unread') {
    context.error(ErrorCode.UNREAD_ENTITY_IN_ATTRIBUTE, `The declaration of the entity ${name} has not been read`);
  } else {
    context.error(ErrorCode.VC_ENTITY_DECLARED, `The entity ${name} is not declared`);
  }
  return '';
}

/** Expands an entity in an attribute value, which must be parsed, internal and not recursive. */
function expandEntity(declaration: EntityDeclaration, context: ExpansionContext, openEntities: string[]): string {
  const { name, value } = declaration;
  if (declaration.notation !== undefined) {
    context.fail(ErrorCode.WF_UNPARSED_ENTITY, `The entity ${name} is unparsed and cannot be referred to`);
  }
  if (value === undefined) {
    context.fail(
      ErrorCode.WF_EXTERNAL_ENTITY_IN_ATTRIBUTE,
      `The external entity ${name} cannot be used in an attribute`
    );
  }
  if (openEntities.includes(name)) context.fail(ErrorCode.WF_RECURSIVE_ENTITY, `The entity ${name} refers to itself`);
  const exceeded = context.counter.countGeneralExpansion(value.length);
  if (exceeded) context.fail(exceeded.code, exceeded.message);
  openEntities.push(name);
  const expanded = normalizeValue(value, context, openEntities);
  openEntities.pop();
  return expanded;
}

/**
 * Normalizes a CDATA attribute value (§3.3.3), expanding its references. Its line ends are normalized
 * first unless `lineEndsNormalized` says that has been done, as for replacement text and DTD text.
 */
export function expandAttributeValue(value: string, context: ExpansionContext, lineEndsNormalized = false): string {
  return normalizeValue(lineEndsNormalized ? value : normalizeLineEnds(value, context.version11), context, []);
}

/** Normalizes a value of a type other than CDATA, such as NMTOKENS (§3.3.3): no spaces at either end, and one between tokens. */
export function normalizeTokens(value: string): string {
  if (!value.includes(' ')) return value;
  return value
    .split(' ')
    .filter((token) => token !== '')
    .join(' ');
}
