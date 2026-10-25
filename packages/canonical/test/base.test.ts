import { describe, expect, it } from 'vitest';
import { joinURIReferences, removeDotSegments } from '@/base.ts';

describe('removeDotSegments, as Canonical XML 1.1 modifies it (C14N 1.1 §2.4, Appendix A)', () => {
  it.each([
    ['no/.././/pseudo-netpath/seg/file.ext', 'pseudo-netpath/seg/file.ext'],
    ['no/..//.///pseudo-netpath/seg/file.ext', 'pseudo-netpath/seg/file.ext'],
    ['yes/no//..//.///pseudo-netpath/seg/file.ext', 'yes/pseudo-netpath/seg/file.ext'],
    ['no/../yes', 'yes'],
    ['no/../yes/', 'yes/'],
    ['no/../yes/no/..', 'yes/'],
    ['../../no/../..', '../../../'],
    ['no/../..', '../'],
    ['no/..', ''],
    ['no/../', ''],
    ['/a/b/c/./../../g', '/a/g'],
    ['mid/content=5/../6', 'mid/6'],
    ['../../..', '../../../'],
    ['no/../../', '../'],
    ['..yes/..no/..no/..no/../../../..yes', '..yes/..yes'],
    ['..yes/..no/..no/..no/../../../..yes/', '..yes/..yes/'],
    ['../..', '../../'],
    ['../../../', '../../../'],
    ['.', ''],
    ['./', ''],
    ['./.', ''],
    ['//no/..', '/'],
    ['../../no/..', '../../'],
    ['../../no/../', '../../'],
    ['yes/no/../', 'yes/'],
    ['yes/no/no/../..', 'yes/'],
    ['yes/no/no/no/../../..', 'yes/'],
    ['yes/no/../yes/no/no/../..', 'yes/yes/'],
    ['yes/no/no/no/../../../yes', 'yes/yes'],
    ['/no/../', '/'],
    ['/yes/no/no/no/../../..', '/yes/'],
    ['../../..no/..', '../../'],
    ['..yes/...no/..no/..no/../../..', '..yes/'],
    ['/..yes/..no/..no/../..', '/..yes/'],
    ['/', '/'],
    ['/./.', '/'],
    ['/../../..', '/'],
    ['//..//..//..', '/'],
    ['/./.././.././..', '/'],
    ['..', '../'],
    ['../', '../'],
    ['', ''],
  ])('%j becomes %j', (path, expected) => {
    expect(removeDotSegments(path)).toBe(expected);
  });
});

describe('joinURIReferences (C14N 1.1 §2.4)', () => {
  it.each([
    ['abc/', '../', ''],
    ['../', '../', '../../'],
    ['..', '..', '../../'],
    ['something/else', 'bar/foo', 'something/bar/foo'],
  ])('joins %j and %j as the recommendation shows, to %j', (base, reference, expected) => {
    expect(joinURIReferences(base, reference)).toBe(expected);
  });

  it.each([
    ['a/b/', '../c/', 'a/c/'],
    ['a/b', 'c', 'a/c'],
    ['a', 'c', 'c'],
    ['', 'c', 'c'],
    ['a/b', '/c', '/c'],
    ['a/b', '', 'a/b'],
    ['a/b?q', '', 'a/b?q'],
    ['a/b?q', '?r', 'a/b?r'],
    ['a/b', 'c?r', 'a/c?r'],
  ])('joins the relative %j and %j to the relative %j (RFC 3986 §5.2.2)', (base, reference, expected) => {
    expect(joinURIReferences(base, reference)).toBe(expected);
  });

  it.each([
    ['http://e.com/a/b/', '../c/', 'http://e.com/a/c/'],
    ['http://e.com/a/b', 'c', 'http://e.com/a/c'],
    ['http://e.com', 'c', 'http://e.com/c'],
    ['http://e.com/a/b', '//f.org/c/../d', 'http://f.org/d'],
    ['http://e.com/a/', 'urn:x', 'urn:x'],
    ['a/b', 'http://e.com/x/./y', 'http://e.com/x/y'],
    ['urn:a/b', 'c', 'urn:a/c'],
  ])('joins %j and %j to %j', (base, reference, expected) => {
    expect(joinURIReferences(base, reference)).toBe(expected);
  });

  it('changes no case and escapes nothing, being a string operation', () => {
    expect(joinURIReferences('http://E.com/a b/', 'y/')).toBe('http://E.com/a b/y/');
    expect(joinURIReferences('HTTP://e.com/%7e/', 'ü')).toBe('HTTP://e.com/%7e/ü');
  });

  it('ignores fragments', () => {
    expect(joinURIReferences('a/b#f', 'c#g')).toBe('a/c');
    expect(joinURIReferences('a/b#f', '#g')).toBe('a/b');
  });
});
