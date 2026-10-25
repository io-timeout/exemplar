import { describe, expect, it } from 'vitest';
import { isNcName, isNmtoken, isXmlName, localPartOf, prefixOf, splitQName } from '@/util/names.ts';

describe('names (§2.3 [5], [7], Namespaces [4])', () => {
  it.each([
    ['a', true],
    ['_a.b-1', true],
    [':', true],
    ['a:b:c', true],
    ['ſ', true],
    ['éa', true],
    ['a·', true],
    ['\u{10000}', true],
    ['a\u{EFFFF}', true],
    ['', false],
    ['1a', false],
    ['-a', false],
    ['.a', false],
    ['a b', false],
    ['a$', false],
    ['·a', false],
    ['̀a', false],
    ['a×', false],
    ['é×', false],
    ['\u{F0000}', false],
    ['a\u{F0000}', false],
    ['\uD800', false],
    ['a\uDC00', false],
  ])('tells whether %j is a Name', (name, expected) => {
    expect(isXmlName(name)).toBe(expected);
  });

  it.each([
    ['1a', true],
    ['-', true],
    ['.5', true],
    ['·', true],
    ['̀', true],
    ['é', true],
    ['', false],
    ['a b', false],
    ['×', false],
  ])('tells whether %j is an Nmtoken (§2.3 [7])', (name, expected) => {
    expect(isNmtoken(name)).toBe(expected);
  });

  it.each([
    ['a', true],
    ['é', true],
    ['a-b.c', true],
    ['a:b', false],
    [':', false],
    ['1', false],
    ['', false],
  ])('tells whether %j is an NCName (Namespaces [4])', (name, expected) => {
    expect(isNcName(name)).toBe(expected);
  });
});

describe('qualified names (Namespaces [7])', () => {
  it.each([
    ['a', ['', 'a']],
    ['p:a', ['p', 'a']],
    ['xml:lang', ['xml', 'lang']],
    [':a', undefined],
    ['p:', undefined],
    ['p:a:b', undefined],
    [':', undefined],
  ])('splits %j into %j', (name, parts) => {
    expect(splitQName(name)).toEqual(parts);
  });

  it("gives a name's prefix and local part, the whole name being local when it has no colon", () => {
    expect([prefixOf('p:a'), localPartOf('p:a')]).toEqual(['p', 'a']);
    expect([prefixOf('a'), localPartOf('a')]).toEqual(['', 'a']);
  });
});
