import { describe, expect, it } from 'vitest';
import { grown } from '@/util/arrays.ts';

describe('grown', () => {
  it('at least doubles an array, keeping its elements and its kind', () => {
    const bigger = grown(Int32Array.of(1, 2, 3), 0);
    expect(bigger).toBeInstanceOf(Int32Array);
    expect([...bigger]).toEqual([1, 2, 3, 0, 0, 0]);
  });

  it('makes room for the length asked for when doubling is not enough', () => {
    expect(grown(new Int32Array(0), 16)).toHaveLength(16);
    expect(grown(Uint8Array.of(1, 2), 9)).toHaveLength(9);
  });

  it('copies only the elements in use', () => {
    const bigger = grown(Uint8Array.of(7, 8, 9, 9), 8, 2);
    expect(bigger).toBeInstanceOf(Uint8Array);
    expect([...bigger]).toEqual([7, 8, 0, 0, 0, 0, 0, 0]);
  });
});
