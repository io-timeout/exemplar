import { bytes, decodeChunks, hex, splits } from '@test/helpers/bytes.ts';
import { leadMask, packOverrides, unitsBase64 } from '@test/helpers/tables.ts';
import { describe, expect, it } from 'vitest';
import type { Decoder } from '@exemplarjs/xml';
import { DecodeError } from '@exemplarjs/xml/internal';
import {
  DoubleByteDecoder,
  EucJpDecoder,
  Iso2022JpDecoder,
  PairTable,
  ShiftJisDecoder,
  unitsFromBase64,
} from '@/decoders.ts';
import { CHARSETS, JIS0208, JIS0212 } from '@/tables.ts';

/** The DecodeError a decoder throws on bytes, decoded whole. */
function failure(decoder: Decoder, input: Uint8Array): DecodeError {
  try {
    decoder.decode(input);
  } catch (error) {
    if (error instanceof DecodeError) return error;
    throw error;
  }
  throw new Error('The bytes decoded');
}

/** The lead-byte mask of a generated charset. */
function leadsOf(name: string): string {
  return (CHARSETS[name] as { leads: string }).leads;
}

const jis0208 = new PairTable(0xa1, [0xa1, 0xfe], unitsFromBase64(JIS0208));
const jis0212 = new PairTable(0xa1, [0xa1, 0xfe], unitsFromBase64(JIS0212));

describe('units', () => {
  it('reads base64 as 16-bit units, little-endian', () => {
    expect([...unitsFromBase64('QjAATg==')]).toEqual([0x30_42, 0x4e_00]);
    expect([...unitsFromBase64(unitsBase64([0xff_ff, 0x00_01]))]).toEqual([0xff_ff, 0x00_01]);
  });

  it('reads an empty table', () => {
    expect(unitsFromBase64('')).toHaveLength(0);
  });
});

describe('PairTable', () => {
  // Leads 0x81–0x82; trail columns 0x40, 0x41 and, after a gap, 0x80.
  const table = new PairTable(
    0x81,
    [0x40, 0x41, 0x80, 0x80],
    Uint16Array.of(0x4e_00, 0x4e_01, 0x4e_02, 0x4e_03, 0x4e_04, 0xff_ff)
  );

  it('finds a cell by its row from the first lead and its column across the trail ranges', () => {
    expect(table.get(0x81, 0x40)).toBe(0x4e_00);
    expect(table.get(0x81, 0x80)).toBe(0x4e_02);
    expect(table.get(0x82, 0x41)).toBe(0x4e_04);
  });

  it.each([
    ['a cell the table leaves undefined', 0x82, 0x80],
    ['a lead below the first', 0x80, 0x40],
    ['a lead above 0xFE', 0xff, 0x40],
    ['a trail in no range', 0x81, 0x42],
    ['a trail in the gap between ranges', 0x81, 0x7f],
    ['a row past the end of the data', 0x83, 0x40],
  ])('gives U+FFFF for %s', (_, lead, trail) => {
    expect(table.get(lead, trail)).toBe(0xff_ff);
  });
});

