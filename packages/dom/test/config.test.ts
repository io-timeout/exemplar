import { domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { DOMConfiguration, DOMError, DOMLocator, DOMStringList } from '@/config.ts';

const BOOLEANS = [
  'canonical-form',
  'cdata-sections',
  'check-character-normalization',
  'comments',
  'datatype-normalization',
  'element-content-whitespace',
  'entities',
  'infoset',
  'namespaces',
  'namespace-declarations',
  'normalize-characters',
  'split-cdata-sections',
  'validate',
  'validate-if-schema',
  'well-formed',
];

describe('DOMStringList', () => {
  it('gives its length, its items by index and null past the end (DOM Level 3 DOMStringList)', () => {
    const list = new DOMStringList(['a', 'b']);
    expect(list).toHaveLength(2);
    expect([list.item(0), list.item(1), list.item(2), list.item(-1)]).toEqual(['a', 'b', null, null]);
  });

  it('says whether it contains a string', () => {
    const list = new DOMStringList(['a']);
    expect([list.contains('a'), list.contains('b')]).toEqual([true, false]);
  });
});

describe('DOMLocator', () => {
  it('knows only the related node, as a tree has no positions (DOM Level 3 DOMLocator)', () => {
    const node = newDocument();
    const locator = new DOMLocator(node);
    expect(locator.relatedNode).toBe(node);
    expect([locator.lineNumber, locator.columnNumber, locator.byteOffset, locator.utf16Offset]).toEqual([
      -1, -1, -1, -1,
    ]);
    expect(locator.uri).toBeNull();
  });
});

describe('DOMError', () => {
  it('numbers its severities as DOM Level 3 does', () => {
    expect([DOMError.SEVERITY_WARNING, DOMError.SEVERITY_ERROR, DOMError.SEVERITY_FATAL_ERROR]).toEqual([1, 2, 3]);
  });

  it('carries its severity, type, message and node, located at the node', () => {
    const node = newDocument();
    const error = new DOMError(DOMError.SEVERITY_ERROR, 'kind', 'what', node);
    expect([error.severity, error.type, error.message, error.relatedData]).toEqual([2, 'kind', 'what', node]);
    expect(error.relatedException).toBeNull();
    expect(error.location.relatedNode).toBe(node);
  });
});

describe('DOMConfiguration.parameterNames', () => {
  it('lists every parameter DOM Level 3 defines for normalizeDocument', () => {
    const names = new DOMConfiguration().parameterNames;
    expect(names).toHaveLength(18);
    for (const name of [...BOOLEANS, 'error-handler', 'schema-location', 'schema-type']) {
      expect(names.contains(name), name).toBe(true);
    }
  });
});

describe('DOMConfiguration.getParameter', () => {
  it.each([
    ['canonical-form', false],
    ['cdata-sections', true],
    ['check-character-normalization', false],
    ['comments', true],
    ['datatype-normalization', false],
    ['element-content-whitespace', true],
    ['entities', true],
    ['namespaces', true],
    ['namespace-declarations', true],
    ['normalize-characters', false],
    ['split-cdata-sections', true],
    ['validate', false],
    ['validate-if-schema', false],
    ['well-formed', true],
    ['schema-location', null],
    ['schema-type', null],
  ])('defaults %s to %j (DOM Level 3 §1.4)', (name, value) => {
    expect(new DOMConfiguration().getParameter(name)).toBe(value);
  });

  it('defaults the error handler to one that lets normalizing go on', () => {
    const handler = new DOMConfiguration().getParameter('error-handler') as { handleError(e: DOMError): boolean };
    expect(handler.handleError(new DOMError(2, 't', 'm', null))).toBe(true);
  });

  it('reads infoset as false by default, as entities and cdata-sections are on', () => {
    expect(new DOMConfiguration().getParameter('infoset')).toBe(false);
  });

  it('ignores the case of names (DOM Level 3 DOMConfiguration)', () => {
    expect(new DOMConfiguration().getParameter('COMMENTS')).toBe(true);
  });

  it('raises NOT_FOUND_ERR for an unknown parameter', () => {
    expect(() => new DOMConfiguration().getParameter('no-such')).toThrow(domException('NotFoundError'));
  });
});

describe('DOMConfiguration.canSetParameter', () => {
  it.each([
    ['cdata-sections', true],
    ['cdata-sections', false],
    ['check-character-normalization', true],
    ['normalize-characters', true],
    ['well-formed', false],
    ['canonical-form', false],
    ['validate', false],
    ['infoset', true],
  ])('can set %s to %j', (name, value) => {
    expect(new DOMConfiguration().canSetParameter(name, value)).toBe(true);
  });

  it.each([
    ['canonical-form', true],
    ['datatype-normalization', true],
    ['validate', true],
    ['validate-if-schema', true],
    ['comments', 'yes'],
  ])('cannot set %s to %j', (name, value) => {
    expect(new DOMConfiguration().canSetParameter(name, value)).toBe(false);
  });

  it('cannot set a parameter that does not exist', () => {
    expect(new DOMConfiguration().canSetParameter('no-such', true)).toBe(false);
  });

  it('can set any parameter to null', () => {
    for (const name of [...BOOLEANS, 'error-handler', 'schema-location', 'schema-type']) {
      expect(new DOMConfiguration().canSetParameter(name, null), name).toBe(true);
    }
  });

  it('takes a function or an object with handleError as the error handler (ECMAScript binding)', () => {
    const config = new DOMConfiguration();
    expect(config.canSetParameter('error-handler', () => true)).toBe(true);
    expect(config.canSetParameter('error-handler', { handleError: () => true })).toBe(true);
    expect(config.canSetParameter('error-handler', {})).toBe(false);
    expect(config.canSetParameter('error-handler', 'handler')).toBe(false);
  });

  it('takes any string as schema-location, and only the DTD type as schema-type', () => {
    const config = new DOMConfiguration();
    expect(config.canSetParameter('schema-location', 'a.xsd')).toBe(true);
    expect(config.canSetParameter('schema-location', 1)).toBe(false);
    expect(config.canSetParameter('schema-type', 'http://www.w3.org/TR/REC-xml')).toBe(true);
    expect(config.canSetParameter('schema-type', 'http://www.w3.org/2001/XMLSchema')).toBe(false);
  });

  it('ignores the case of names', () => {
    expect(new DOMConfiguration().canSetParameter('Comments', false)).toBe(true);
  });
});

describe('DOMConfiguration.setParameter', () => {
  it('sets a boolean parameter', () => {
    const config = new DOMConfiguration();
    config.setParameter('comments', false);
    expect(config.getParameter('comments')).toBe(false);
  });

  it('resets a boolean parameter to its default when set to null', () => {
    const config = new DOMConfiguration();
    config.setParameter('comments', false);
    config.setParameter('comments', null);
    expect(config.getParameter('comments')).toBe(true);
  });

  it('ignores the case of names', () => {
    const config = new DOMConfiguration();
    config.setParameter('ELEMENT-Content-Whitespace', false);
    expect(config.getParameter('element-content-whitespace')).toBe(false);
  });

  it('sets the parameters infoset names when infoset is set to true (DOM Level 3 §1.4 infoset)', () => {
    const config = new DOMConfiguration();
    config.setParameter('comments', false);
    config.setParameter('infoset', true);
    expect(config.getParameter('infoset')).toBe(true);
    expect([
      config.getParameter('entities'),
      config.getParameter('cdata-sections'),
      config.getParameter('comments'),
      config.getParameter('namespaces'),
      config.getParameter('well-formed'),
    ]).toEqual([false, false, true, true, true]);
  });

  it('reads infoset as false once a parameter it names changes', () => {
    const config = new DOMConfiguration();
    config.setParameter('infoset', true);
    config.setParameter('comments', false);
    expect(config.getParameter('infoset')).toBe(false);
  });

  it('changes nothing when infoset is set to false (DOM Level 3 §1.4 infoset)', () => {
    const config = new DOMConfiguration();
    config.setParameter('infoset', false);
    expect([config.getParameter('entities'), config.getParameter('cdata-sections')]).toEqual([true, true]);
  });

  it('keeps canonical-form off when a parameter it names changes', () => {
    const config = new DOMConfiguration();
    config.setParameter('entities', false);
    config.setParameter('entities', true);
    expect(config.getParameter('canonical-form')).toBe(false);
  });

  it('sets and reads back the error handler, schema-location and schema-type', () => {
    const config = new DOMConfiguration();
    const handler = (): boolean => true;
    config.setParameter('error-handler', handler);
    config.setParameter('schema-location', 'a.xsd');
    config.setParameter('schema-type', 'http://www.w3.org/TR/REC-xml');
    expect(config.getParameter('error-handler')).toBe(handler);
    expect(config.getParameter('schema-location')).toBe('a.xsd');
    expect(config.getParameter('schema-type')).toBe('http://www.w3.org/TR/REC-xml');
    config.setParameter('error-handler', null);
    expect(config.getParameter('error-handler')).toBeNull();
  });

  it('raises NOT_FOUND_ERR for an unknown parameter', () => {
    expect(() => new DOMConfiguration().setParameter('no-such', true)).toThrow(domException('NotFoundError'));
  });

  it('raises TYPE_MISMATCH_ERR for a boolean parameter given another type', () => {
    expect(() => new DOMConfiguration().setParameter('comments', 'no')).toThrow(domException('TypeMismatchError'));
  });

  it('raises TYPE_MISMATCH_ERR for an error handler that is not one', () => {
    expect(() => new DOMConfiguration().setParameter('error-handler', {})).toThrow(domException('TypeMismatchError'));
  });

  it.each<[string, unknown]>([
    ...BOOLEANS.map((name): [string, unknown] => [name, 1]),
    ['error-handler', 'handler'],
    ['schema-location', 1],
    ['schema-location', true],
    ['schema-type', 1],
    ['schema-type', { toString: () => 'http://www.w3.org/TR/REC-xml' }],
  ])(
    'raises TYPE_MISMATCH_ERR for %s given %j, a value of the wrong type (DOM Level 3 DOMConfiguration)',
    (name, value) => {
      const config = new DOMConfiguration();
      expect(() => config.setParameter(name, value)).toThrow(domException('TypeMismatchError'));
      expect(config.canSetParameter(name, value)).toBe(false);
    }
  );

  it.each([
    ['canonical-form', true],
    ['datatype-normalization', true],
    ['validate', true],
    ['validate-if-schema', true],
    ['schema-type', 'http://www.w3.org/2001/XMLSchema'],
  ])('raises NOT_SUPPORTED_ERR for %s set to %j', (name, value) => {
    expect(() => new DOMConfiguration().setParameter(name, value)).toThrow(domException('NotSupportedError'));
  });
});

describe('DOMConfiguration internals', () => {
  it('reads a boolean parameter with _is', () => {
    const config = new DOMConfiguration();
    expect([config._is('comments'), config._is('validate'), config._is('schema-type')]).toEqual([true, false, false]);
  });

  it('gives the error handler with _handler', () => {
    const config = new DOMConfiguration();
    const handler = { handleError: () => false };
    config.setParameter('error-handler', handler);
    expect(config._handler()).toBe(handler);
  });
});
