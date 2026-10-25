import { describe, expect, it } from 'vitest';
import { isKnownNcName, qualifiedName } from '@/names.ts';

describe('qualifiedName', () => {
  it('puts a prefix and a colon before the local name, when there is a prefix', () => {
    expect([qualifiedName('', 'a'), qualifiedName('p', 'a')]).toEqual(['a', 'p:a']);
  });
});

describe('isKnownNcName', () => {
  it('accepts XML names without colons, again once remembered, and nothing else', () => {
    expect(['a', 'a', '_b.c-d', 'a:b', '1a', ''].map((name) => isKnownNcName(name))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
