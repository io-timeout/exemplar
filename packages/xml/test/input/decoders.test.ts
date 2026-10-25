import { bytes, framed, utf8, verdict } from '@test/helpers/lexical.ts';
import { describe, expect, it } from 'vitest';
import { SINGLE_BYTE_TABLES } from '@/encodings/tables.ts';
import { ALIASES } from '@/input/aliases.ts';
import type { Decoder } from '@/input/decoders.ts';
import { DecoderRegistry, canonicalEncoding } from '@/input/decoders.ts';

/** A decoder that reads every byte as the code point of the same value. */
const latin = (): Decoder => ({ decode: (data?: Uint8Array) => (data ? String.fromCharCode(...data) : '') });

describe('encoding names (§4.3.3)', () => {
  it('maps registered names and aliases case-insensitively to one canonical name', () => {
    expect(canonicalEncoding('UTF-8')).toBe('utf-8');
    expect(canonicalEncoding('Latin1')).toBe('iso-8859-1');
    expect(canonicalEncoding('csUnicode')).toBe('utf-16');
    expect(canonicalEncoding('ISO-10646-UCS-2')).toBe('utf-16');
    expect(canonicalEncoding('Shift_JIS')).toBe('shift_jis');
  });

  it('lower-cases a name it has no alias for', () => {
    expect(canonicalEncoding('X-Custom')).toBe('x-custom');
  });

  it('maps IBM01140 to IBM01149 and their aliases to the euro EBCDIC tables', () => {
    expect(canonicalEncoding('IBM01140')).toBe('ibm1140');
    expect(canonicalEncoding('CCSID01141')).toBe('ibm1141');
    expect(canonicalEncoding('CP01149')).toBe('ibm1149');
    expect(canonicalEncoding('ebcdic-us-37+euro')).toBe('ibm1140');
    expect(canonicalEncoding('IBM1140')).toBe('ibm1140');
  });

  it('maps every registered name to a built-in decoder, or to one that needs a byte order or the CJK decoders', () => {
    const registry = new DecoderRegistry();
    const cjk = ['shift_jis', 'windows-31j', 'euc-jp', 'iso-2022-jp', 'big5', 'big5-hkscs', 'gb2312', 'gbk', 'euc-kr'];
    const elsewhere = new Set(['utf-16', 'utf-32', ...cjk]);
    const missing = Object.entries(ALIASES).filter(([, name]) => !elsewhere.has(name) && !registry.get(name));
    expect(missing).toEqual([]);
  });
});

describe('the decoder registry', () => {
  it.each(['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'utf-32be', 'utf-32le', 'x-ucs-4-2143', 'x-ucs-4-3412'])(
    'has a built-in decoder for %s',
    (name) => {
      expect(new DecoderRegistry().get(name)).toBeTypeOf('function');
    }
  );

  it('has a built-in decoder for every single-byte table', () => {
    const registry = new DecoderRegistry();
    for (const name of Object.keys(SINGLE_BYTE_TABLES)) expect(registry.get(name), name).toBeTypeOf('function');
  });

  it('has none for UTF-16 and UTF-32 without a byte order, nor for the CJK encodings or unknown names', () => {
    const registry = new DecoderRegistry();
    for (const name of ['utf-16', 'utf-32', 'shift_jis', 'euc-kr', 'big5', 'x-unknown', 'UTF-8']) {
      expect(registry.get(name), name).toBeUndefined();
    }
  });

  it('makes a fresh decoder for each document', () => {
    const factory = new DecoderRegistry().get('utf-32be') ?? expect.unreachable();
    expect(factory()).not.toBe(factory());
  });

  it('decodes UTF-8 fatally, leaving a byte-order mark for exemplar to strip', () => {
    const decoder = new DecoderRegistry().get('utf-8')?.() ?? expect.unreachable();
    expect(decoder.decode(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('\uFEFFA');
    expect(() => decoder.decode(bytes(0xff))).toThrow(TypeError);
  });

  it('decodes GB18030 with the native decoder', () => {
    const decoder = new DecoderRegistry().get('gb18030')?.() ?? expect.unreachable();
    expect(decoder.decode(bytes(0xd6, 0xd0, 0x81, 0x30, 0x81, 0x30))).toBe('中\u0080');
  });

  it('registers extra decoders under the canonical name of the name given', () => {
    const registry = new DecoderRegistry({ Latin1: latin, 'X-Custom': latin });
    expect(registry.get('iso-8859-1')).toBe(latin);
    expect(registry.get('x-custom')).toBe(latin);
    expect(registry.get('Latin1')).toBeUndefined();
  });

  it('lets a registered decoder replace a built-in one', () => {
    expect(new DecoderRegistry({ 'utf-8': latin }).get('utf-8')).toBe(latin);
    expect(new DecoderRegistry().get('utf-8')).not.toBe(latin);
  });

  it('decodes a document with the decoder registered for the encoding it declares', () => {
    const doc = framed('<?xml version="1.0" encoding="X-Latin"?><a>', [0xe9, 0x80], '</a>');
    expect(verdict(doc, { decoders: { 'x-latin': latin } })).toBe('accepted <a>é\u0080</a>');
    expect(verdict(doc)).toBe('ENCODING_UNSUPPORTED 1:1');
  });

  it('leaves the CJK encodings to the decoders @exemplarjs/encodings-cjk registers', () => {
    expect(verdict(utf8('<?xml version="1.0" encoding="Shift_JIS"?><a/>'))).toBe('ENCODING_UNSUPPORTED 1:1');
  });
});
