import { verdict } from '@test/helpers/lexical.ts';
import { canonical, errorOf, parseEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { TABLES_XML_10, TABLES_XML_11, TABLES_REPLACEMENT_TEXT } from '@/scan/classes.ts';
import {
  MORE,
  ScanError,
  ScanFlag,
  type ScanState,
  Terminator,
  holdsAt,
  sameSpan,
  scanAttributeValue,
  scanName,
  scanSpan,
  scanText,
  scanTo,
  skipSpacesTabsAndLineFeeds,
} from '@/scan/scanner.ts';

/** A scan state over text: final, XML 1.0 and not replacement text unless said otherwise. */
function state(text: string, { final = true, version11 = false, raw = false } = {}): ScanState {
  let tables = version11 ? TABLES_XML_11 : TABLES_XML_10;
  if (raw) tables = TABLES_REPLACEMENT_TEXT;
  return { buffer: text, final, version11, tables, flags: 0, firstColon: -1, colonCount: 0 };
}

/** A scan's ScanError as its code and index. */
function failure(scan: () => unknown): string {
  try {
    scan();
  } catch (error) {
    if (error instanceof ScanError) return `${error.code} @${error.index}`;
    throw error;
  }
  return 'no error';
}

const QUOT = 0x22;
const APOS = 0x27;

describe('ScanError', () => {
  it('carries a code and the buffer index of the fault', () => {
    const error = new ScanError('WF_NAME', 7, 'Expected a name');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'ScanError', code: 'WF_NAME', index: 7, message: 'Expected a name' });
  });
});

describe('span comparison', () => {
  it('compares short and long strings at a position', () => {
    expect(holdsAt('xxabc', 2, 'abc')).toBe(true);
    expect(holdsAt('xxabd', 2, 'abc')).toBe(false);
    const long = 'http://www.w3.org/2000/xmlns/';
    expect(holdsAt(` ${long}`, 1, long)).toBe(true);
    expect(holdsAt(` ${long.slice(0, -1)}x`, 1, long)).toBe(false);
    expect(holdsAt(` x${long.slice(1)}`, 1, long)).toBe(false);
    expect(holdsAt(long.slice(0, -1), 0, long)).toBe(false);
    expect(holdsAt('ab', 1, 'bc')).toBe(false);
    expect(holdsAt('ab', 1, '')).toBe(true);
  });

  it('compares two spans of one buffer', () => {
    expect(sameSpan('abcXabc', 0, 4, 3)).toBe(true);
    expect(sameSpan('abcXabd', 0, 4, 3)).toBe(false);
    expect(sameSpan('abc', 0, 1, 0)).toBe(true);
  });
});

