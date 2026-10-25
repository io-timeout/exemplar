import { describe, expect, it } from 'vitest';
import { PREDEFINED_ENTITIES, codePointOfReference, readDigits } from '@/util/references.ts';

describe('codePointOfReference', () => {
  it.each([
    ['#65', 65],
    ['#0065', 65],
    ['#x41', 0x41],
    ['#x0041', 0x41],
    ['#xfF', 0xff],
    ['#x1F525', 0x1_f5_25],
  ])('reads %s as %d', (body, code) => {
    expect(codePointOfReference(body)).toBe(code);
  });

  it.each(['#', '#x', '#X41', '#1a', '#xg', '#-1', '# 1', '#x 1'])('finds %s malformed', (body) => {
    expect(codePointOfReference(body)).toBe(-1);
  });
});

describe('readDigits', () => {
  it('reads decimal and hexadecimal digits up to the first that is not one', () => {
    expect(readDigits('&#65;', 2, false)).toEqual([4, 65]);
    expect(readDigits('&#x4a;', 3, true)).toEqual([5, 0x4a]);
    expect(readDigits('&#xg;', 3, true)).toEqual([3, 0]);
  });

  it('stops growing the value past the last code point', () => {
    expect(readDigits('99999999999999999999', 0, false)).toEqual([20, 0x11_00_00]);
  });
});

describe('PREDEFINED_ENTITIES', () => {
  it('knows the five predefined entities (§4.6)', () => {
    expect([...PREDEFINED_ENTITIES]).toEqual([
      ['lt', '<'],
      ['gt', '>'],
      ['amp', '&'],
      ['apos', "'"],
      ['quot', '"'],
    ]);
  });
});
