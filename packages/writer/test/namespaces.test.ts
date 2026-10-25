import { describe, expect, it } from 'vitest';
import { NamespaceBindings } from '@/namespaces.ts';

describe('NamespaceBindings', () => {
  it('starts with xml and xmlns declared, and the empty prefix bound to no namespace in the output', () => {
    const bindings = new NamespaceBindings();
    expect(bindings.uriOf('xml')).toBe('http://www.w3.org/XML/1998/namespace');
    expect(bindings.declaredURIOf('xmlns')).toBe('http://www.w3.org/2000/xmlns/');
    expect([bindings.declaredURIOf(''), bindings.uriOf(''), bindings.declaredURIOf('p')]).toEqual([
      '',
      undefined,
      undefined,
    ]);
  });

  it('forgets an element’s bindings when it is left', () => {
    const bindings = new NamespaceBindings();
    bindings.enter();
    bindings.declare('p', 'urn:a');
    bindings.enter();
    bindings.declare('p', 'urn:b');
    expect(bindings.uriOf('p')).toBe('urn:b');
    bindings.leave();
    expect(bindings.uriOf('p')).toBe('urn:a');
    bindings.leave();
    expect(bindings.uriOf('p')).toBeUndefined();
  });

  it('tells bindings declared on the open tag from those declared outside it or set for look-ups only', () => {
    const bindings = new NamespaceBindings();
    bindings.enter();
    bindings.setForLookups('p', 'urn:p');
    expect([bindings.uriOf('p'), bindings.declaredURIOf('p'), bindings.declaredOnTag('p')]).toEqual([
      'urn:p',
      undefined,
      undefined,
    ]);
    bindings.declare('q', 'urn:q');
    expect(bindings.declaredOnTag('q')).toBe('urn:q');
    bindings.enter();
    expect([bindings.declaredOnTag('q'), bindings.declaredURIOf('q')]).toEqual([undefined, 'urn:q']);
  });

  it('declares nothing on a tag when no element is open', () => {
    expect(new NamespaceBindings().declaredOnTag('xml')).toBeUndefined();
  });

  it('finds the prefix of a URI that no later binding hides', () => {
    const bindings = new NamespaceBindings();
    bindings.enter();
    bindings.declare('p', 'urn:a');
    bindings.declare('q', 'urn:a');
    expect(bindings.prefixOf('urn:a')).toBe('q');
    bindings.enter();
    bindings.declare('q', 'urn:b');
    expect(bindings.prefixOf('urn:a')).toBe('p');
    expect(bindings.prefixOf('urn:none')).toBeUndefined();
  });

  it('generates nsN prefixes that nothing binds', () => {
    const bindings = new NamespaceBindings();
    bindings.setForLookups('ns1', 'urn:taken');
    expect([bindings.newPrefix(), bindings.newPrefix()]).toEqual(['ns2', 'ns3']);
  });
});
