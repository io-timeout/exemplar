import { describe, expect, it } from 'vitest';
import * as canonical from '@/index.ts';

describe('@exemplarjs/canonical', () => {
  it('exports canonicalize, and nothing else at run time', () => {
    expect(Object.keys(canonical)).toEqual(['canonicalize']);
  });

  it('accepts every method its type names', () => {
    const methods: canonical.CanonicalMethod[] = ['c14n', 'c14n11', 'exc-c14n', 'suite-first', 'suite-second'];
    const options: canonical.CanonicalizeOptions = { comments: false };
    for (const method of methods) expect(canonical.canonicalize('<a/>', { ...options, method })).toBe('<a></a>');
  });
});