describe('scanning character data', () => {
  it('stops at < and &, and at the end only once the input is final', () => {
    expect(scanText(state('abc<d'), 0)).toBe(3);
    expect(scanText(state('ab&c;'), 1)).toBe(2);
    expect(scanText(state('abc'), 0)).toBe(3);
    expect(scanText(state('abc', { final: false }), 0)).toBe(MORE);
    expect(scanText(state('abcdef', { final: false }), 0, 3)).toBe(3);
  });

  it('flags CR, which needs normalizing, and not LF or tab', () => {
    const s = state('a\tb\nc<');
    expect(scanText(s, 0)).toBe(5);
    expect(s.flags).toBe(0);
    const cr = state('a\r\nb<');
    expect(scanText(cr, 0)).toBe(4);
    expect(cr.flags).toBe(ScanFlag.CR);
  });

  it('rejects ]]> (§2.4 [14]) at its first ], and allows ] and ]] otherwise', () => {
    expect(failure(() => scanText(state('a]]>'), 0))).toBe('WF_CDATA_END_IN_TEXT @1');
    expect(failure(() => scanText(state(']]]>'), 0))).toBe('WF_CDATA_END_IN_TEXT @1');
    expect(scanText(state('a]b]]c]] >]<'), 0)).toBe(11);
    expect(scanText(state('a]'), 0)).toBe(2);
    expect(scanText(state('a]]'), 0)).toBe(3);
  });

  it('waits for more text after ] or ]] at the end of the buffer', () => {
    expect(scanText(state('a]', { final: false }), 0)).toBe(MORE);
    expect(scanText(state('a]]', { final: false }), 0)).toBe(MORE);
  });

  it.each([
    ['NUL', '\u0000'],
    ['a C0 control', '\u0001'],
    ['the last C0 control', '\u001F'],
    ['U+FFFE', '￾'],
    ['U+FFFF', '￿'],
    ['a lone low surrogate', '\uDC00'],
    ['a high surrogate before a character that is not a low one', '\uD800x'],
  ])('rejects %s (§2.2)', (_, bad) => {
    expect(failure(() => scanText(state(`ab${bad}`), 0))).toBe('WF_INVALID_CHARACTER @2');
  });

  it('takes a surrogate pair as one character, and waits for the low half at the end of the buffer', () => {
    expect(scanText(state('𝄞<'), 0)).toBe(2);
    expect(scanText(state('a\uD834', { final: false }), 0)).toBe(MORE);
    expect(failure(() => scanText(state('a\uD834'), 0))).toBe('WF_INVALID_CHARACTER @1');
  });

  it('allows DEL and the C1 controls in XML 1.0', () => {
    expect(scanText(state('\u007F\u0080\u0085\u009F\u2028'), 0)).toBe(5);
  });

  it('rejects DEL and the C1 controls but NEL in XML 1.1, and flags NEL and LS as line ends', () => {
    for (const c of ['\u007F', '\u0080', '\u0084', '\u0086', '\u009F']) {
      expect(failure(() => scanText(state(`a${c}`, { version11: true }), 0))).toBe('WF_INVALID_CHARACTER @1');
    }
    for (const c of ['\u0085', '\u2028']) {
      const s = state(`a${c}b`, { version11: true });
      expect(scanText(s, 0)).toBe(3);
      expect(s.flags).toBe(ScanFlag.NEL);
    }
    expect(scanText(state('\u00A0\u2029', { version11: true }), 0)).toBe(2);
  });

  it('trusts the characters of replacement text but still finds ]]>', () => {
    const s = state('\u0001\r\u007F<', { raw: true });
    expect(scanText(s, 0)).toBe(3);
    expect(s.flags).toBe(0);
    expect(failure(() => scanText(state('x]]>', { raw: true }), 0))).toBe('WF_CDATA_END_IN_TEXT @1');
  });
});

describe('skipping blanks', () => {
  it('skips spaces, tabs and line feeds, and not CR, which may need normalizing', () => {
    expect(skipSpacesTabsAndLineFeeds(' \n\t x', 0)).toBe(4);
    expect(skipSpacesTabsAndLineFeeds('  ', 0)).toBe(2);
    expect(skipSpacesTabsAndLineFeeds('\r ', 0)).toBe(0);
    expect(skipSpacesTabsAndLineFeeds('ab', 1)).toBe(1);
  });
});

