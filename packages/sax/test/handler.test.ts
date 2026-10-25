import { describe, expect, expectTypeOf, it } from 'vitest';
import type { XMLError } from '@exemplarjs/xml';
import type {
  Attributes,
  ContentHandler,
  DTDHandler,
  DeclHandler,
  LexicalHandler,
  Locator,
  SAXErrorHandler,
  SAXHandler,
} from '@/handler.ts';
import { XMLFilterImpl } from '@/index.ts';

describe('the SAX handler interfaces', () => {
  it('make SAXHandler every SAX2 handler at once', () => {
    expectTypeOf<SAXHandler>().toExtend<ContentHandler>();
    expectTypeOf<SAXHandler>().toExtend<LexicalHandler>();
    expectTypeOf<SAXHandler>().toExtend<DeclHandler>();
    expectTypeOf<SAXHandler>().toExtend<DTDHandler>();
    expectTypeOf<SAXHandler>().toExtend<SAXErrorHandler>();
  });

  it('let a handler implement only the methods it needs', () => {
    expectTypeOf({}).toExtend<SAXHandler>();
    expectTypeOf({ characters: (_text: string) => {} }).toExtend<SAXHandler>();
    const handler: SAXHandler = { comment: () => {} };
    expect(Object.keys(handler)).toEqual(['comment']);
  });

  it('give Attributes both overloads of value and index', () => {
    expectTypeOf<Attributes['value']>().toBeCallableWith(0);
    expectTypeOf<Attributes['value']>().toBeCallableWith('urn:a', 'a');
    expectTypeOf<Attributes['index']>().toBeCallableWith('p:a');
    expectTypeOf<Attributes['index']>().toBeCallableWith('urn:a', 'a');
  });

  it('give the locator what Locator2 adds', () => {
    expectTypeOf<Locator['xmlVersion']>().toEqualTypeOf<string>();
    expectTypeOf<Locator['encoding']>().toEqualTypeOf<string | undefined>();
  });

  it('give error methods the XMLError', () => {
    expectTypeOf<NonNullable<SAXErrorHandler['fatalError']>>().parameter(0).toEqualTypeOf<XMLError>();
  });

  it('are implemented in full by XMLFilterImpl', () => {
    expectTypeOf<XMLFilterImpl>().toExtend<Required<SAXHandler>>();
  });
});
