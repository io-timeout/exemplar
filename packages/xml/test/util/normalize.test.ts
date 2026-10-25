import { parseEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { decodeReferences, normalizeAttributeValue, normalizeLineEnds, rawIndexMapper } from '@/util/normalize.ts';

describe('line ends (§2.11)', () => {
  it('normalizes CRLF and a lone CR to LF in character data', () => {
    expect(parseEveryWay('<a>x\r\ny\rz\n</a>')).toBe('<a>x&#10;y&#10;z&#10;</a>');
    expect(normalizeLineEnds('a\r\n\rb', false)).toBe('a\n\nb');
  });

  it('keeps a CR written as a character reference', () => {
    expect(parseEveryWay('<a>&#13;\r\n</a>')).toBe('<a>&#13;&#10;</a>');
  });

  it('normalizes NEL, LS and CR NEL in XML 1.1 only', () => {
    expect(parseEveryWay('<?xml version="1.1"?><a>1\u00852\u20283\r\u00854</a>')).toBe('<a>1&#10;2&#10;3&#10;4</a>');
    expect(parseEveryWay('<a>1\u00852\u20283</a>')).toBe('<a>1\u00852\u20283</a>');
  });

  it('normalizes line ends in comments, PIs and CDATA sections', () => {
    expect(parseEveryWay('<a><?p x\r\ny?><![CDATA[1\r2]]></a>')).toBe('<a><?p x\ny?>1&#10;2</a>');
  });

  it('normalizes line ends in long runs of text', () => {
    const long = 'x'.repeat(100);
    expect(parseEveryWay(`<a>${long}\r\n${long}</a>`)).toBe(`<a>${long}&#10;${long}</a>`);
  });

  it('normalizes line ends between tags and keeps whitespace-only text', () => {
    expect(parseEveryWay('<r a="1"\r\n b="2">\r  <c/>\n</r>')).toBe('<r a="1" b="2">&#10;  <c></c>&#10;</r>');
    expect(parseEveryWay('<doc> \n<e/> </doc>')).toBe('<doc> &#10;<e></e> </doc>');
  });

  it('keeps CRs written as character references, whatever follows them', () => {
    expect(parseEveryWay('<xml>&#xd;&#x0d;\n</xml>')).toBe('<xml>&#13;&#13;&#10;</xml>');
  });

  it('turns CRLF into LF, and a lone CR into LF, in XML 1.0', () => {
    expect(normalizeLineEnds('a\r\nb\rc\r', false)).toBe('a\nb\nc\n');
    expect(normalizeLineEnds('\r\r\n\n', false)).toBe('\n\n\n');
    expect(normalizeLineEnds('a\u0085b\u2028c', false)).toBe('a\u0085b\u2028c');
  });

  it('returns text without CR as it is', () => {
    const text = 'a\nb';
    expect(normalizeLineEnds(text, false)).toBe(text);
  });

  it('also turns CR NEL, NEL and LS into LF in XML 1.1', () => {
    expect(normalizeLineEnds('a\r\u0085b\u0085c\u2028d\r\ne\rf', true)).toBe('a\nb\nc\nd\ne\nf');
    expect(normalizeLineEnds('\r\r\u0085\u2029', true)).toBe('\n\n\u2029');
  });
});

describe('decodeReferences', () => {
  it('decodes the predefined entities and character references in character data (§4.1, §4.6)', () => {
    expect(decodeReferences('&lt;&gt;&amp;&apos;&quot;&#65;&#x42;&#x1F600;')).toBe(`<>&'"AB😀`);
  });

  it('decodes a reference to any other entity to nothing, as its text is reported apart', () => {
    expect(decodeReferences('a&e;b')).toBe('ab');
  });

  it('leaves line ends alone', () => {
    expect(decodeReferences('a&amp;\r\nb&#13;')).toBe('a&\r\nb\r');
  });

  it('returns text without references as it is', () => {
    const text = 'plain';
    expect(decodeReferences(text)).toBe(text);
  });
});

describe('attribute-value normalization (§3.3.3)', () => {
  it('turns each literal whitespace character into a space, CRLF into one', () => {
    expect(parseEveryWay('<a b="1\t2\n3\r\n4\r5"/>')).toBe('<a b="1 2 3 4 5"></a>');
    expect(normalizeAttributeValue('a\r\nb', false, false)).toBe('a b');
  });

  it('keeps whitespace written as character references', () => {
    expect(parseEveryWay('<a b="&#9;&#10;&#13;&#32;"/>')).toBe('<a b="&#9;&#10;&#13; "></a>');
  });

  it('does not collapse or trim spaces in CDATA attributes', () => {
    expect(parseEveryWay('<a b="  x  y  "/>')).toBe('<a b="  x  y  "></a>');
  });

  it('normalizes NEL and LS to a space in XML 1.1', () => {
    expect(parseEveryWay('<?xml version="1.1"?><a b="1\u00852\u20283"/>')).toBe('<a b="1 2 3"></a>');
  });

  it('normalizes whitespace in long attribute values', () => {
    const long = 'v'.repeat(80);
    expect(parseEveryWay(`<a b="${long}\t${long}"/>`)).toBe(`<a b="${long} ${long}"></a>`);
  });

  it('decodes references after normalizing, so a reference to the quote does not end the value', () => {
    expect(parseEveryWay('<r a="x&#10;y\tz\r\nw" b="&#34;&quot;" c="&lt;&amp;"/>')).toBe(
      '<r a="x&#10;y z w" b="&quot;&quot;" c="&lt;&amp;"></r>'
    );
  });

  it('turns each whitespace character of replacement text into a space, CR LF into two', () => {
    expect(normalizeAttributeValue('a\r\nb\tc', false, true)).toBe('a  b c');
  });

  it('turns NEL and LS into a space in XML 1.1 values', () => {
    expect(normalizeAttributeValue('a\u0085b\u2028c\r\u0085d', true, false)).toBe('a b c d');
    expect(normalizeAttributeValue('a\u0085b', false, false)).toBe('a\u0085b');
  });
});

/** The raw index of each of the first `count` normalized indexes. */
function rawIndexes(raw: string, version11: boolean, count: number): number[] {
  const rawIndexOf = rawIndexMapper(raw, version11);
  return Array.from({ length: count }, (_, index) => rawIndexOf(index));
}

describe('rawIndexMapper', () => {
  it('maps each normalized index back to the text as given, past every CR LF (§2.11)', () => {
    // Normalized as a\nb\nc\nd: each index moves one further on for every CR LF before it.
    expect(rawIndexes('a\r\nb\rc\r\nd', false, 7)).toEqual([0, 2, 3, 4, 5, 7, 8]);
  });

  it('counts CR NEL as one line end in XML 1.1, and maps text without CR LF to itself (XML 1.1 §2.11)', () => {
    expect(rawIndexes('a\r\u0085b', true, 3)).toEqual([0, 2, 3]);
    expect(rawIndexes('a\r\u0085b', false, 3)).toEqual([0, 1, 2]);
    expect(rawIndexes('a\nb', false, 3)).toEqual([0, 1, 2]);
  });
});
