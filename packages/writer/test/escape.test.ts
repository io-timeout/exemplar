import { describe, expect, it } from 'vitest';
import { type EscapeOptions, checkLiteral, escaper, cdataSections, cdataSectionsAround } from '@/escape.ts';

/** Escape options: round-trip XML 1.0, checked, every character encodable, with any changes given. */
function options(changes: Partial<EscapeOptions> = {}): EscapeOptions {
  return { minimal: false, version11: false, unencodable: undefined, checkCharacters: true, ...changes };
}

/** What ISO-8859-1 lacks: everything from U+0100, surrogates included. */
const LATIN1 = /[\u0100-\uFFFF]/;

describe('escaper, round-trip mode (the default)', () => {
  const { text, attribute } = escaper(options());

  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['\r', '&#13;'],
    ['\n', '\n'],
    ['\t', '\t'],
    ['"', '"'],
    ["'", "'"],
  ])('writes %j in text as %s', (from, to) => {
    expect(text(`a${from}b`)).toBe(`a${to}b`);
  });

  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['"', '&quot;'],
    ['\t', '&#9;'],
    ['\n', '&#10;'],
    ['\r', '&#13;'],
    ['>', '>'],
    ["'", "'"],
  ])('writes %j in an attribute value as %s', (from, to) => {
    expect(attribute(`a${from}b`)).toBe(`a${to}b`);
  });

  it('returns text with nothing to escape unchanged', () => {
    const s = 'plain text é 误 😀';
    expect(text(s)).toBe(s);
    expect(attribute(s)).toBe(s);
  });

  it('keeps characters beyond the BMP whole while escaping around them', () => {
    expect(text('😀&😀<')).toBe('😀&amp;😀&lt;');
    expect(attribute('"😀"')).toBe('&quot;😀&quot;');
  });

  it('writes ]]> in text with > escaped', () => {
    expect(text('a]]>b')).toBe('a]]&gt;b');
  });

  it.each([
    ['\u0000', '0000'],
    ['\u0001', '0001'],
    ['\u001F', '001F'],
    ['\uD800', 'D800'],
    ['\uDFFF', 'DFFF'],
    ['\uFFFE', 'FFFE'],
    ['\uFFFF', 'FFFF'],
  ])('throws WRITE_CHARACTER for %j, which XML 1.0 does not allow (§2.2)', (ch, code) => {
    const expected = expect.objectContaining({ code: 'WRITE_CHARACTER', message: `U+${code} is not allowed in XML` });
    expect(() => text(`a${ch}`)).toThrow(expected);
    expect(() => attribute(`a${ch}`)).toThrow(expected);
  });

  it('writes characters XML does not allow as they are when not checking', () => {
    const unchecked = escaper(options({ checkCharacters: false }));
    expect(unchecked.text('a\u0001\uFFFF&')).toBe('a\u0001\uFFFF&amp;');
    expect(unchecked.attribute('\u0000"')).toBe('\u0000&quot;');
  });

  it('writes C1 controls, NEL and LS as they are in XML 1.0', () => {
    expect(text('\u0080\u0085\u2028')).toBe('\u0080\u0085\u2028');
  });
});

describe('escaper, minimal mode', () => {
  const { text, attribute } = escaper(options({ minimal: true }));

  it('escapes only & and < in text, and > only after ]]', () => {
    expect(text('& < > " \' \t \n \r')).toBe('&amp; &lt; > " \' \t \n \r');
    expect(text(']]>')).toBe(']]&gt;');
    expect(text('] ]> ]>')).toBe('] ]> ]>');
  });

  it('escapes only &, < and " in attribute values', () => {
    expect(attribute('& < > " \' \t \n \r')).toBe("&amp; &lt; > &quot; ' \t \n \r");
  });

  it('still refuses characters XML does not allow', () => {
    expect(() => text('\u0000')).toThrow(expect.objectContaining({ code: 'WRITE_CHARACTER' }));
  });
});

