import { describe, expect, it } from 'vitest';
import { ALIASES } from '@/input/aliases.ts';
import { DecoderRegistry } from '@/input/decoders.ts';

describe('the encoding alias table', () => {
  it('keys every name in lower case, as names compare case-insensitively (§4.3.3)', () => {
    for (const name of Object.keys(ALIASES)) expect(name).toBe(name.toLowerCase());
  });

  it('lists each canonical name as an alias of itself', () => {
    for (const target of new Set(Object.values(ALIASES))) expect(ALIASES[target]).toBe(target);
  });

  it.each([
    ['ansi_x3.4-1968', 'us-ascii'],
    ['us', 'us-ascii'],
    ['latin1', 'iso-8859-1'],
    ['l2', 'iso-8859-2'],
    ['cyrillic', 'iso-8859-5'],
    ['tis-620', 'iso-8859-11'],
    ['latin-9', 'iso-8859-15'],
    ['mac', 'macintosh'],
    ['ebcdic-cp-us', 'ibm037'],
    ['cp037', 'ibm037'],
    ['cp1026', 'ibm1026'],
    ['ibm1047', 'ibm1047'],
    ['csunicode', 'utf-16'],
    ['iso-10646-ucs-2', 'utf-16'],
    ['iso-10646-ucs-4', 'utf-32'],
    ['ms_kanji', 'shift_jis'],
    ['ms936', 'gbk'],
  ])('maps the registered name %s to %s', (name, canonical) => {
    expect(ALIASES[name]).toBe(canonical);
  });

  it.each([
    'us-ascii',
    'iso-8859-1',
    'iso-8859-11',
    'windows-874',
    'koi8-u',
    'macintosh',
    'ibm037',
    'ibm500',
    'ibm1026',
  ])('names an encoding with a built-in decoder for %s', (target) => {
    expect(Object.values(ALIASES)).toContain(target);
    expect(new DecoderRegistry().get(target)).toBeTypeOf('function');
  });
});