describe('DoubleByteDecoder', () => {
  const table = new PairTable(
    0x81,
    [0x40, 0x41, 0x80, 0x80],
    Uint16Array.of(0x4e_00, 0x4e_01, 0x4e_02, 0x4e_03, 0x4e_04, 0xff_ff)
  );
  const leads = leadMask([0x81, 0x82, 0x83]);
  /** A decoder over the small table, with overrides and a first trail byte. */
  const decoder = (overrides = {}, trailFirst = 0): DoubleByteDecoder =>
    new DoubleByteDecoder('Test', table, leads, overrides, trailFirst);

  it('reads ASCII bytes alone and a lead byte with its trail', () => {
    expect(decoder().decode(bytes('A', [0x81, 0x40], 'B', [0x82, 0x41]))).toBe('A一B丄');
  });

  it('rejects a byte above 0x7F that is no lead byte, giving the text before it', () => {
    const error = failure(decoder(), bytes('AB', [0x90], 'C'));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.name).toBe('DecodeError');
    expect(error.message).toContain('Test');
    expect(error.decoded).toBe('AB');
  });

  it('rejects a pair its table leaves undefined', () => {
    expect(failure(decoder(), bytes('A', [0x81, 0x40], [0x82, 0x80])).decoded).toBe('A一');
  });

  it('rejects trail bytes below its first, as GB2312 does within GBK', () => {
    expect(() => decoder({}, 0x41).decode(hex('8140'))).toThrow(DecodeError);
    expect(decoder({}, 0x41).decode(hex('8141'))).toBe('丁');
  });

  it('carries a lead byte from one chunk to the next', () => {
    const d = decoder();
    expect(d.decode(bytes('A', [0x81]), { stream: true })).toBe('A');
    expect(d.decode(Uint8Array.of(0x40))).toBe('一');
  });

  it('fails on a lead byte cut off at the end, whole or after streaming', () => {
    expect(failure(decoder(), bytes('A', [0x81])).decoded).toBe('A');
    const d = decoder();
    expect(d.decode(Uint8Array.of(0x81), { stream: true })).toBe('');
    expect(() => d.decode()).toThrow(DecodeError);
  });

  it('gives nothing when flushed with nothing carried', () => {
    expect(decoder().decode()).toBe('');
    expect(decoder().decode(new Uint8Array(0), { stream: true })).toBe('');
  });

  it('lets single-byte overrides map a byte or reject it', () => {
    const singles = packOverrides([
      [0x41, null],
      [0x80, 0x20_ac],
    ]);
    expect(decoder({ singles }).decode(bytes('B', [0x80]))).toBe('B€');
    expect(failure(decoder({ singles }), bytes('B', 'A')).decoded).toBe('B');
  });

  it('lets pair overrides map a sequence, astral characters included, or reject it, before the table', () => {
    const pairs = packOverrides([
      [0x81_40, 0x1_f6_00],
      [0x81_41, null],
      [0x81_42, 0x41],
    ]);
    expect(decoder({ pairs }).decode(hex('81408142'))).toBe('😀A');
    expect(() => decoder({ pairs }).decode(hex('8141'))).toThrow(DecodeError);
  });

  it('takes bytes past the end of a short lead mask as no lead bytes', () => {
    const short = new DoubleByteDecoder('Test', table, leadMask([0x81]).slice(0, 33), {});
    expect(short.decode(hex('8140'))).toBe('一');
    expect(() => short.decode(hex('8240'))).toThrow(DecodeError);
  });

  it('rejects a longer sequence unless the decoder reads them', () => {
    /** A decoder whose 0x83 starts a three-byte sequence it has no table for. */
    class Longer extends DoubleByteDecoder {
      protected override sequenceLength(input: Uint8Array, start: number): number {
        return input[start] === 0x83 ? 3 : super.sequenceLength(input, start);
      }
    }
    expect(failure(new Longer('Test', table, leads, {}), bytes('A', [0x83, 0x40, 0x40])).decoded).toBe('A');
  });

  it('decodes text longer than one run', () => {
    const long = new Uint8Array(10_000).fill(0x41);
    expect(decoder().decode(long)).toBe('A'.repeat(10_000));
    expect(failure(decoder(), bytes(long, [0xff])).decoded).toBe('A'.repeat(10_000));
  });
});