describe('scanning attribute values', () => {
  it('stops at its own closing quote or &, treating the other quote as ordinary', () => {
    expect(scanAttributeValue(state('a\'b"'), 0, QUOT)).toBe(3);
    expect(scanAttributeValue(state('a"b\''), 0, APOS)).toBe(3);
    expect(scanAttributeValue(state('ab&c;"'), 0, QUOT)).toBe(2);
    expect(scanAttributeValue(state('abcdef"'), 0, QUOT, 2)).toBe(2);
  });

  it('asks for more text at the end of the buffer, final or not', () => {
    expect(scanAttributeValue(state('abc'), 0, QUOT)).toBe(MORE);
    expect(scanAttributeValue(state('abc', { final: false }), 0, QUOT)).toBe(MORE);
  });

  it('rejects < (§3.1 WFC: No < in Attribute Values)', () => {
    expect(failure(() => scanAttributeValue(state('a<b"'), 0, QUOT))).toBe('WF_LT_IN_ATTRIBUTE @1');
  });

  it('flags tab, LF and CR, which normalization turns into spaces (§3.3.3), and CR for line ends too', () => {
    for (const c of ['\t', '\n']) {
      const s = state(`a${c}b"`);
      scanAttributeValue(s, 0, QUOT);
      expect(s.flags).toBe(ScanFlag.WHITESPACE);
    }
    const cr = state('a\rb"');
    scanAttributeValue(cr, 0, QUOT);
    expect(cr.flags).toBe(ScanFlag.WHITESPACE | ScanFlag.CR);
  });

  it('rejects characters XML does not allow, and checks surrogate pairs', () => {
    expect(failure(() => scanAttributeValue(state('a\u0002"'), 0, QUOT))).toBe('WF_INVALID_CHARACTER @1');
    expect(scanAttributeValue(state('𝄞"'), 0, QUOT)).toBe(2);
    expect(scanAttributeValue(state('a\uD834', { final: false }), 0, QUOT)).toBe(MORE);
    expect(failure(() => scanAttributeValue(state('\uDD1E"'), 0, QUOT))).toBe('WF_INVALID_CHARACTER @0');
  });

  it('flags NEL and LS in XML 1.1', () => {
    const s = state('a\u0085\u2028"', { version11: true });
    expect(scanAttributeValue(s, 0, QUOT)).toBe(3);
    expect(s.flags).toBe(ScanFlag.NEL);
  });

  it('flags the whitespace of replacement text without CR, whose line ends were already normalized', () => {
    const s = state('a\r\n\tb"', { raw: true });
    expect(scanAttributeValue(s, 0, QUOT)).toBe(5);
    expect(s.flags).toBe(ScanFlag.WHITESPACE);
  });
});

describe('scanning names (§2.3 [5])', () => {
  /** The end of the name at 0, and the colons it recorded. */
  const name = (text: string, final = true): [number, number, number] => {
    const s = state(text, { final });
    return [scanName(s, 0), s.firstColon, s.colonCount];
  };

  it('scans to the first character that is not a name character, recording the colons', () => {
    expect(name('abc def')).toEqual([3, -1, 0]);
    expect(name('a:b:c>')).toEqual([5, 1, 2]);
    expect(name(':a ')).toEqual([2, 0, 1]);
    expect(name('a-b.c_1=')).toEqual([7, -1, 0]);
  });

  it('starts over the colon count for each name', () => {
    const s = state('a:b c');
    scanName(s, 0);
    scanName(s, 4);
    expect([s.firstColon, s.colonCount]).toEqual([-1, 0]);
  });

  it('returns its start when no name starts there', () => {
    for (const text of ['1a', '-a', '.a', ' a', '·a', '̀a', '×', '\u{F0000}']) expect(name(text)[0], text).toBe(0);
  });

  it('reads names beyond ASCII, outside the BMP too, up to U+EFFFF', () => {
    expect(name('é·̀ ')[0]).toBe(3);
    expect(name('\u{10000}a')[0]).toBe(3);
    expect(name('a\u{EFFFF}')[0]).toBe(3);
    expect(name('a\u{F0000}')[0]).toBe(1);
    expect(name('a×')[0]).toBe(1);
    expect(name('a\uD800x')[0]).toBe(1);
    expect(name('a\uDC00')[0]).toBe(1);
  });

  it('waits for more text when a name may go on past the buffer', () => {
    expect(name('abc', false)[0]).toBe(MORE);
    expect(name('', false)[0]).toBe(MORE);
    expect(name('\uD800', false)[0]).toBe(MORE);
    expect(name('a\uD800', false)[0]).toBe(MORE);
  });

  it('ends a name at the end of final text', () => {
    expect(name('abc')[0]).toBe(3);
    expect(name('')[0]).toBe(0);
    expect(name('\uD800')[0]).toBe(0);
    expect(name('a\uD800')[0]).toBe(1);
  });
});

