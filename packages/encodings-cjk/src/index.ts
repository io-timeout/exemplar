/** @exemplarjs/encodings-cjk: decoders for Japanese, Chinese and Korean encodings, to register through `decoders`. */
import type { DecoderFactory } from '@exemplarjs/xml';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import {
  DoubleByteDecoder,
  Euc,
  EucJpDecoder,
  Iso2022JpDecoder,
  PairTable,
  ShiftJisDecoder,
  unitsFromBase64,
} from './decoders.ts';
import { BIG5, CHARSETS, GBK, JIS0208, JIS0212, KSX1001 } from './tables.ts';

/** Where a table's characters sit: the first lead byte, and the trail byte ranges as first and last byte in turn. */
interface Layout {
  readonly leadFirst: number;
  readonly trailRanges: readonly number[];
}

/** The 94 × 94 sets as EUC writes them, from 0xA1 for both bytes. */
const EUC_LAYOUT: Layout = { leadFirst: Euc.FIRST, trailRanges: [Euc.FIRST, Euc.LAST] };
/** GBK: leads from 0x81, trail bytes 0x40–0x7E and 0x80–0xFE. */
const GBK_LAYOUT: Layout = { leadFirst: 0x81, trailRanges: [0x40, 0x7e, 0x80, 0xfe] };
/** Big5: leads from 0x81, trail bytes 0x40–0x7E and 0xA1–0xFE. */
const BIG5_LAYOUT: Layout = { leadFirst: 0x81, trailRanges: [0x40, 0x7e, 0xa1, 0xfe] };

/** A shared table, decoded from base64 the first time a decoder needs it. */
function lazyTable(data: string, layout: Layout = EUC_LAYOUT): () => PairTable {
  let table: PairTable | undefined;
  return () => {
    table ??= new PairTable(layout.leadFirst, layout.trailRanges, unitsFromBase64(data));
    return table;
  };
}

const jis0208 = lazyTable(JIS0208);
const jis0212 = lazyTable(JIS0212);
const gbk = lazyTable(GBK, GBK_LAYOUT);
const big5 = lazyTable(BIG5, BIG5_LAYOUT);
const ksx1001 = lazyTable(KSX1001);

/** A charset's lead bytes and overrides, from the generated tables. */
function charsetData(name: string): { readonly leads: string; readonly overrides: object } {
  const found = CHARSETS[name];
  if (found === undefined) throw ErrorFactory.create(Error, `No table for ${name}`);
  return found;
}

/** A Shift_JIS-style decoder factory. */
const shiftJis =
  (name: string, label: string, userDefinedArea: 'private use' | 'unmapped' = 'unmapped'): DecoderFactory =>
  () =>
    new ShiftJisDecoder(label, jis0208(), charsetData(name).leads, charsetData(name).overrides, userDefinedArea);

/** A double-byte decoder factory over one table, from its lowest trail byte. */
const doubleByte =
  (name: string, label: string, table: () => PairTable, trailFirst = 0): DecoderFactory =>
  () =>
    new DoubleByteDecoder(label, table(), charsetData(name).leads, charsetData(name).overrides, trailFirst);

/** The CJK decoders by canonical name, for `new XMLInputFactory({ decoders: cjkDecoders })`. */
export const cjkDecoders: Readonly<Record<string, DecoderFactory>> = {
  shift_jis: shiftJis('shift_jis', 'Shift_JIS'),
  'windows-31j': shiftJis('windows-31j', 'windows-31j', 'private use'),
  'euc-jp': () =>
    new EucJpDecoder('EUC-JP', jis0208(), jis0212(), charsetData('euc-jp').leads, charsetData('euc-jp').overrides),
  'iso-2022-jp': () => new Iso2022JpDecoder(jis0208()),
  gbk: doubleByte('gbk', 'GBK', gbk),
  // GB2312 is the part of GBK in the EUC rows.
  gb2312: doubleByte('gb2312', 'GB2312', gbk, Euc.FIRST),
  big5: doubleByte('big5', 'Big5', big5),
  'big5-hkscs': doubleByte('big5-hkscs', 'Big5-HKSCS', big5),
  'euc-kr': doubleByte('euc-kr', 'EUC-KR', ksx1001),
};