describe('ShiftJisDecoder', () => {
  /** A Shift_JIS decoder over JIS X 0208, with or without the user-defined area. */
  const shiftJis = (userDefinedArea: 'private use' | 'unmapped' = 'unmapped'): ShiftJisDecoder =>
    new ShiftJisDecoder('Shift_JIS', jis0208, leadsOf('windows-31j'), {}, userDefinedArea);

  it.each([
    ['8140', '\u3000', 'row 1, cell 1'],
    ['817e', '×', 'row 1, cell 63, before the gap at 0x7F'],
    ['8180', '÷', 'row 1, cell 64, after it'],
    ['819e', '◇', 'row 1, cell 94'],
    ['819f', '◆', 'row 2, cell 1'],
    ['81fc', '◯', 'row 2, cell 94'],
    ['82a0', 'あ', 'row 4, cell 2'],
    ['9ffc', '滌', 'row 62, cell 94'],
    ['e040', '漾', 'row 63, cell 1, after the katakana bytes'],
    ['eaa4', '熙', 'row 84, cell 6'],
  ])('folds two JIS X 0208 rows into each lead byte: %s is %s (%s)', (input, text) => {
    expect(shiftJis().decode(hex(input))).toBe(text);
  });

  it.each(['813f', '817f', '81fd', '84bf', 'eaa5'])(
    'rejects %s, a trail byte out of range or an empty cell',
    (input) => {
      expect(() => shiftJis().decode(hex(input))).toThrow(DecodeError);
    }
  );

  it('reads 0xA1–0xDF as half-width katakana and other single bytes above 0x7F as errors', () => {
    expect(shiftJis().decode(hex('a1b1df'))).toBe('｡ｱﾟ');
    for (const b of [0x80, 0xa0, 0xfd, 0xfe, 0xff])
      expect(() => shiftJis().decode(Uint8Array.of(b))).toThrow(DecodeError);
  });

  it.each([
    ['f040', 0xe0_00],
    ['f07e', 0xe0_3e],
    ['f080', 0xe0_3f],
    ['f0fc', 0xe0_bb],
    ['f140', 0xe0_bc],
    ['f9fc', 0xe7_57],
  ])('maps the user-defined area to private use when asked: %s is U+%s', (input, code) => {
    expect(shiftJis('private use').decode(hex(input))).toBe(String.fromCharCode(code));
    expect(() => shiftJis('unmapped').decode(hex(input))).toThrow(DecodeError);
  });

  it('leaves lead bytes past 0xF9 undefined, even with the user-defined area', () => {
    expect(() => shiftJis('private use').decode(hex('fa40'))).toThrow(DecodeError);
  });
});

describe('EucJpDecoder', () => {
  /** An EUC-JP decoder over JIS X 0208 and 0212, with overrides. */
  const eucJp = (overrides = {}): EucJpDecoder =>
    new EucJpDecoder('EUC-JP', jis0208, jis0212, leadsOf('euc-jp'), overrides);

  it.each([
    ['a1a1', '\u3000'],
    ['a4a2', 'あ'],
    ['c6fc', '日'],
    ['f4a6', '熙'],
  ])('reads JIS X 0208 as two bytes from 0xA1: %s is %s', (input, text) => {
    expect(eucJp().decode(hex(input))).toBe(text);
  });

  it('reads half-width katakana after SS2 (0x8E), and only 0xA1–0xDF', () => {
    expect(eucJp().decode(hex('8ea18eb18edf'))).toBe('｡ｱﾟ');
    expect(() => eucJp().decode(hex('8ea0'))).toThrow(DecodeError);
    expect(() => eucJp().decode(hex('8ee0'))).toThrow(DecodeError);
  });

  it.each([
    ['8fb0a1', '丂'],
    ['8fb0a2', '丄'],
    ['8fede3', '龥'],
  ])('reads JIS X 0212 as three bytes after SS3 (0x8F): %s is %s', (input, text) => {
    expect(eucJp().decode(hex(input))).toBe(text);
  });

  it.each(['8fa1a1', '8fede4', '8fb0a0', '8f41a1', 'f4a7', 'a9a1'])('rejects %s, which no table defines', (input) => {
    expect(() => eucJp().decode(hex(input))).toThrow(DecodeError);
  });

  it('lets three-byte overrides map a JIS X 0212 cell or reject it', () => {
    const triples = packOverrides([
      [0xb0_a1, 0x41],
      [0xb0_a2, null],
    ]);
    expect(eucJp({ triples }).decode(hex('8fb0a1'))).toBe('A');
    expect(() => eucJp({ triples }).decode(hex('8fb0a2'))).toThrow(DecodeError);
  });

  it('carries a three-byte sequence cut at any byte', () => {
    for (const chunks of splits(bytes('A', [0x8f, 0xb0, 0xa1], 'B'))) {
      expect(decodeChunks(eucJp(), chunks)).toBe('A丂B');
    }
  });

  it.each(['8f', '8fb0', '8e', 'a4'])('fails on %s cut off at the end, whole or after streaming', (input) => {
    const data = bytes('A', hex(input));
    expect(failure(eucJp(), data).decoded).toBe('A');
    const d = eucJp();
    expect(d.decode(hex(input), { stream: true })).toBe('');
    expect(() => d.decode()).toThrow(DecodeError);
  });
});