describe('escaper, XML 1.1', () => {
  const { text, attribute } = escaper(options({ version11: true }));

  it.each([
    ['\u0001', '&#1;'],
    ['\u0008', '&#8;'],
    ['\u000B', '&#11;'],
    ['\u001F', '&#31;'],
    ['\u007F', '&#127;'],
    ['\u0085', '&#133;'],
    ['\u009F', '&#159;'],
    ['\u2028', '&#8232;'],
  ])('writes %j as a reference, as XML 1.1 §2.2 and §2.11 need', (ch, ref) => {
    expect(text(ch)).toBe(ref);
    expect(attribute(ch)).toBe(ref);
  });

  it('writes tab and line feed in text as they are', () => {
    expect(text('\t\n')).toBe('\t\n');
  });

  it('still refuses U+0000, surrogates and U+FFFE', () => {
    for (const ch of ['\u0000', '\uD800', '\uFFFE']) {
      expect(() => text(ch)).toThrow(expect.objectContaining({ code: 'WRITE_CHARACTER' }));
    }
  });

  it('writes U+0000 as it is when not checking', () => {
    expect(escaper(options({ version11: true, checkCharacters: false })).text('\u0000\u0001')).toBe('\u0000&#1;');
  });

  it('writes restricted characters as references in minimal mode too', () => {
    expect(escaper(options({ version11: true, minimal: true })).text('\u0001>')).toBe('&#1;>');
  });
});

describe('escaper, for an encoding that lacks characters', () => {
  const { text, attribute } = escaper(options({ unencodable: LATIN1 }));

  it('writes what the encoding lacks as character references, by code point', () => {
    expect(text('é€😀')).toBe('é&#8364;&#128512;');
    expect(attribute('"€"')).toBe('&quot;&#8364;&quot;');
  });

  it('leaves text the encoding holds unchanged', () => {
    expect(text('é ÿ')).toBe('é ÿ');
  });

  it('does the same in minimal mode', () => {
    expect(escaper(options({ minimal: true, unencodable: LATIN1 })).text('€>')).toBe('&#8364;>');
  });
});

describe('checkLiteral', () => {
  it('accepts markup with only allowed characters, beyond the BMP included', () => {
    expect(() => checkLiteral('a comment 😀 \t\n\r', options(), 'a comment')).not.toThrow();
  });

  it.each(['\u0000', '\u0001', '\uD800x', 'x\uDC00', '\uFFFE', '\uFFFF'])(
    'throws WRITE_CHARACTER for %j, naming the place',
    (s) => {
      expect(() => checkLiteral(s, options(), 'a comment')).toThrow(
        expect.objectContaining({
          code: 'WRITE_CHARACTER',
          message: expect.stringMatching(/^U\+[\dA-F]{4} is not allowed in a comment$/),
        })
      );
    }
  );

  it('refuses restricted characters in XML 1.1, which markup cannot hold as references', () => {
    for (const ch of ['\u0001', '\u007F', '\u0080', '\u009F']) {
      expect(() => checkLiteral(ch, options({ version11: true }), 'a PI')).toThrow(
        expect.objectContaining({ code: 'WRITE_CHARACTER' })
      );
    }
  });

  it('accepts NEL and LS in XML 1.1 markup', () => {
    expect(() => checkLiteral('\u0085\u2028', options({ version11: true }), 'a PI')).not.toThrow();
  });

  it('accepts anything when not checking', () => {
    expect(() => checkLiteral('\u0000\uFFFF', options({ checkCharacters: false }), 'a PI')).not.toThrow();
  });

  it('throws WRITE_ENCODING for what the encoding lacks, even when not checking', () => {
    for (const check of [true, false]) {
      expect(() => checkLiteral('a€', options({ unencodable: LATIN1, checkCharacters: check }), 'a comment')).toThrow(
        expect.objectContaining({
          code: 'WRITE_ENCODING',
          message: 'U+20AC cannot be written in a comment in this encoding',
        })
      );
    }
  });

  it('names a character beyond the BMP by its code point', () => {
    expect(() => checkLiteral('😀', options({ unencodable: LATIN1 }), 'a name')).toThrow(/^U\+1F600 cannot/);
  });
});

describe('CDATA sections', () => {
  it('splits a section around ]]>', () => {
    expect(cdataSections('a]]>b')).toBe('<![CDATA[a]]]]><![CDATA[>b]]>');
  });

  it('writes characters an encoding lacks as references between sections, a surrogate pair as one', () => {
    const text = `a\u20ACb${String.fromCodePoint(0x1_f6_00)}`;
    expect(cdataSectionsAround(text, LATIN1)).toBe('<![CDATA[a]]>&#8364;<![CDATA[b]]>&#128512;');
  });
});
