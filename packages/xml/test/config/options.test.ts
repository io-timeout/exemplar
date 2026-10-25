import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, resolveOptions } from '@/config/options.ts';
import type { Validator } from '@/cursor/validation.ts';
import type { EntityResolver } from '@/index.ts';

describe('DEFAULT_LIMITS (the JDK 24 jdk.xml.* defaults)', () => {
  it('has the documented value for every limit', () => {
    expect(DEFAULT_LIMITS).toEqual({
      entityExpansions: 2500,
      totalEntitySize: 100_000,
      generalEntitySize: 100_000,
      parameterEntitySize: 15_000,
      entityReferenceNodes: 100_000,
      attributesPerElement: 200,
      elementDepth: 100,
      nameLength: 1000,
    });
  });
});

describe('resolveOptions', () => {
  it('fills in every default as the design documents them', () => {
    const resolved = resolveOptions({});
    expect(resolved).toEqual({
      validator: undefined,
      xinclude: undefined,
      namespaceAware: true,
      namespacePrefixes: false,
      checkWellFormedness: true,
      checkNormalization: false,
      disallowDoctype: false,
      reportPrologWhitespace: false,
      coalescing: false,
      reportEntityBoundaries: false,
      copyStrings: false,
      replaceEntityReferences: true,
      supportExternalEntities: true,
      accessExternalDTD: [],
      accessExternalEntities: [],
      entityResolver: undefined,
      uriResolver: undefined,
      catalog: undefined,
      entities: new Map(),
      errorHandler: {},
      decoders: {},
      limits: DEFAULT_LIMITS,
    });
  });

  it.each([
    ['namespaceAware', false],
    ['namespacePrefixes', true],
    ['checkWellFormedness', false],
    ['checkNormalization', true],
    ['disallowDoctype', true],
    ['reportPrologWhitespace', true],
    ['coalescing', true],
    ['reportEntityBoundaries', true],
    ['copyStrings', true],
    ['replaceEntityReferences', false],
    ['supportExternalEntities', false],
  ] as const)('keeps %s when it is given', (name, value) => {
    expect(resolveOptions({ [name]: value })[name]).toBe(value);
  });

  it('keeps the access lists, resolvers, handler and decoders it is given', () => {
    const entityResolver: EntityResolver = { resolveEntity: () => undefined };
    const uriResolver = { resolve: () => undefined };
    const validator: Validator = { create: () => ({}) as never };
    const errorHandler = { error: () => undefined };
    const decoders = { 'x-test': () => new TextDecoder() };
    const resolved = resolveOptions({
      accessExternalDTD: 'all',
      accessExternalEntities: ['file'],
      entityResolver,
      uriResolver,
      validator,
      errorHandler,
      decoders,
    });
    expect(resolved).toMatchObject({
      accessExternalDTD: 'all',
      accessExternalEntities: ['file'],
      entityResolver,
      uriResolver,
      validator,
      errorHandler,
      decoders,
    });
  });

  it('turns the entities known in advance into a map', () => {
    expect(resolveOptions({ entities: { nbsp: '\u00A0', copy: '©' } }).entities).toEqual(
      new Map([
        ['nbsp', '\u00A0'],
        ['copy', '©'],
      ])
    );
  });

  it('merges the limits given over the defaults', () => {
    expect(resolveOptions({ limits: { elementDepth: 5 } }).limits).toEqual({
      ...DEFAULT_LIMITS,
      elementDepth: 5,
    });
  });
});
