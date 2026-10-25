import { describe, expect, it } from 'vitest';
import { ContextNode } from '@/context-node.ts';
import { NamespaceBindings } from '@/namespaces.ts';

describe('ContextNode', () => {
  it('finds an attribute written twice by its expanded name, until the next tag opens', () => {
    const node = new ContextNode();
    node.open('', undefined);
    expect([
      node.repeatsAttribute('', 'a'),
      node.repeatsAttribute('urn:p', 'a'),
      node.repeatsAttribute('', 'a'),
    ]).toEqual([false, false, true]);
    node.open('', undefined);
    expect(node.repeatsAttribute('', 'a')).toBe(false);
  });

  it('reports the first prefix the output does not bind to its URI: the element’s, then its attributes’', () => {
    const bindings = new NamespaceBindings();
    bindings.enter();
    const node = new ContextNode();
    node.open('p', 'urn:p');
    node.notePrefixedAttribute('q', 'urn:q');
    expect(node.unboundPrefixProblem(bindings)).toBe('The prefix p is not bound to urn:p');
    bindings.declare('p', 'urn:p');
    expect(node.unboundPrefixProblem(bindings)).toBe('The prefix q is not bound to urn:q');
    bindings.declare('q', 'urn:q');
    expect(node.unboundPrefixProblem(bindings)).toBeUndefined();
  });

  it('checks the default namespace, but not an element named without a URI, nor an xml: attribute', () => {
    const bindings = new NamespaceBindings();
    bindings.enter();
    const node = new ContextNode();
    node.open('', 'urn:d');
    expect(node.unboundPrefixProblem(bindings)).toBe('The default namespace is not bound to urn:d');
    bindings.declare('', 'urn:d');
    node.open('', '');
    expect(node.unboundPrefixProblem(bindings)).toBe('The default namespace is not bound to no namespace');
    node.open('', undefined);
    node.notePrefixedAttribute('xml', 'http://www.w3.org/XML/1998/namespace');
    expect(node.unboundPrefixProblem(bindings)).toBeUndefined();
  });
});