describe('Iso2022JpDecoder', () => {
  /** An ISO-2022-JP decoder over JIS X 0208. */
  const iso = (): Iso2022JpDecoder => new Iso2022JpDecoder(jis0208);

  it('starts in ASCII', () => {
    expect(iso().decode(bytes('A~\\\n'))).toBe('A~\\\n');
  });

  it.each([
    ['ESC $ B', '1b2442'],
    ['ESC $ @', '1b2440'],
  ])('reads JIS X 0208 after %s and ASCII again after ESC ( B', (_, escape) => {
    expect(iso().decode(hex(`${escape}2422467c1b284241`))).toBe('あ日A');
  });

  it('reads JIS X 0201 Roman after ESC ( J, with the yen sign and overline', () => {
    expect(iso().decode(hex('1b284a5c7e41'))).toBe('¥‾A');
  });

  it('reads JIS X 0201 katakana after ESC ( I, from 0x21 to 0x5F', () => {
    expect(iso().decode(hex('1b2849215f'))).toBe('｡ﾟ');
    // Bytes below 0x21 decode as the JDK decodes them, to U+FF40 and up.
    expect(iso().decode(hex('1b2849000a'))).toBe('｀ｊ');
    expect(() => iso().decode(hex('1b284960'))).toThrow(DecodeError);
  });

  it('shifts to katakana with SO and back to the mode before with SI', () => {
    expect(iso().decode(hex('0e310f41'))).toBe('ｱA');
    expect(iso().decode(hex('1b244224220e310f2422'))).toBe('あｱあ');
  });

  it.each([
    ['ESC $ A, GB 2312', '1b2441'],
    ['ESC ( D', '1b2844'],
    ['ESC A', '1b4141'],
  ])('rejects an escape it does not know: %s', (_, input) => {
    expect(failure(iso(), hex(`41${input}`)).decoded).toBe('A');
  });

  it.each([
    ['ASCII', '80'],
    ['JIS X 0208', '1b2442a4a2'],
    ['katakana', '1b2849b1'],
    ['Roman', '1b284a80'],
  ])('rejects bytes above 0x7F in %s', (_, input) => {
    expect(() => iso().decode(hex(input))).toThrow(DecodeError);
  });

  it.each(['2a21', '2420', '247f', '0a41', '7427'])(
    'rejects the JIS X 0208 pair %s, which the table leaves undefined',
    (pair) => {
      expect(failure(iso(), hex(`1b244224221b2442${pair}`)).decoded).toBe('あ');
    }
  );

  it('carries escapes and pairs cut at any byte', () => {
    for (const chunks of splits(hex('411b244224221b284a5c1b284242'))) {
      expect(decodeChunks(iso(), chunks)).toBe('Aあ¥B');
    }
  });

  it('keeps its mode from one chunk to the next', () => {
    const d = iso();
    expect(d.decode(hex('1b2442'), { stream: true })).toBe('');
    expect(d.decode(hex('2422'), { stream: true })).toBe('あ');
    expect(d.decode(hex('0e'), { stream: true })).toBe('');
    expect(d.decode(hex('31'))).toBe('ｱ');
  });

  it.each(['1b', '1b24', '1b28', '1b244224'])('fails on %s cut off at the end, whole or after streaming', (input) => {
    const data = bytes('A', hex(input));
    expect(failure(iso(), data).decoded).toBe('A');
    const d = iso();
    expect(d.decode(hex(input), { stream: true })).toBe('');
    expect(() => d.decode()).toThrow(DecodeError);
  });

  it('gives nothing when flushed with nothing carried', () => {
    expect(iso().decode()).toBe('');
  });
});
