import { describe, expect, it } from 'vitest';
import {
  ADD_FILTER,
  CREATE_READER,
  DTD_COMPLETE,
  DTD_ITEMS,
  EVENT_OFFSET,
  EVENT_POSITION,
  INCLUDED_DECLARATIONS,
  INPUT_ENCODING,
  LISTEN_ENTITIES,
  XML_ENCODING,
  copyString,
  isIndex,
  outOfRange,
} from '@/cursor/internal.ts';

describe('copyString', () => {
  it('returns a short string as it is, since V8 copies short slices itself', () => {
    expect(copyString('')).toBe('');
    expect(copyString('twelve chars')).toBe('twelve chars');
  });

  it('returns an equal string for 13 characters or more', () => {
    const long = 'x'.repeat(13);
    expect(copyString(long)).toBe(long);
    const sliced = `${'a'.repeat(100)}${'b'.repeat(100)}`.slice(50, 150);
    expect(copyString(sliced)).toBe(sliced);
  });
});

describe('indexes', () => {
  it('takes an integer from 0 that fits in 32 bits as an index', () => {
    expect([0, 1, 2 ** 32 - 1].map((n) => isIndex(n))).toEqual([true, true, true]);
    expect([-1, 0.5, 2 ** 32, Number.NaN].map((n) => isIndex(n))).toEqual([false, false, false, false]);
  });

  it('throws a RangeError naming what the index is out of range for', () => {
    expect(() => outOfRange('Attribute', 3)).toThrow(
      new RangeError('Attribute index 3 is out of range for the current event')
    );
  });
});

describe('the cursor hooks', () => {
  it('are distinct symbols', () => {
    const hooks = [
      ADD_FILTER,
      CREATE_READER,
      DTD_COMPLETE,
      DTD_ITEMS,
      EVENT_OFFSET,
      EVENT_POSITION,
      INCLUDED_DECLARATIONS,
      INPUT_ENCODING,
      LISTEN_ENTITIES,
      XML_ENCODING,
    ];
    for (const hook of hooks) expect(typeof hook).toBe('symbol');
    expect(new Set(hooks).size).toBe(hooks.length);
  });
});
