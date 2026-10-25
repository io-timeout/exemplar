import { expect, it } from 'vitest';
import * as resolvers from '@/resolvers/index.ts';

it('exports the fetch resolver, which works in every runtime, and no file resolver', () => {
  expect(Object.keys(resolvers)).toEqual(['fetchResolver']);
});
