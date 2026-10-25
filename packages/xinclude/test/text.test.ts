import { decoderRegistry } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import type { ResolvedSource } from '@exemplarjs/xml';
import { TextInclusionError, includedText } from '@/text.ts';

const REGISTRY = decoderRegistry();

/** Bytes from a list of byte values and ASCII strings. */
function bytes(...parts: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') out.push(part);
    else for (const c of part) out.push(c.charCodeAt(0));
  }
  return new Uint8Array(out);
}

/** The text included from a source, read as XML 1.0 unless asked otherwise. */
function text(source: ResolvedSource, encoding?: string, version11 = false): string {
  return includedText(source, encoding, version11, REGISTRY);
}

/** The TextInclusionError reading a source throws. */
function failure(source: ResolvedSource, encoding?: string, version11 = false): TextInclusionError {
  try {
    text(source, encoding, version11);
  } catch (error) {
    if (error instanceof TextInclusionError) return error;
    throw error;
  }
  throw new Error('Expected a TextInclusionError');
}

describe('includedText', () => {
  it('gives text a resolver supplies as a string as it is (XInclude §4.3)', () => {
    expect(text({ text: 'a < b & c' })).toBe('a < b & c');
  });

  it('decodes bytes as UTF-8 when nothing names an encoding (XInclude §4.3)', () => {
    expect(text({ bytes: new TextEncoder().encode('café \u{1F600}') })).toBe('café \u{1F600}');
  });

  it('decodes bytes in the encoding the encoding attribute names (XInclude §4.3)', () => {
    expect(text({ bytes: bytes('caf', 0xe9) }, 'ISO-8859-1')).toBe('café');
  });

  it('prefers an encoding supplied from outside to the encoding attribute (XInclude §4.3)', () => {
    expect(text({ bytes: bytes('caf', 0xe9), encoding: 'ISO-8859-1' }, 'UTF-8')).toBe('café');
  });

  it('prefers the encoding XML rules give text that begins as XML does to the attribute (XInclude §4.3)', () => {
    const latin1 = bytes('<?xml version="1.0" encoding="ISO-8859-1"?><a>', 0xe9, '</a>');
    expect(text({ bytes: latin1 }, 'UTF-8')).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><a>é</a>');
  });

  it('reads an XML declaration without an encoding as UTF-8, whatever the attribute says', () => {
    const utf8 = new TextEncoder().encode('<?xml version="1.0"?><a>é</a>');
    expect(text({ bytes: utf8 }, 'ISO-8859-1')).toBe('<?xml version="1.0"?><a>é</a>');
  });

  it('detects UTF-16 without a BOM from how text that begins as XML is written (XML 1.0 Appendix F)', () => {
    expect(text({ bytes: bytes(0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0) }, 'ISO-8859-1')).toBe('<a/>');
    expect(text({ bytes: bytes(0, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e) })).toBe('<a/>');
  });

  it('drops a UTF-8 byte order mark', () => {
    expect(text({ bytes: bytes(0xef, 0xbb, 0xbf, 'hi') })).toBe('hi');
  });

  it.each([
    ['little-endian', bytes(0xff, 0xfe, 'h', 0, 'i', 0)],
    ['big-endian', bytes(0xfe, 0xff, 0, 'h', 0, 'i')],
  ])('reads UTF-16 after a %s BOM, and drops the BOM', (_order, data) => {
    expect(text({ bytes: data })).toBe('hi');
    expect(text({ bytes: data }, 'UTF-16')).toBe('hi');
  });

  it('reads UTF-16 named without a BOM as big-endian', () => {
    expect(text({ bytes: bytes(0, 'h', 0, 'i') }, 'UTF-16')).toBe('hi');
  });

  it('keeps a leading U+FEFF as a character when the encoding name gives the byte order', () => {
    expect(text({ bytes: bytes(0xff, 0xfe, 'h', 0) }, 'UTF-16LE')).toBe('﻿h');
    expect(text({ bytes: bytes(0xfe, 0xff, 0, 'h'), encoding: 'UTF-16BE' })).toBe('﻿h');
  });

  it('drops a leading U+FEFF from text supplied as a string', () => {
    expect(text({ text: '﻿hi' }, 'UTF-16LE')).toBe('hi');
  });

  it('reads empty bytes as empty text', () => {
    expect(text({ bytes: new Uint8Array() })).toBe('');
  });

  it('uses a decoder the factory registers', () => {
    const registry = decoderRegistry({ decoders: { 'x-upper': () => ({ decode: () => 'UPPER' }) } });
    expect(includedText({ bytes: bytes('x') }, 'x-upper', false, registry)).toBe('UPPER');
  });

  it('fails as a resource error, which a fallback may replace, for an encoding it cannot decode (XInclude §4.3)', () => {
    const error = failure({ bytes: bytes('x') }, 'x-no-such-encoding');
    expect(error.isFatal).toBe(false);
  });

  it('fails as a resource error for a source that holds neither text nor bytes', () => {
    expect(failure({ systemId: 'file:///a.txt' }).isFatal).toBe(false);
  });

  it('fails fatally on bytes illegal in the encoding (XInclude §4.3)', () => {
    expect(failure({ bytes: bytes('a', 0xff, 'b') }).isFatal).toBe(true);
  });

  it.each([
    ['a NUL', '\u0000'],
    ['a C0 control', '\u0001'],
    ['a lone surrogate', '\uD800'],
    ['U+FFFE', '￾'],
  ])('fails fatally on %s, which XML 1.0 does not allow (XInclude §4.3)', (_what, c) => {
    expect(failure({ text: `a${c}b` }).isFatal).toBe(true);
  });

  it('checks the characters of decoded bytes too (XInclude §4.3)', () => {
    expect(failure({ bytes: bytes('a', 0x01, 'b') }).isFatal).toBe(true);
  });

  it('allows the C0 and C1 controls XML 1.1 allows, when the including document is XML 1.1', () => {
    expect(text({ text: 'a\u0001\u0085b' }, undefined, true)).toBe('a\u0001\u0085b');
    expect(failure({ text: 'a\u0000b' }, undefined, true).isFatal).toBe(true);
  });

  it('allows tab, line feed and carriage return in XML 1.0', () => {
    expect(text({ text: 'a\tb\nc\rd' })).toBe('a\tb\nc\rd');
  });
});

describe('TextInclusionError', () => {
  it('is an Error named for itself that says whether it is fatal', () => {
    const error = new TextInclusionError('no', 'fatal');
    expect(error).toBeInstanceOf(Error);
    expect([error.name, error.message, error.isFatal]).toEqual(['TextInclusionError', 'no', true]);
  });
});
