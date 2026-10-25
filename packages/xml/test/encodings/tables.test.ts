import { describe, expect, it } from 'vitest';
import { SINGLE_BYTE_TABLES } from '@/encodings/tables.ts';

const TABLES = Object.entries(SINGLE_BYTE_TABLES);
const EBCDIC = TABLES.filter(([, table]) => table.length === 256);
const ASCII_COMPATIBLE = TABLES.filter(([, table]) => table.length === 128);

/** A table's character for a byte, whichever half the table starts at. */
function at(name: string, byte: number): string {
  const table = SINGLE_BYTE_TABLES[name] as string;
  return table.charAt(byte - (256 - table.length));
}

describe('the single-byte tables', () => {
  it('give the upper half of ASCII-compatible encodings and all 256 bytes of EBCDIC ones', () => {
    expect(EBCDIC.length + ASCII_COMPATIBLE.length).toBe(TABLES.length);
    for (const [name] of EBCDIC) expect(name).toMatch(/^ibm\d+$/);
  });

  it('cover the encodings the design names', () => {
    const iso = Array.from({ length: 16 }, (_, i) => `iso-8859-${i + 1}`).filter((name) => name !== 'iso-8859-12');
    const windows = ['windows-874', ...Array.from({ length: 9 }, (_, i) => `windows-125${i}`)];
    const ebcdic = ['037', '273', '277', '278', '280', '284', '285', '297', '500', '871', '875', '1026', '1047'];
    const euro = Array.from({ length: 10 }, (_, i) => `ibm114${i}`);
    const expected = [
      'us-ascii',
      ...iso,
      ...windows,
      'koi8-r',
      'koi8-u',
      'macintosh',
      ...ebcdic.map((n) => `ibm${n}`),
      ...euro,
    ];
    expect(Object.keys(SINGLE_BYTE_TABLES).toSorted()).toEqual(expected.toSorted());
  });

  it('hold only BMP characters, with U+FFFF for an undefined byte', () => {
    for (const [, table] of TABLES) {
      for (const c of table) expect(c).toHaveLength(1);
    }
  });

  it.each([
    ['iso-8859-1', 0xe9, 'é'],
    ['iso-8859-1', 0x80, '\u0080'],
    ['iso-8859-15', 0xa4, '€'],
    ['windows-1252', 0x80, '€'],
    ['windows-1251', 0xc0, 'А'],
    ['iso-8859-5', 0xb0, 'А'],
    ['koi8-r', 0xe1, 'А'],
    ['iso-8859-11', 0xa1, 'ก'],
    ['macintosh', 0x80, 'Ä'],
    ['ibm037', 0xc1, 'A'],
    ['ibm1140', 0x9f, '€'],
  ])('map %s byte %d to %s', (name, byte, character) => {
    expect(at(name, byte)).toBe(character);
  });

  it.each([
    ['us-ascii', 0x80],
    ['us-ascii', 0xff],
    ['windows-1252', 0x81],
    ['windows-1252', 0x9d],
    ['iso-8859-3', 0xa5],
    ['iso-8859-11', 0xdb],
  ])('leave %s byte %d undefined', (name, byte) => {
    expect(at(name, byte)).toBe('￿');
  });

  it('map every byte of ISO-8859-1 to the code point of the same value', () => {
    for (let b = 0x80; b <= 0xff; b++) expect(at('iso-8859-1', b).charCodeAt(0)).toBe(b);
  });

  it.each(EBCDIC)('map %s NL (0x15) to NEL and LF (0x25) to LF, as IBM defines them', (name) => {
    expect(at(name, 0x15)).toBe('\u0085');
    expect(at(name, 0x25)).toBe('\n');
  });

  it.each(EBCDIC)('write <?xm as 4C 6F A7 94 in %s, as detection expects (Appendix F.1)', (name) => {
    expect([0x4c, 0x6f, 0xa7, 0x94].map((b) => at(name, b)).join('')).toBe('<?xm');
  });

  it.each(EBCDIC)(
    "write the declaration's letters, digits, punctuation and apostrophe in %s as IBM037 does",
    (name) => {
      const ibm037 = SINGLE_BYTE_TABLES['ibm037'] as string;
      const table = SINGLE_BYTE_TABLES[name] as string;
      for (const c of "<?xml version='1.0' encoding='IBM-037'?>\t\r\nABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-=") {
        expect(table.indexOf(c), c).toBe(ibm037.indexOf(c));
      }
    }
  );
});
