import { errorOf, parseEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EntityCounter } from '@/entities/limits.ts';
import { DEFAULT_LIMITS } from '@/index.ts';

describe('limits', () => {
  it('defaults to the JDK 24 values', () => {
    expect(DEFAULT_LIMITS).toMatchObject({ attributesPerElement: 200, elementDepth: 100, nameLength: 1000 });
  });

  it('stops elements nested deeper than elementDepth', () => {
    const nested = (depth: number) => '<a>'.repeat(depth) + '</a>'.repeat(depth);
    expect(() => parseEveryWay(nested(100))).not.toThrow();
    expect(errorOf(nested(101)).code).toBe('LIMIT_ELEMENT_DEPTH');
    expect(errorOf(nested(4), { limits: { elementDepth: 3 } }).code).toBe('LIMIT_ELEMENT_DEPTH');
  });

  it('stops a start tag with more than attributesPerElement attributes', () => {
    const attributes = (count: number) => Array.from({ length: count }, (_, i) => ` a${i}="1"`).join('');
    const tag = (count: number) => `<e${attributes(count)}/>`;
    expect(() => parseEveryWay(tag(200))).not.toThrow();
    expect(errorOf(tag(201)).code).toBe('LIMIT_ATTRIBUTES');
  });

  it('stops a name longer than nameLength', () => {
    expect(errorOf(`<${'n'.repeat(1001)}/>`).code).toBe('LIMIT_NAME_LENGTH');
    expect(errorOf('<abcd/>', { limits: { nameLength: 3 } }).code).toBe('LIMIT_NAME_LENGTH');
  });
});

describe('EntityCounter', () => {
  /** A counter with some limits replaced. */
  const counterOf = (limits: Partial<typeof DEFAULT_LIMITS>) => new EntityCounter({ ...DEFAULT_LIMITS, ...limits });

  it('allows expansions up to entityExpansions and stops the next, whatever the entity', () => {
    const counter = counterOf({ entityExpansions: 3 });
    expect([
      counter.countGeneralExpansion(1),
      counter.countParameterExpansion(1, true),
      counter.countExternalExpansion(),
    ]).toEqual([undefined, undefined, undefined]);
    expect(counter.countParameterExpansion(1, false)).toEqual({
      code: 'LIMIT_ENTITY_EXPANSIONS',
      message: 'More than 3 entity expansions',
    });
  });

  it('checks one general entity against generalEntitySize and one parameter entity against parameterEntitySize', () => {
    const counter = counterOf({ generalEntitySize: 5, parameterEntitySize: 3 });
    expect([counter.countGeneralExpansion(5), counter.countParameterExpansion(3, true)]).toEqual([
      undefined,
      undefined,
    ]);
    expect(counter.countGeneralExpansion(6)).toMatchObject({ code: 'LIMIT_GENERAL_ENTITY_SIZE' });
    expect(counter.countParameterExpansion(4, false)).toEqual({
      code: 'LIMIT_PARAMETER_ENTITY_SIZE',
      message: 'An entity is longer than 3 characters',
    });
  });

  it('adds up general entities and parameter entities between declarations against totalEntitySize', () => {
    const counter = counterOf({ totalEntitySize: 10 });
    expect([counter.countGeneralExpansion(4), counter.countParameterExpansion(6, true)]).toEqual([
      undefined,
      undefined,
    ]);
    expect(counter.countGeneralExpansion(1)).toEqual({
      code: 'LIMIT_TOTAL_ENTITY_SIZE',
      message: 'Entities expand to more than 10 characters in all',
    });
  });

  it('leaves parameter entities inside declarations out of the total, as the JDK does', () => {
    const counter = counterOf({ totalEntitySize: 10 });
    expect([
      counter.countParameterExpansion(8, false),
      counter.countParameterExpansion(8, false),
      counter.countGeneralExpansion(10),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it('counts an external entity as an expansion, and an external general entity’s text as it is read', () => {
    const one = counterOf({ generalEntitySize: 6 });
    expect([one.countExternalExpansion(), one.countExternalText(4, 4), one.countExternalText(2, 6)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(one.countExternalText(1, 7)).toMatchObject({ code: 'LIMIT_GENERAL_ENTITY_SIZE' });
    const all = counterOf({ totalEntitySize: 10 });
    expect([
      all.countExternalExpansion(),
      all.countExternalText(6, 6),
      all.countExternalExpansion(),
      all.countExternalText(4, 4),
    ]).toEqual([undefined, undefined, undefined, undefined]);
    expect(all.countExternalText(1, 5)).toMatchObject({ code: 'LIMIT_TOTAL_ENTITY_SIZE' });
  });

  it('reports the expansion count before the sizes', () => {
    const counter = counterOf({ entityExpansions: 0, generalEntitySize: 0 });
    expect(counter.countGeneralExpansion(10)?.code).toBe('LIMIT_ENTITY_EXPANSIONS');
  });

  it('counts nodes produced inside entities against entityReferenceNodes', () => {
    const counter = counterOf({ entityReferenceNodes: 2 });
    expect([counter.countEntityNode(), counter.countEntityNode()]).toEqual([undefined, undefined]);
    expect(counter.countEntityNode()).toEqual({
      code: 'LIMIT_ENTITY_REPLACEMENT',
      message: 'Entities produce more than 2 nodes',
    });
  });
});