describe('scanning to a terminator', () => {
  it.each([
    ['--', Terminator.COMMENT, 'a-b-->', 3],
    ['?>', Terminator.PI, 'a?b>?>', 4],
    [']]>', Terminator.CDATA, 'a]b]]c]]>', 6],
  ])('finds %s at its first character, past near misses', (_, terminator, text, index) => {
    expect(scanTo(state(text), 0, terminator)).toBe(index);
    expect(scanTo(state(`x${text}`), 1, terminator)).toBe(index + 1);
  });

  it.each([
    ['--', Terminator.COMMENT, ['abc', 'a-']],
    ['?>', Terminator.PI, ['abc', 'a?']],
    [']]>', Terminator.CDATA, ['abc', 'a]', 'a]]']],
  ])('asks for more text while %s may still come', (_, terminator, texts) => {
    for (const text of texts) expect(scanTo(state(text), 0, terminator), text).toBe(MORE);
  });

  it('checks the characters it passes, and flags CR', () => {
    expect(failure(() => scanTo(state('a\u0001-->'), 0, Terminator.COMMENT))).toBe('WF_INVALID_CHARACTER @1');
    expect(failure(() => scanTo(state('￿?>'), 0, Terminator.PI))).toBe('WF_INVALID_CHARACTER @0');
    expect(failure(() => scanTo(state('\uDC00]]>'), 0, Terminator.CDATA))).toBe('WF_INVALID_CHARACTER @0');
    const s = state('a\r\nb]]>');
    expect(scanTo(s, 0, Terminator.CDATA)).toBe(4);
    expect(s.flags).toBe(ScanFlag.CR);
    expect(scanTo(state('𝄞-->'), 0, Terminator.COMMENT)).toBe(2);
    expect(scanTo(state('\uD834', { final: false }), 0, Terminator.COMMENT)).toBe(MORE);
  });

  it('applies XML 1.1 characters and line ends', () => {
    const s = state('\u0085?>', { version11: true });
    expect(scanTo(s, 0, Terminator.PI)).toBe(1);
    expect(s.flags).toBe(ScanFlag.NEL);
    expect(failure(() => scanTo(state('\u0086?>', { version11: true }), 0, Terminator.PI))).toBe(
      'WF_INVALID_CHARACTER @0'
    );
  });
});

describe('checking a span', () => {
  it('checks every character of a span whose end is known', () => {
    expect(failure(() => scanSpan(state('ab\u0001c'), 0, 4))).toBe('WF_INVALID_CHARACTER @2');
    expect(failure(() => scanSpan(state('a\uD800b'), 0, 3))).toBe('WF_INVALID_CHARACTER @1');
    expect(() => scanSpan(state('a𝄞b<&]]>'), 0, 8)).not.toThrow();
    expect(() => scanSpan(state('\u0001'), 0, 0)).not.toThrow();
  });

  it('flags CR in the span', () => {
    const s = state('a\rb');
    scanSpan(s, 0, 3);
    expect(s.flags).toBe(ScanFlag.CR);
  });
});

describe('names in documents (§2.3, fifth edition)', () => {
  it('allows letters, _ and : to start a name, and digits, - and . after', () => {
    expect(parseEveryWay('<_a.b-1 c:d="1"/>', { namespaceAware: false })).toBe('<_a.b-1 c:d="1"></_a.b-1>');
  });

  it('allows the fifth edition ranges that earlier editions did not', () => {
    expect(parseEveryWay('<ſ/>')).toBe('<ſ></ſ>');
    expect(parseEveryWay('<a\u{10000}/>')).toBe('<a\u{10000}></a\u{10000}>');
  });

  it('rejects a name that starts with a digit or a combining mark', () => {
    expect(errorOf('<1a/>').code).toBe('WF_NAME');
    expect(errorOf('<\u0300a/>').code).toBe('WF_NAME');
  });

  it('rejects a character no name may hold', () => {
    expect(errorOf('<a×b/>').code).toBe('WF_TAG');
  });
});

