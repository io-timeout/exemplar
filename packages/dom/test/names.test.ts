import { domException } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { DTD_TYPES, checkName, checkPrefix, checkQName, checkQualifiedName, fail, orNull } from '@/names.ts';

/** Whether the engine builds a DOMException without stack frames while the limit is 0; Firefox keeps them. */
const STACKLESS_DOM_EXCEPTIONS = ((): boolean => {
  const limit = Error.stackTraceLimit;
  if (limit === undefined) return false;
  Error.stackTraceLimit = 0;
  try {
    return !/\n\s+at |@/.test(new DOMException('probe').stack ?? '');
  } finally {
    Error.stackTraceLimit = limit;
  }
})();

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

describe('DTD_TYPES', () => {
  it('names the XML recommendation, the namespace TypeInfo gives DTD types (DOM Level 3 TypeInfo)', () => {
    expect(DTD_TYPES).toBe('http://www.w3.org/TR/REC-xml');
  });
});

describe('fail', () => {
  it('throws a DOMException of the name given', () => {
    expect(() => fail('NotFoundError', 'gone')).toThrow(domException('NotFoundError'));
    expect(() => fail('NotFoundError', 'gone')).toThrow(DOMException);
  });

  it.runIf(STACKLESS_DOM_EXCEPTIONS)('throws it without stack frames', () => {
    let thrown: unknown;
    try {
      fail('NotFoundError', 'gone');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as DOMException).stack ?? '').not.toMatch(/\n\s+at |@/);
  });
});

describe('checkName', () => {
  it.each(['a', '_a', ':a', 'a:b:c', 'a-b.c', '\u00E9', '\u{10000}', 'a\u00B7b'])(
    'accepts the XML name %j (§2.3 [5])',
    (name) => {
      expect(() => checkName(name)).not.toThrow();
    }
  );

  it.each(['', '1a', '-a', '.a', 'a b', 'a>', '\u00D7'])('rejects %j with INVALID_CHARACTER_ERR (§2.3 [5])', (name) => {
    expect(() => checkName(name)).toThrow(domException('InvalidCharacterError'));
  });
});

describe('checkQName', () => {
  it.each(['a', 'p:a', 'xmlns', 'xml:lang'])('accepts the qualified name %j (Namespaces [7])', (name) => {
    expect(() => checkQName(name)).not.toThrow();
  });

  it.each([':a', 'a:', 'a:b:c', '::'])(
    'rejects the misplaced colons of %j with NAMESPACE_ERR (Namespaces [7])',
    (name) => {
      expect(() => checkQName(name)).toThrow(domException('NamespaceError'));
    }
  );

  it.each(['a:1b', 'a:-b', 'a:.b', 'a:\u00B7b', 'a:\u0300b'])(
    'rejects %j, an XML name whose local part is not an NCName, with NAMESPACE_ERR (Namespaces [7])',
    (name) => {
      expect(() => checkQName(name)).toThrow(domException('NamespaceError'));
    }
  );

  it('checks the colons before the characters, as Xerces does', () => {
    expect(() => checkQName('1:a:b')).toThrow(domException('NamespaceError'));
    expect(() => checkQName('1a:b')).toThrow(domException('InvalidCharacterError'));
  });
});

describe('orNull', () => {
  it('reads the empty string as no namespace or prefix (DOM Level 3 §1.3.3)', () => {
    expect(orNull('')).toBeNull();
    expect(orNull(null)).toBeNull();
    expect(orNull('urn:a')).toBe('urn:a');
  });
});

describe('checkQualifiedName', () => {
  it('splits a prefixed name into prefix and local name', () => {
    expect(checkQualifiedName('urn:a', 'p:local')).toEqual(['p', 'local']);
  });

  it('gives no prefix to an unprefixed name', () => {
    expect(checkQualifiedName(null, 'local')).toEqual([null, 'local']);
  });

  it('checks the name, then the prefix against the namespace', () => {
    expect(() => checkQualifiedName('urn:a', 'p:')).toThrow(domException('NamespaceError'));
    expect(() => checkQualifiedName(null, 'p:a')).toThrow(domException('NamespaceError'));
    expect(() => checkQualifiedName('urn:a', 'p:1a')).toThrow(domException('NamespaceError'));
  });
});

describe('checkPrefix', () => {
  it.each([
    ['urn:a', 'p', 'p:a'],
    [null, null, 'a'],
    ['urn:a', null, 'a'],
    [XML, 'xml', 'xml:a'],
    [XMLNS, 'xmlns', 'xmlns:a'],
    [XMLNS, null, 'xmlns'],
  ])('accepts the namespace %j with the prefix %j', (uri, prefix, name) => {
    expect(() => checkPrefix(uri, prefix, name)).not.toThrow();
  });

  it.each([
    ['a prefix with no namespace', null, 'p', 'p:a'],
    ['a prefix with the empty namespace', '', 'p', 'p:a'],
    ['xml with another namespace', 'urn:a', 'xml', 'xml:a'],
    ['xmlns with another namespace', 'urn:a', 'xmlns', 'xmlns:a'],
    ['the name xmlns with another namespace', 'urn:a', null, 'xmlns'],
    ['the XMLNS namespace with another prefix', XMLNS, 'p', 'p:a'],
    ['the XMLNS namespace with no prefix', XMLNS, null, 'a'],
  ])('rejects %s with NAMESPACE_ERR (DOM Level 3 createElementNS)', (_case, uri, prefix, name) => {
    expect(() => checkPrefix(uri, prefix, name)).toThrow(domException('NamespaceError'));
  });
});
