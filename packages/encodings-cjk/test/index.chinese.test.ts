import { outcome } from '@test/helpers/bytes.ts';
import { describe, expect, it } from 'vitest';

// Each case is the bytes in hex and what the JDK decodes them to, or null for an error.

describe("GBK (Microsoft's CP936.TXT, its unassigned cells as private use)", () => {
  it.each([
    ['8140', '丂'],
    ['817e', '亊'],
    ['8180', '亐'],
    ['81fe', '侢'],
    ['a1a1', '\u3000'],
    ['a1a4', '·'],
    ['a1aa', '—'],
    ['a3a7', '＇'],
    ['a2e3', '€'],
    ['a892', '♁'],
    ['b0a1', '啊'],
    ['d7f9', '座'],
    ['fe4f', '﨩'],
    ['aaa1', '\uE000'],
    ['afa1', '\uE1D6'],
    ['f8a1', '\uE234'],
    ['fefe', '\uE4C5'],
    ['a140', '\uE4C6'],
    ['a7a0', '\uE765'],
    ['d7fa', '\uE810'],
    ['fe50', '\uE815'],
    ['fea0', '\uE864'],
    ['80', null],
    ['81', null],
    ['fe', null],
    ['ff', null],
    ['8040', null],
    ['813f', null],
    ['817f', null],
    ['81ff', null],
    ['ff40', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('gbk', input)).toBe(text);
  });
});

describe("GB2312 (IBM's EUC-CN table within GB 2312's rows)", () => {
  it.each([
    ['a1a1', '\u3000'],
    ['a1a4', '・'],
    ['a1aa', '―'],
    ['a1fe', '〓'],
    ['a2b1', '⒈'],
    ['a3a7', '＇'],
    ['a9ef', '╋'],
    ['b0a1', '啊'],
    ['d7f9', '座'],
    ['f7fe', '齄'],
    ['80', null],
    ['a0', null],
    ['a1', null],
    ['f8', null],
    ['ff', null],
    ['8140', null],
    ['a1ff', null],
    ['a2a1', null],
    ['a2e3', null],
    ['a9f0', null],
    ['aaa1', null],
    ['b040', null],
    ['b0a0', null],
    ['d7fa', null],
    ['f8a1', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('gb2312', input)).toBe(text);
  });
});

describe("Big5 (Unicode's BIG5.TXT, its duplicates mapped to the characters they duplicate)", () => {
  it.each([
    ['a140', '\u3000'],
    ['a17e', '﹚'],
    ['a1a1', '﹛'],
    ['a3bf', 'ˋ'],
    ['a440', '一'],
    ['a441', '乙'],
    ['c6a1', 'ヾ'],
    ['f9d5', '龘'],
    ['a15a', '＿'],
    ['a1c4', '＿'],
    ['a1fe', '╱'],
    ['a2ac', '╱'],
    ['a240', '╲'],
    ['a2ad', '╲'],
    ['a2cc', '十'],
    ['a451', '十'],
    ['a2ce', '卅'],
    ['a4ca', '卅'],
    ['80', null],
    ['a0', null],
    ['fa', null],
    ['ff', null],
    ['8140', null],
    ['a13f', null],
    ['a17f', null],
    ['a1a0', null],
    ['a1ff', null],
    ['a3c0', null],
    ['a3e1', null],
    ['c87e', null],
    ['c8a1', null],
    ['f9d6', null],
    ['f9fe', null],
    ['fa40', null],
    ['fefe', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('big5', input)).toBe(text);
  });
});

describe("Big5-HKSCS (Big5 with IBM's HKSCS-2008 table)", () => {
  it.each([
    ['8740', '䏰'],
    ['8745', '𧉧'],
    ['8840', '㇀'],
    ['8855', '㇎'],
    ['8856', 'Ā'],
    ['a140', '\u3000'],
    ['a440', '一'],
    ['c6a1', '①'],
    ['c6cf', 'に'],
    ['c87e', '䒑'],
    ['c8a1', '龰'],
    ['c8fe', 'ɪ'],
    ['f9d5', '龘'],
    ['f9d6', '碁'],
    ['f9fe', '￭'],
    ['fe40', '鑂'],
    ['fefe', '秔'],
    ['80', null],
    ['86', null],
    ['a0', null],
    ['ff', null],
    ['8040', null],
    ['8140', null],
    ['86fe', null],
    // Two code points in HKSCS, which the JDK does not decode.
    ['8862', null],
    ['8864', null],
    ['88a3', null],
    ['a3e1', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('big5-hkscs', input)).toBe(text);
  });
});