describe('characters in documents (§2.2)', () => {
  it('rejects a control character in content, at its location', () => {
    expect(errorOf('<a>\n x\u0001</a>')).toMatchObject({ code: 'WF_INVALID_CHARACTER', line: 2, column: 3 });
  });

  it.each([
    ['an attribute value', '<a b="\u0002"/>', 'WF_INVALID_CHARACTER 1:7'],
    ['a comment', '<a><!-- \u0002 --></a>', 'WF_INVALID_CHARACTER 1:9'],
    ['a PI', '<a><?p \u0002?></a>', 'WF_INVALID_CHARACTER 1:8'],
    ['a CDATA section', '<a><![CDATA[\u0000]]></a>', 'WF_INVALID_CHARACTER 1:13'],
    ['a system literal', '<!DOCTYPE r SYSTEM "\u0000"><r/>', 'WF_INVALID_CHARACTER 1:21'],
    ['an entity value', '<!DOCTYPE r [<!ENTITY e "\u0000">]><r/>', 'WF_INVALID_CHARACTER 1:26'],
    ['the prolog', '\n\u0001<a/>', 'WF_INVALID_CHARACTER 2:1'],
  ])('rejects a control character in %s', (_, xml, error) => {
    expect(verdict(xml)).toBe(error);
    expect(errorOf(xml).code).toBe('WF_INVALID_CHARACTER');
  });

  it.each([
    ['text', '<r>￾</r>', 'WF_INVALID_CHARACTER 1:4'],
    ['an attribute value', '<r a="￿"/>', 'WF_INVALID_CHARACTER 1:7'],
    ['a comment', '<r><!--￾--></r>', 'WF_INVALID_CHARACTER 1:8'],
    ['a CDATA section', '<r><![CDATA[￿]]></r>', 'WF_INVALID_CHARACTER 1:13'],
  ])('rejects U+FFFE and U+FFFF in %s', (_, xml, error) => {
    expect(errorOf(xml).code).toBe('WF_INVALID_CHARACTER');
    expect(verdict(xml)).toBe(error);
  });

  it.each([
    ['text', '<r>\uD800x</r>', 'WF_INVALID_CHARACTER 1:4'],
    ['text, a low half', '<r>\uDC00</r>', 'WF_INVALID_CHARACTER 1:4'],
    ['an attribute value', '<r a="\uD800x"/>', 'WF_INVALID_CHARACTER 1:7'],
    ['a comment', '<r><!--\uD800x--></r>', 'WF_INVALID_CHARACTER 1:8'],
    ['a PI', '<r><?p \uD800x?></r>', 'WF_INVALID_CHARACTER 1:8'],
    ['a CDATA section', '<r><![CDATA[\uD800x]]></r>', 'WF_INVALID_CHARACTER 1:13'],
    ['a name', '<r\uD800/>', 'WF_TAG 1:3'],
  ])('rejects a lone surrogate in %s of a string', (_, xml, error) => {
    expect(verdict(xml)).toBe(error);
  });

  it('accepts private-use characters and characters outside the BMP as surrogate pairs', () => {
    expect(parseEveryWay('<a b="\u{10FFFF}">𝄞 x\uE000</a>')).toBe('<a b="\u{10FFFF}">𝄞 x\uE000</a>');
  });

  it('checks characters in long runs of text as well as short ones', () => {
    const long = 'x'.repeat(200);
    expect(parseEveryWay(`<a>${long}</a>`)).toBe(`<a>${long}</a>`);
    expect(errorOf(`<a>${long}\u0003${long}</a>`)).toMatchObject({ code: 'WF_INVALID_CHARACTER', column: 204 });
    expect(errorOf(`<a b="${long}\u0003"/>`)).toMatchObject({ code: 'WF_INVALID_CHARACTER', column: 207 });
    expect(() => canonical(`<a>${long}\uD800${long}</a>`)).toThrow(
      expect.objectContaining({ code: 'WF_INVALID_CHARACTER', column: 204 })
    );
  });
});

describe('XML 1.1 characters (§2.2)', () => {
  it('rejects DEL and the C1 controls written literally, apart from NEL', () => {
    expect(errorOf('<?xml version="1.1"?><a>\u007F</a>').code).toBe('WF_INVALID_CHARACTER');
    expect(errorOf('<?xml version="1.1"?><a>\u0080</a>').code).toBe('WF_INVALID_CHARACTER');
    expect(parseEveryWay('<a>\u007F\u0080</a>')).toBe('<a>\u007F\u0080</a>');
  });
});
