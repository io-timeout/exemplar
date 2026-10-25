import { describe, expect, it } from 'vitest';
import * as sax from '@/index.ts';

describe('@exemplarjs/sax', () => {
  it('exports the parser and the filter base class, and nothing else at run time', () => {
    expect(Object.keys(sax).toSorted()).toEqual(['SAXParser', 'XMLFilterImpl']);
    expect(new sax.SAXParser()).toBeInstanceOf(sax.SAXParser);
    expect(new sax.XMLFilterImpl().handler).toEqual({});
  });
});
