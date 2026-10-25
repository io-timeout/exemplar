import { describe, expect, it } from 'vitest';
import { ResolutionError, accessAllows, orElse } from '@/resolvers/resolver.ts';

describe('ResolutionError', () => {
  it('carries an error code for the reader to fail with', () => {
    const error = new ResolutionError('RESOLVER_FAILED', 'refused');
    expect(error).toBeInstanceOf(Error);
    expect([error.name, error.code, error.message]).toEqual(['ResolutionError', 'RESOLVER_FAILED', 'refused']);
  });
});

describe('orElse', () => {
  it('gives the first answer, or asks the next resolver when there is none', () => {
    const answer = { text: 'first' };
    expect(orElse(answer, () => ({ text: 'second' }))).toBe(answer);
    expect(orElse(undefined, () => ({ text: 'second' }))).toEqual({ text: 'second' });
  });

  it('waits for a promise before deciding', async () => {
    await expect(orElse(Promise.resolve({ text: 'first' }), () => ({ text: 'second' }))).resolves.toEqual({
      text: 'first',
    });
    await expect(orElse(Promise.resolve(undefined), () => ({ text: 'second' }))).resolves.toEqual({ text: 'second' });
    await expect(orElse(Promise.resolve(undefined), () => Promise.resolve(undefined))).resolves.toBeUndefined();
  });

  it('does not ask the next resolver when the first answers', () => {
    let asked = false;
    void orElse({ text: 'x' }, () => {
      asked = true;
      return undefined;
    });
    expect(asked).toBe(false);
  });
});

describe('allows (JAXP accessExternalDTD and accessExternalEntities)', () => {
  it('allows every URI, even one that is not absolute, under all', () => {
    expect([accessAllows('all', 'http://x/'), accessAllows('all', undefined)]).toEqual([true, true]);
  });

  it('allows a protocol on the list, whatever its case', () => {
    expect(accessAllows(['http', 'file'], 'HTTP://example.org/')).toBe(true);
    expect(accessAllows(['file'], 'file:///a.dtd')).toBe(true);
    expect(accessAllows(['file'], 'https://example.org/')).toBe(false);
  });

  it('allows nothing under the empty list, or for a URI that is not absolute', () => {
    expect(accessAllows([], 'file:///a.dtd')).toBe(false);
    expect(accessAllows(['file'], undefined)).toBe(false);
  });
});
