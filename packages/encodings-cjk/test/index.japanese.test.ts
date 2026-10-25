import { outcome } from '@test/helpers/bytes.ts';
import { describe, expect, it } from 'vitest';

// Each case is the bytes in hex and what the JDK decodes them to, or null for an error.

describe('Shift_JIS (JIS X 0208:1997 Annex 1; Unicode JIS0201.TXT and JIS0208.TXT)', () => {
  it.each([
    ['5c', '\\'],
    ['7e', '~'],
    ['7f', '\u007F'],
    ['a1', '｡'],
    ['df', 'ﾟ'],
    ['8140', '\u3000'],
    ['82a0', 'あ'],
    ['889f', '亜'],
    ['93fa967b', '日本'],
    ['eaa4', '熙'],
    ['815f', '＼'],
    ['8160', '〜'],
    ['817c', '−'],
    ['8191', '¢'],
    ['81ca', '¬'],
    ['80', null],
    ['a0', null],
    ['fd', null],
    ['ff', null],
    ['813f', null],
    ['817f', null],
    ['81fd', null],
    ['84bf', null],
    ['8540', null],
    ['eaa5', null],
    ['eb40', null],
    ['8740', null],
    ['ed40', null],
    ['fa40', null],
    ['f040', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('shift_jis', input)).toBe(text);
  });
});

describe("windows-31j (Microsoft's CP932.TXT, with the user-defined area as private use)", () => {
  it.each([
    ['5c', '\\'],
    ['7e', '~'],
    ['a1', '｡'],
    ['815f', '＼'],
    ['8160', '～'],
    ['817c', '－'],
    ['8191', '￠'],
    ['8192', '￡'],
    ['81ca', '￢'],
    ['8740', '①'],
    ['875f', '㍉'],
    ['877e', '㍻'],
    ['8790', '≒'],
    ['879c', '∪'],
    ['ed40', '纊'],
    ['eeef', 'ⅰ'],
    ['eefc', '＂'],
    ['fa40', 'ⅰ'],
    ['fc4b', '黑'],
    ['f040', '\uE000'],
    ['f9fc', '\uE757'],
    ['80', null],
    ['a0', null],
    ['fd', null],
    ['ff', null],
    ['817f', null],
    ['81fd', null],
    ['8540', null],
    ['87fc', null],
    ['ef40', null],
    ['fa3f', null],
    ['fc4c', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('windows-31j', input)).toBe(text);
  });
});

describe('EUC-JP (JIS X 0208, JIS X 0201 katakana after SS2, JIS X 0212 after SS3)', () => {
  it.each([
    ['5c', '\\'],
    ['7e', '~'],
    ['a1a1', '\u3000'],
    ['a4a2', 'あ'],
    ['b0a1', '亜'],
    ['f4a6', '熙'],
    ['a1bd', '—'],
    ['a1c0', '＼'],
    ['a1c1', '〜'],
    ['a2ae', '〓'],
    ['8ea1', '｡'],
    ['8edf', 'ﾟ'],
    ['8fb0a1', '丂'],
    ['8fa2af', '˘'],
    ['8fa2b7', '～'],
    ['8fa2c3', '¦'],
    ['8fede3', '龥'],
    ['80', null],
    ['8e', null],
    ['8f', null],
    ['a0', null],
    ['ff', null],
    ['a1a0', null],
    ['a1ff', null],
    ['a2af', null],
    ['a9a1', null],
    ['f4a7', null],
    ['fea1', null],
    ['8ea0', null],
    ['8ee0', null],
    ['8fa1a1', null],
    ['8fede4', null],
    ['8ffefe', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('euc-jp', input)).toBe(text);
  });
});

describe('ISO-2022-JP (RFC 1468, read as the JDK reads it, with SO, SI and ESC ( I)', () => {
  it.each([
    ['41', 'A'],
    ['7f', '\u007F'],
    ['0e', ''],
    ['0f', ''],
    ['0e0f', ''],
    ['0e31', 'ｱ'],
    ['0e5f', 'ﾟ'],
    ['1b24422422', 'あ'],
    ['1b24402422', 'あ'],
    ['1b24422121', '\u3000'],
    ['1b2442467c', '日'],
    ['1b24427426', '熙'],
    ['1b24420e31', 'ｱ'],
    ['1b284a41', 'A'],
    ['1b284a5c', '¥'],
    ['1b284a7e', '‾'],
    ['1b284a5c5c', '¥¥'],
    ['1b284900', '｀'],
    ['1b28490a', 'ｊ'],
    ['1b284920', '｠'],
    ['1b284921', '｡'],
    ['1b284931', 'ｱ'],
    ['1b28495f', 'ﾟ'],
    ['80', null],
    ['1b', null],
    ['1b24', null],
    ['0e60', null],
    ['1b24420a41', null],
    ['1b2442210a', null],
    ['1b24422420', null],
    ['1b2442247f', null],
    ['1b24422a21', null],
    ['1b24427427', null],
    ['1b24427474', null],
    ['1b284a80', null],
    ['1b284960', null],
    ['1b28497f', null],
  ])('decodes %s to %j', (input, text) => {
    expect(outcome('iso-2022-jp', input)).toBe(text);
  });
});
