import { describe, expect, it } from 'vitest';
import type { EntityDeclaration } from '@/dtd/declarations.ts';
import { DeclarationStore } from '@/dtd/store.ts';

/** An internal general entity declaration. */
const entity = (name: string, value: string, external = false): EntityDeclaration => ({
  name,
  isParameterEntity: false,
  value,
  declaredExternally: external,
});

describe('DeclarationStore', () => {
  it('starts empty, with no DOCTYPE', () => {
    const store = new DeclarationStore();
    expect([
      store.generalEntities.size,
      store.parameterEntities.size,
      store.elements.size,
      store.attributes.size,
    ]).toEqual([0, 0, 0, 0]);
    expect([store.notations.size, store.items, store.processingInstructions]).toEqual([0, [], []]);
    expect([
      store.hasDoctype,
      store.hasExternalSubset,
      store.hasParameterReferences,
      store.hasUnreadDeclarations,
      store.stoppedApplying,
    ]).toEqual([false, false, false, false, false]);
  });

  it('keeps general and parameter entities apart, the first declaration of each name binding (§4.2)', () => {
    const store = new DeclarationStore();
    store.declareEntity(entity('e', '1'));
    store.declareEntity(entity('e', '2'));
    store.declareEntity({ name: 'e', isParameterEntity: true, value: 'p', declaredExternally: false });
    expect([store.generalEntities.get('e')?.value, store.parameterEntities.get('e')?.value]).toEqual(['1', 'p']);
    expect(store.items.map((item) => item.kind)).toEqual(['entity', 'entity']);
  });

  it('keeps the first declaration of an attribute for each element (§3.3)', () => {
    const store = new DeclarationStore();
    const attribute = { element: 'a', name: 'x', type: 'CDATA', mode: 'IMPLIED', declaredExternally: false } as const;
    store.declareAttribute(attribute);
    store.declareAttribute({ ...attribute, type: 'ID' });
    store.declareAttribute({ ...attribute, name: 'y' });
    store.declareAttribute({ ...attribute, element: 'b' });
    expect([...(store.attributes.get('a')?.values() ?? [])].map((a) => [a.name, a.type])).toEqual([
      ['x', 'CDATA'],
      ['y', 'CDATA'],
    ]);
    expect(store.attributes.get('b')?.size).toBe(1);
    expect(store.items).toHaveLength(3);
  });

  it('says whether an element or notation declaration was new', () => {
    const store = new DeclarationStore();
    expect(store.declareElement({ name: 'a', content: 'ANY', declaredExternally: false })).toBe(true);
    expect(store.declareElement({ name: 'a', content: 'EMPTY', declaredExternally: false })).toBe(false);
    expect(store.declareNotation({ name: 'n', systemId: 's' })).toBe(true);
    expect(store.declareNotation({ name: 'n', publicId: 'p' })).toBe(false);
    expect([store.elements.get('a')?.content, store.notations.get('n')]).toEqual(['ANY', { name: 'n', systemId: 's' }]);
  });

  it('keeps processing instructions in order, among the items too', () => {
    const store = new DeclarationStore();
    store.addProcessingInstruction('p', 'one');
    store.declareElement({ name: 'a', content: 'ANY', declaredExternally: false });
    store.addProcessingInstruction('q', 'two');
    expect(store.processingInstructions).toEqual([
      { target: 'p', data: 'one' },
      { target: 'q', data: 'two' },
    ]);
    expect(store.items.map((item) => item.kind)).toEqual(['pi', 'element', 'pi']);
  });

  it.each([
    [{ hasDoctype: false }, true],
    [{ hasDoctype: true }, true],
    [{ hasDoctype: true, hasExternalSubset: true }, false],
    [{ hasDoctype: true, hasParameterReferences: true }, false],
    [{ hasDoctype: true, hasExternalSubset: true, isStandalone: true }, true],
    [{ hasDoctype: true, hasParameterReferences: true, isStandalone: true }, true],
  ])('decides whether Entity Declared is a well-formedness constraint (§4.1) for %o', (state, wellFormedness) => {
    const store = Object.assign(new DeclarationStore(), state);
    expect(store.undeclaredEntityIsFatal).toBe(wellFormedness);
  });

  it('does not count external declarations for a standalone document (§2.9)', () => {
    const store = new DeclarationStore();
    store.declareEntity(entity('i', 'internal'));
    store.declareEntity(entity('x', 'external', true));
    expect([store.generalEntity('i')?.value, store.generalEntity('x')?.value, store.generalEntity('u')]).toEqual([
      'internal',
      'external',
      undefined,
    ]);
    store.isStandalone = true;
    expect([store.generalEntity('i')?.value, store.generalEntity('x')]).toEqual(['internal', undefined]);
  });
});
