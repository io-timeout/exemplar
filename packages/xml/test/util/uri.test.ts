import { describe, expect, it } from 'vitest';
import { escapeAndResolveURI, escapeURI, hasScheme, protocolOf, resolveURI } from '@/util/uri.ts';

describe('escapeURI (XML 1.1 §4.2.2, XML Catalogs §6.3)', () => {
  it('returns a URI with nothing to escape as it is', () => {
    const uri = 'http://example.org/a/b.dtd?x=1&y=%20#frag';
    expect(escapeURI(uri)).toBe(uri);
  });

  it('escapes spaces, the characters URIs exclude and non-ASCII characters as %HH of UTF-8', () => {
    expect(escapeURI('a b')).toBe('a%20b');
    expect(escapeURI('"<>\\^`{|}')).toBe('%22%3C%3E%5C%5E%60%7B%7C%7D');
    expect(escapeURI('é')).toBe('%C3%A9');
    expect(escapeURI('𝄞')).toBe('%F0%9D%84%9E');
    expect(escapeURI('a\tb\u007F')).toBe('a%09b%7F');
  });

  it('keeps the characters a URI may hold among those it escapes', () => {
    expect(escapeURI("http://h/p ath/[x]_~!$&'()*+,;=:@é")).toBe("http://h/p%20ath/[x]_~!$&'()*+,;=:@%C3%A9");
  });
});

describe('hasScheme', () => {
  it.each([
    ['http://example.org/', true],
    ['urn:x', true],
    ['a+b.c-d:x', true],
    ['a.dtd', false],
    ['../a.dtd', false],
    ['1a:b', false],
    [':x', false],
    ['', false],
  ])('%s has a scheme: %s', (uri, scheme) => {
    expect(hasScheme(uri)).toBe(scheme);
  });
});

describe('resolveURI', () => {
  it('resolves a relative system id against the base URI (RFC 3986 §5)', () => {
    expect(resolveURI('b.dtd', 'http://example.org/a/doc.xml')).toBe('http://example.org/a/b.dtd');
    expect(resolveURI('../b.dtd', 'http://example.org/a/doc.xml')).toBe('http://example.org/b.dtd');
    expect(resolveURI('urn:x', 'http://example.org/')).toBe('urn:x');
  });

  it('gives an absolute system id without a base', () => {
    expect(resolveURI('http://example.org/a/../b.dtd', undefined)).toBe('http://example.org/b.dtd');
  });

  it('gives nothing when there is no system id or it cannot be made absolute', () => {
    expect(resolveURI(undefined, 'http://example.org/')).toBeUndefined();
    expect(resolveURI('b.dtd', undefined)).toBeUndefined();
    expect(resolveURI('b.dtd', 'not a base')).toBeUndefined();
  });
});

describe('escapeAndResolveURI (XML Base §3.1)', () => {
  it('escapes a reference before resolving it, so a backslash or bar stays in the path', () => {
    expect(escapeAndResolveURI(String.raw`dir\sub/`, 'http://example.com/a/')).toBe('http://example.com/a/dir%5Csub/');
    expect(escapeAndResolveURI('x|y/', 'http://example.com/a/')).toBe('http://example.com/a/x%7Cy/');
  });

  it('gives nothing when the reference cannot be made absolute', () => {
    expect(escapeAndResolveURI('b.xml', undefined)).toBeUndefined();
  });
});

describe('protocolOf', () => {
  it("gives an absolute URI's protocol in lower case", () => {
    expect([protocolOf('HTTPS://example.com/'), protocolOf('file:///a')]).toEqual(['https', 'file']);
  });
});
