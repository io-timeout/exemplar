import { reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import {
  XMLNS_NAMESPACE,
  XML_NAMESPACE,
  declaredPrefixes,
  reservedBindingProblem,
  namespacesInScope,
} from '@/util/namespaces.ts';

describe('the reserved namespaces (Namespaces §3)', () => {
  it('names the namespaces of the xml and xmlns prefixes', () => {
    expect([XML_NAMESPACE, XMLNS_NAMESPACE]).toEqual([
      'http://www.w3.org/XML/1998/namespace',
      'http://www.w3.org/2000/xmlns/',
    ]);
  });

  it.each([
    ['p', 'http://example.com/', undefined],
    ['', '', undefined],
    ['xml', XML_NAMESPACE, undefined],
    ['xmlns', 'http://example.com/', 'The xmlns prefix and namespace only declare other prefixes'],
    ['p', XMLNS_NAMESPACE, 'The xmlns prefix and namespace only declare other prefixes'],
    ['xml', 'http://example.com/', 'The xml prefix cannot be bound to http://example.com/'],
    ['p', XML_NAMESPACE, `${XML_NAMESPACE} needs the xml prefix`],
    ['', XML_NAMESPACE, `${XML_NAMESPACE} needs the xml prefix`],
  ])('binding %j to %j breaks: %s', (prefix, uri, problem) => {
    expect(reservedBindingProblem(prefix, uri)).toBe(problem);
  });
});

describe('namespace scopes', () => {
  const parent: ReadonlyMap<string, string> = new Map([['', 'urn:d']]);

  it("adds a start tag's declarations to its parent's scope, keeping the parent's map when it has none", () => {
    const r = reader('<a xmlns="urn:a" xmlns:p="urn:p"><b/></a>');
    r.nextTag();
    expect(declaredPrefixes(r)).toEqual(['', 'p']);
    const scope = namespacesInScope(parent, r);
    expect([...scope]).toEqual([
      ['', 'urn:a'],
      ['p', 'urn:p'],
    ]);
    expect([...parent]).toEqual([['', 'urn:d']]);
    r.nextTag();
    expect(declaredPrefixes(r)).toEqual([]);
    expect(namespacesInScope(scope, r)).toBe(scope);
  });
});
