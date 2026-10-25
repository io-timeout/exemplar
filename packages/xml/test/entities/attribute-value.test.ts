import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type Limits } from '@/config/options.ts';
import type { EntityDeclaration } from '@/dtd/declarations.ts';
import { DeclarationStore } from '@/dtd/store.ts';
import {
  type ExpansionContext,
  expandAttributeValue,
  lookupGeneral,
  normalizeTokens,
} from '@/entities/attribute-value.ts';
import { EntityCounter } from '@/entities/limits.ts';

/** A store holding the given general entities, as if read from a DOCTYPE with only an internal subset. */
function storeOf(...entities: EntityDeclaration[]): DeclarationStore {
  const store = new DeclarationStore();
  store.hasDoctype = true;
  for (const entity of entities) store.declareEntity(entity);
  return store;
}

/** An internal general entity. */
const internal = (name: string, value: string): EntityDeclaration => ({
  name,
  isParameterEntity: false,
  value,
  declaredExternally: false,
});

/** An expansion context whose fail throws an error carrying the code, and whose error records it. */
function contextOf(
  store: DeclarationStore,
  { version11 = false, namespaceAware = true, limits = {} as Partial<Limits>, known = {} } = {}
): ExpansionContext & { errors: string[] } {
  const errors: string[] = [];
  return {
    store,
    known: new Map(Object.entries(known)),
    counter: new EntityCounter({ ...DEFAULT_LIMITS, ...limits }),
    version11,
    namespaceAware,
    fail: (code, message) => {
      throw Object.assign(new Error(message), { code });
    },
    error: (code) => errors.push(code),
    errors,
  };
}

/** Expands a value with no entities declared, under the given context options. */
function expandPlain(raw: string, options: Parameters<typeof contextOf>[1] = {}, lineEndsNormalized = false): string {
  return expandAttributeValue(raw, contextOf(storeOf(), options), lineEndsNormalized);
}

/** Expands a value with the given entities declared. */
function expand(raw: string, ...entities: EntityDeclaration[]): string {
  return expandAttributeValue(raw, contextOf(storeOf(...entities)));
}

describe('lookupGeneral (the Entity Declared rules, §4.1)', () => {
  it('finds an entity the DTD declares, before one known in advance', () => {
    const store = storeOf(internal('e', 'dtd'));
    expect(lookupGeneral(store, new Map([['e', 'known']]), 'e')).toEqual({
      kind: 'entity',
      entity: internal('e', 'dtd'),
    });
  });

  it('finds an entity known in advance when the DTD does not declare it', () => {
    expect(lookupGeneral(storeOf(), new Map([['nbsp', '\u00A0']]), 'nbsp')).toEqual({
      kind: 'entity',
      entity: { name: 'nbsp', isParameterEntity: false, value: '\u00A0', declaredExternally: false },
    });
  });

  it('makes an undeclared entity fatal with no DTD, or one read in full with no parameter-entity references', () => {
    expect(lookupGeneral(new DeclarationStore(), new Map(), 'u')).toEqual({ kind: 'fatal' });
    expect(lookupGeneral(storeOf(), new Map(), 'u')).toEqual({ kind: 'fatal' });
  });

  it('makes an undeclared entity a validity error when the DTD has parts it may not have read', () => {
    const read = Object.assign(storeOf(), { hasParameterReferences: true });
    expect(lookupGeneral(read, new Map(), 'u')).toEqual({ kind: 'undeclared' });
    const unread = Object.assign(storeOf(), { hasExternalSubset: true, hasUnreadDeclarations: true });
    expect(lookupGeneral(unread, new Map(), 'u')).toEqual({ kind: 'unread' });
  });

  it('does not count an external declaration in a standalone document', () => {
    const store = storeOf({ name: 'x', isParameterEntity: false, value: 'v', declaredExternally: true });
    store.hasExternalSubset = true;
    store.isStandalone = true;
    expect(lookupGeneral(store, new Map(), 'x')).toEqual({ kind: 'fatal' });
  });
});

