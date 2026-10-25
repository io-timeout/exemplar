import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import {
  type IncludeAttributes,
  attributeProblem,
  headersOf,
  inclusionKey,
  includeAttributesOf,
  isDocumentLoop,
  isIntraDocumentLoop,
} from '@/include.ts';

/** An xi:include's attributes, with the defaults filled in. */
function include(attributes: Partial<IncludeAttributes>): IncludeAttributes {
  return {
    parse: 'xml',
    href: 'a.xml',
    xpointer: undefined,
    accept: undefined,
    acceptLanguage: undefined,
    encoding: undefined,
    ...attributes,
  };
}

describe('includeAttributesOf', () => {
  it('reads the attributes, defaulting parse to xml and href to empty', () => {
    const reader = new XMLInputFactory().createStreamReader('<include xpointer="p" accept-language="en"/>');
    reader.next();
    expect(includeAttributesOf(reader)).toEqual(include({ href: '', xpointer: 'p', acceptLanguage: 'en' }));
  });
});

describe('attributeProblem (XInclude §3.1)', () => {
  it('allows well-formed attributes', () => {
    expect(attributeProblem(include({}))).toBeUndefined();
    expect(attributeProblem(include({ href: '', xpointer: 'p' }))).toBeUndefined();
    expect(attributeProblem(include({ href: 'a%20b.txt', parse: 'text', accept: 'text/plain' }))).toBeUndefined();
  });

  it.each([
    ['an unknown parse value', { parse: 'html' }],
    ['a fragment identifier in href', { href: 'a.xml#x' }],
    ['a stray %', { href: 'a%2.xml' }],
    ['neither href nor xpointer', { href: '' }],
    ['xpointer with parse="text"', { parse: 'text', xpointer: 'p' }],
    ['accept outside printable ASCII', { accept: 'text/plain\t' }],
    ['accept-language outside printable ASCII', { acceptLanguage: `fr${String.fromCharCode(0xe9)}` }],
  ])('rejects %s', (_what, attributes) => {
    expect(attributeProblem(include(attributes))).toBeTypeOf('string');
  });
});

describe('headersOf', () => {
  it('gives only the headers the attributes ask for', () => {
    expect(headersOf(include({}))).toEqual({});
    expect(headersOf(include({ accept: 'text/xml', acceptLanguage: 'en' }))).toEqual({
      accept: 'text/xml',
      acceptLanguage: 'en',
    });
  });
});

describe('loops (XInclude §4.6)', () => {
  const chain = [inclusionKey('file:///main.xml', undefined), inclusionKey('file:///part.xml', 'p')];

  it('finds any reference back to another document in the chain, whatever its pointer', () => {
    expect(isDocumentLoop(chain, 'file:///part.xml')).toBe(true);
    expect(isDocumentLoop(chain, 'file:///main.xml')).toBe(true);
    expect(isDocumentLoop(chain, 'file:///other.xml')).toBe(false);
  });

  it('finds a reference into the including document only with the same pointer', () => {
    expect(isIntraDocumentLoop(chain, 'file:///part.xml', 'p')).toBe(true);
    expect(isIntraDocumentLoop(chain, 'file:///part.xml', 'q')).toBe(false);
  });
});
