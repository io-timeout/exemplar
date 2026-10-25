import { bytes } from '@test/helpers/lexical.ts';
import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK, NO_BYTES, concatBytes, isAscii, startsWithBytes } from '@/util/bytes.ts';

describe('byte helpers', () => {
  it('has an empty array for no bytes', () => {
    expect(NO_BYTES).toHaveLength(0);
  });

  it('joins two arrays into a new one', () => {
    const a = bytes(1, 2);
    const joined = concatBytes(a, bytes(3));
    expect([...joined]).toEqual([1, 2, 3]);
    joined[0] = 9;
    expect(a[0]).toBe(1);
  });

  it('tells whether bytes start with a prefix, which they cannot when shorter', () => {
    expect(startsWithBytes(bytes(1, 2, 3), [1, 2])).toBe(true);
    expect(startsWithBytes(bytes(1, 2, 3), [])).toBe(true);
    expect(startsWithBytes(bytes(1, 3), [1, 2])).toBe(false);
    expect(startsWithBytes(bytes(1), [1, 2])).toBe(false);
  });

  it('tells whether every byte is ASCII, at any alignment and length, wherever a high byte is', () => {
    const buffer = new Uint8Array(24).fill(0x41);
    for (let offset = 0; offset < 4; offset++) {
      for (let length = 0; length <= 20 - offset; length++) {
        const view = buffer.subarray(offset, offset + length);
        expect(isAscii(view), `offset ${offset}, length ${length}`).toBe(true);
        for (let at = 0; at < length; at++) {
          view[at] = 0x80;
          expect(isAscii(view), `offset ${offset}, length ${length}, high byte at ${at}`).toBe(false);
          view[at] = 0x41;
        }
      }
    }
  });
});

describe('BYTE_ORDER_MARK', () => {
  it('is U+FEFF as each encoding writes it', () => {
    const mark = String.fromCharCode(0xfe_ff);
    expect([...new TextEncoder().encode(mark)]).toEqual(BYTE_ORDER_MARK.UTF8);
    expect(BYTE_ORDER_MARK.UTF16BE).toEqual([0xfe, 0xff]);
    expect(BYTE_ORDER_MARK.UTF16LE).toEqual([...BYTE_ORDER_MARK.UTF16BE].toReversed());
  });
});
