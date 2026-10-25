import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { cjkDecoders } from '@/index.ts';

// Tables generated without GBK's entry.
vi.mock('@/tables.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/tables.ts')>();
  const { gbk: _gbk, ...rest } = original.CHARSETS;
  return { ...original, CHARSETS: rest };
});

describe('a charset missing from the generated tables', () => {
  it('fails when its decoder is created', () => {
    expect(() => (cjkDecoders['gbk'] as () => unknown)()).toThrow(/No table for gbk/);
  });

  it('makes the reader report the encoding as unsupported', () => {
    const factory = new XMLInputFactory({ decoders: cjkDecoders });
    const data = new TextEncoder().encode('<?xml version="1.0" encoding="GBK"?><a/>');
    expect(() => factory.createStreamReader(data)).toThrow(XMLError);
    expect(() => factory.createStreamReader(data)).toThrow(
      expect.objectContaining({ code: ErrorCode.ENCODING_UNSUPPORTED })
    );
  });
});