describe('expandAttributeValue (attribute-value normalization, §3.3.3)', () => {
  it('returns a value with nothing to normalize as it is', () => {
    expect(expand('plain value')).toBe('plain value');
  });

  it('turns each literal tab, line feed and carriage return into a space', () => {
    expect(expand('a\tb\nc\rd')).toBe('a b c d');
  });

  it('normalizes line ends of source text first, so CR LF becomes one space (§2.11)', () => {
    expect(expandPlain('a\r\nb')).toBe('a b');
    expect(expandPlain('a\r\nb', {}, true)).toBe('a  b');
  });

  it('turns XML 1.1 line ends into a space in an XML 1.1 document', () => {
    expect(expandPlain('a\u0085b\u2028c', { version11: true })).toBe('a b c');
    expect(expandPlain('a\u0085b')).toBe('a\u0085b');
  });

  it('keeps whitespace written as character references (§3.3.3)', () => {
    expect(expand('a&#9;b&#10;c&#13;d&#x20;e')).toBe('a\tb\nc\rd e');
  });

  it('decodes the predefined entities and character references', () => {
    expect(expand('&lt;&gt;&amp;&apos;&quot;&#65;&#x42;&#x1F525;')).toBe('<>&\'"AB🔥');
  });

  it('expands entities, normalizing the whitespace in their replacement text', () => {
    expect(expand('[&e;]', internal('e', 'a\tb&f;'), internal('f', '\nc'))).toBe('[a b c]');
  });

  it('keeps whitespace an entity holds as a character reference', () => {
    expect(expand('[&e;]', internal('e', '&#10;'))).toBe('[\n]');
  });

  it('takes the entities known in advance', () => {
    expect(expandPlain('&copy;', { known: { copy: '©' } })).toBe('©');
  });

  it.each([
    ['a<b', 'WF_LT_IN_ATTRIBUTE'],
    ['&e;', 'WF_LT_IN_ATTRIBUTE'],
    ['a&amp', 'WF_REFERENCE'],
    ['&1a;', 'WF_REFERENCE'],
    ['&;', 'WF_REFERENCE'],
    ['&a:b;', 'NS_COLON'],
    ['&u;', 'WF_UNDECLARED_ENTITY'],
    ['&unparsed;', 'WF_UNPARSED_ENTITY'],
    ['&ext;', 'WF_EXTERNAL_ENTITY_IN_ATTRIBUTE'],
    ['&loop;', 'WF_RECURSIVE_ENTITY'],
    ['&#0;', 'WF_CHARACTER_REFERENCE'],
    ['&#x1;', 'WF_CHARACTER_REFERENCE'],
    ['&#xD800;', 'WF_CHARACTER_REFERENCE'],
    ['&#x110000;', 'WF_CHARACTER_REFERENCE'],
    ['&#x;', 'WF_CHARACTER_REFERENCE'],
    ['&#X41;', 'WF_CHARACTER_REFERENCE'],
  ])('rejects %s', (raw, code) => {
    const store = storeOf(
      internal('e', '<'),
      { name: 'unparsed', isParameterEntity: false, systemId: 'u.gif', notation: 'gif', declaredExternally: false },
      { name: 'ext', isParameterEntity: false, systemId: 'x.xml', declaredExternally: false },
      internal('loop', '&loop2;'),
      internal('loop2', '&loop;')
    );
    expect(() => expandAttributeValue(raw, contextOf(store))).toThrow(expect.objectContaining({ code }));
  });

  it('allows the XML 1.1 restricted characters as references in an XML 1.1 document (XML 1.1 §2.2)', () => {
    expect(expandPlain('&#x1;', { version11: true })).toBe('\u0001');
  });

  it('looks an entity name with a colon up when not namespace-aware', () => {
    const context = contextOf(storeOf(internal('a:b', 'x')), { namespaceAware: false });
    expect(expandAttributeValue('&a:b;', context)).toBe('x');
  });

  it('reports a reference it cannot use as a recoverable error and drops it', () => {
    const unread = Object.assign(storeOf(), { hasExternalSubset: true, hasUnreadDeclarations: true });
    const first = contextOf(unread);
    expect(expandAttributeValue('[&u;]', first)).toBe('[]');
    expect(first.errors).toEqual(['UNREAD_ENTITY_IN_ATTRIBUTE']);
    const read = contextOf(Object.assign(storeOf(), { hasParameterReferences: true }));
    expect(expandAttributeValue('[&u;]', read)).toBe('[]');
    expect(read.errors).toEqual(['VC_ENTITY_DECLARED']);
  });

  it('counts each expansion against the limits', () => {
    const context = contextOf(storeOf(internal('e', 'xx')), { limits: { entityExpansions: 2 } });
    expect(expandAttributeValue('&e;&e;', context)).toBe('xxxx');
    expect(() => expandAttributeValue('&e;', context)).toThrow(
      expect.objectContaining({ code: 'LIMIT_ENTITY_EXPANSIONS' })
    );
  });
});

describe('normalizeTokens (values of types other than CDATA, §3.3.3)', () => {
  it('drops leading and trailing spaces and collapses runs of them', () => {
    expect(normalizeTokens('  a   b  c ')).toBe('a b c');
    expect(normalizeTokens('   ')).toBe('');
  });

  it('returns a value without spaces as it is, other whitespace included', () => {
    expect(normalizeTokens('ab')).toBe('ab');
    expect(normalizeTokens('a\tb')).toBe('a\tb');
  });
});
