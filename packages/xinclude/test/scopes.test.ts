import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { ScopeStack } from '@/scopes.ts';

describe('ScopeStack', () => {
  it('records the base URI, language and namespaces in scope at each open element', () => {
    const reader = new XMLInputFactory().createStreamReader(
      '<a xml:base="dir/" xml:lang="en" xmlns:p="urn:p"><b xml:base="b.xml" xmlns:q="urn:q"/></a>'
    );
    const scopes = new ScopeStack('http://example.com/doc.xml');
    reader.next();
    scopes.enter(reader);
    reader.next();
    scopes.enter(reader);
    expect(scopes.depth).toBe(2);
    const b = scopes.scopeAt(2);
    expect(b.base).toBe('http://example.com/dir/b.xml');
    expect(b.lang).toBe('en');
    expect([...b.namespaces]).toEqual(
      expect.arrayContaining([
        ['p', 'urn:p'],
        ['q', 'urn:q'],
      ])
    );
    expect(scopes.leave()).toBe(2);
    expect(scopes.scopeAt(1).base).toBe('http://example.com/dir/');
    expect(scopes.scopeAt(0)).toEqual({ base: 'http://example.com/doc.xml', lang: undefined, namespaces: new Map() });
  });

  it('starts from what was in scope above a selected element', () => {
    const scopes = new ScopeStack('file:///part.xml');
    const namespaces = new Map([['p', 'urn:p']]);
    scopes.setOrigin({ base: 'file:///main.xml', lang: 'fr', namespaces });
    expect(scopes.scopeAt(0)).toEqual({ base: 'file:///main.xml', lang: 'fr', namespaces });
  });
});
