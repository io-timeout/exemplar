import { describe, expect, it } from 'vitest';
import { TypeInfo } from '@/index.ts';

describe('TypeInfo', () => {
  it('numbers the derivation methods (DOM Level 3 TypeInfo)', () => {
    expect([
      TypeInfo.DERIVATION_RESTRICTION,
      TypeInfo.DERIVATION_EXTENSION,
      TypeInfo.DERIVATION_UNION,
      TypeInfo.DERIVATION_LIST,
    ]).toEqual([1, 2, 4, 8]);
  });

  it('names a DTD type in the XML recommendation namespace', () => {
    const info = new TypeInfo('ID');
    expect([info.typeName, info.typeNamespace]).toEqual(['ID', 'http://www.w3.org/TR/REC-xml']);
  });

  it('has no namespace when it has no type', () => {
    const info = new TypeInfo(null);
    expect([info.typeName, info.typeNamespace]).toEqual([null, null]);
  });

  it('derives from nothing, as DTD types do not', () => {
    expect(new TypeInfo('CDATA').isDerivedFrom('http://www.w3.org/TR/REC-xml', 'CDATA', 1)).toBe(false);
  });
});
