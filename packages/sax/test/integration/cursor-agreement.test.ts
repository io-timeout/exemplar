import { readEveryWay } from '@test/helpers/agreement.ts';
import { canonicalHandler, canonicalOf } from '@test/helpers/canonical.ts';
import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { SAXParser } from '@/index.ts';

/** A table row: what the document shows, the document, and its first canonical form. */
type Case = [string, string, string];

describe('SAX agrees with the cursor: the prolog (§2.8)', () => {
  it.each<Case>([
    [
      'an XML declaration with every pseudo-attribute',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n\t <root/>',
      '<root></root>',
    ],
    [
      'single quotes and spaces around = in the declaration',
      "<?xml version = '1.0' encoding = 'utf-8' ?><a/>",
      '<a></a>',
    ],
    ['an XML 1.1 declaration', '<?xml version="1.1"?><a/>', '<a></a>'],
    ['whitespace before the root', ' \t\r\n<r/>', '<r></r>'],
    [
      'a PI whose data holds an unbalanced quote',
      '<?has unbalanced "quotes?><xml>body</xml>',
      '<?has unbalanced "quotes?><xml>body</xml>',
    ],
    ['comments and PIs before and after the root', '<!--c--><?p d?><a/><!--e--><?q?>', '<?p d?><a></a><?q ?>'],
    [
      'a PI keeping trailing whitespace but not the space after its target (§2.6)',
      '<?pi   a  ?><r/>',
      '<?pi a  ?><r></r>',
    ],
    [
      'a PI target that only starts with xml',
      '<?xml-stylesheet href="s.css"?><a/>',
      '<?xml-stylesheet href="s.css"?><a></a>',
    ],
    ['a root element named xml', '<xml/>', '<xml></xml>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });
});

describe('SAX agrees with the cursor: the DOCTYPE and internal subset (§2.8, §3.3, §4.2)', () => {
  it.each<Case>([
    ['a DOCTYPE with no subset', '<!DOCTYPE root><root/>', '<root></root>'],
    ['an empty internal subset', '<!DOCTYPE svg []><svg/>', '<svg></svg>'],
    ['an entity that is never used', '<!DOCTYPE svg [ <!ENTITY ns "http://x/"> ]><svg/>', '<svg></svg>'],
    ['a quote and ] inside a comment in the subset', "<!DOCTYPE svg [<!--a ' and ] b-->]><svg/>", '<svg></svg>'],
    [
      'a declaration after a comment holding ] and a quote',
      '<!DOCTYPE s [<!--x ] \'--> <!ENTITY e "v"> ]><s>&e;</s>',
      '<s>v</s>',
    ],
    ['a comment with a single dash in the subset', '<!DOCTYPE r [<!--a-x-->]><r/>', '<r></r>'],
    [
      'a comment and PI between the DOCTYPE and the root',
      '<!DOCTYPE root [<!ELEMENT root ANY>]><!--note--><?work now?><root/>',
      '<?work now?><root></root>',
    ],
    [
      '> inside an entity value',
      '<!DOCTYPE root [<!ENTITY x "a>b"><!-- c -->]><root>&x;</root>',
      '<root>a&gt;b</root>',
    ],
    [
      'a root that differs from the DOCTYPE name, which is only a validity error',
      '<!DOCTYPE expected><actual/>',
      '<actual></actual>',
    ],
    ['PIs in the internal subset, which are not content', '<!DOCTYPE a [<?pi in the DTD?>]><a/>', '<a></a>'],
    [
      'attribute defaults (§3.3.2)',
      '<!DOCTYPE a [<!ATTLIST a x CDATA "d" y CDATA #FIXED "f" z CDATA #IMPLIED>]><a/>',
      '<a x="d" y="f"></a>',
    ],
    ['a written value overriding the default', '<!DOCTYPE a [<!ATTLIST a x CDATA "d">]><a x="w"/>', '<a x="w"></a>'],
    [
      'tokenized values normalized further (§3.3.3)',
      '<!DOCTYPE a [<!ATTLIST a t NMTOKENS #IMPLIED i ID #IMPLIED>]><a t="  x   y " i=" id1 "/>',
      '<a i="id1" t="x y"></a>',
    ],
    [
      'a CDATA attribute keeping its spaces',
      '<!DOCTYPE a [<!ATTLIST a c CDATA #IMPLIED>]><a c="  x   y "/>',
      '<a c="  x   y "></a>',
    ],
    [
      'a parameter entity between declarations',
      `<!DOCTYPE a [<!ENTITY % p "<!ENTITY e 'pv'>"> %p;]><a>&e;</a>`,
      '<a>pv</a>',
    ],
    [
      'the first of two declarations binding (§4.2)',
      '<!DOCTYPE a [<!ENTITY e "1"><!ENTITY e "2">]><a>&e;</a>',
      '<a>1</a>',
    ],
    [
      'amp and lt redeclared as §4.6 asks',
      '<!DOCTYPE a [<!ENTITY amp "&#38;#38;"><!ENTITY lt "&#38;#60;">]><a>&amp;&lt;</a>',
      '<a>&amp;&lt;</a>',
    ],
    [
      'standalone="yes" with internal declarations',
      '<?xml version="1.0" standalone="yes"?><!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>',
      '<a>x</a>',
    ],
    [
      'an unparsed entity named by an ENTITY attribute',
      '<!DOCTYPE a [<!NOTATION n SYSTEM "n"><!ENTITY u SYSTEM "u.gif" NDATA n><!ATTLIST a pic ENTITY #IMPLIED>]><a pic="u"/>',
      '<a pic="u"></a>',
    ],
    ['16 KiB of whitespace in the subset', `<!DOCTYPE root [${' '.repeat(16_384)}]><root/>`, '<root></root>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });
});

describe('SAX agrees with the cursor: elements (§3.1)', () => {
  it.each<Case>([
    [
      'a space before />, and text of punctuation',
      '<root><child><haha /></child><monkey>=(|)</monkey></root>',
      '<root><child><haha></haha></child><monkey>=(|)</monkey></root>',
    ],
    ['names that differ only in case', '<DIV><div/><Div></Div></DIV>', '<DIV><div></div><Div></Div></DIV>'],
    [
      'names with ., -, _ and digits',
      '<dateTime.iso8601><_a/><b-1/></dateTime.iso8601>',
      '<dateTime.iso8601><_a></_a><b-1></b-1></dateTime.iso8601>',
    ],
    [
      'an element named script, which is ordinary',
      '<xml><script>hello world</script></xml>',
      '<xml><script>hello world</script></xml>',
    ],
    ['whitespace around = and before > of an end tag', '<root a = "x"></root   >', '<root a="x"></root>'],
    ['> alone in content', '<doc><e/>></doc>', '<doc><e></e>&gt;</doc>'],
    ['an end tag after an empty-element tag', '<a><b/><b></b></a>', '<a><b></b><b></b></a>'],
    ['Cyrillic names and text', '<Р>тест</Р>', '<Р>тест</Р>'],
    ['names and values outside the BMP', '<𐀀 a𐀀="ok">😀</𐀀>', '<𐀀 a𐀀="ok">😀</𐀀>'],
    ['a name with U+00B7 and accented letters', '<a·b é="1" À="2"/>', '<a·b À="2" é="1"></a·b>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });

  it.each([
    '_',
    'A',
    'z',
    '\u00C0',
    '\u00D8',
    '\u00F8',
    '\u0370',
    '\u037F',
    '\u200C',
    '\u2070',
    '\u2C00',
    '\u3001',
    '\uF900',
    '\uFDF0',
    '\u{10000}',
  ])('takes %s as a name start character (§2.3 [4])', async (c) => {
    expect(await readEveryWay(`<${c}/>`)).toBe(`<${c}></${c}>`);
  });

  it.each(['0', '-', '.', '\u00B7', '\u0300', '\u203F'])(
    'takes %s as a name character after the first (§2.3 [4a])',
    async (c) => {
      expect(await readEveryWay(`<a${c} a${c}="1"/>`)).toBe(`<a${c} a${c}="1"></a${c}>`);
    }
  );

  it('takes a colon as a name start character without namespace processing', async () => {
    expect(await readEveryWay('<:a :b="1"/>', { namespaceAware: false })).toBe('<:a :b="1"></:a>');
  });

  it('reads nesting deeper than the default limit when the limit allows it', async () => {
    const depth = 1100;
    const xml = '<x>'.repeat(depth) + '</x>'.repeat(depth);
    expect(await readEveryWay(xml, { limits: { elementDepth: depth } })).toBe(xml);
  });

  it('reads 16 KiB of whitespace before />', async () => {
    expect(await readEveryWay(`<r${' '.repeat(16_384)}/>`)).toBe('<r></r>');
  });
});

describe('SAX agrees with the cursor: attributes (§3.1)', () => {
  it.each<Case>([
    ['values in either kind of quote, holding the other', `<r a='x"y' b="x'y"/>`, `<r a="x&quot;y" b="x'y"></r>`],
    ['= and > in values', '<r L="abc=ABC" id="a>b"/>', '<r L="abc=ABC" id="a&gt;b"></r>'],
    ['any whitespace between attributes', '<r a="1"\n b="2"\t c="3"  d="4"/>', '<r a="1" b="2" c="3" d="4"></r>'],
    [
      'names that are Object.prototype members',
      '<r __proto__="1" constructor="2" toString="3" hasOwnProperty="4"/>',
      '<r __proto__="1" constructor="2" hasOwnProperty="4" toString="3"></r>',
    ],
    [
      'the hash-colliding names aahorqvqp and aupstazkt',
      '<r aahorqvqp="1" aupstazkt="2"/>',
      '<r aahorqvqp="1" aupstazkt="2"></r>',
    ],
    ['an empty value', '<r a=""/>', '<r a=""></r>'],
    ['a value in single quotes', "<root length='12345'></root>", '<root length="12345"></root>'],
    ['= in a single-quoted value', "<r l='a=b'/>", '<r l="a=b"></r>'],
    ['spaces around =', '<r a = "1"/>', '<r a="1"></r>'],
    ['characters outside ASCII in values', '<P foo="误" rain="☂"/>', '<P foo="误" rain="☂"></P>'],
    ['a private-use character', '<r a="\uE000">\uE000</r>', '<r a="\uE000">\uE000</r>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });

  it('reads 256 distinct attributes when the limit allows them', async () => {
    const pairs = Array.from({ length: 256 }, (_, i) => `a${i}="${i}"`);
    const result = await readEveryWay(`<r ${pairs.join(' ')}/>`, { limits: { attributesPerElement: 256 } });
    expect(result.match(/ a\d+="/g)).toHaveLength(256);
  });

  it.each([15, 16, 17, 32, 64, 199])('reads %i distinct attributes', async (n) => {
    const names = Array.from({ length: n }, (_, i) => `a${i}`);
    const pairs = names.map((name) => `${name}="${name}"`);
    const sorted = names.toSorted().map((name) => `${name}="${name}"`);
    expect(await readEveryWay(`<r ${pairs.join(' ')}/>`)).toBe(`<r ${sorted.join(' ')}></r>`);
  });

  it('finds no false duplicates in elements of 15 to 33 attributes in a row', async () => {
    const attributes = (n: number) => Array.from({ length: n }, (_, i) => `n${n}x${i}="${i}"`).join(' ');
    const elements = Array.from({ length: 19 }, (_, i) => '<e ' + attributes(15 + i) + '/>');
    expect(await readEveryWay(`<r>${elements.join('')}</r>`)).toMatch(/^<r><e /);
  });
});

describe('SAX agrees with the cursor: attribute-value normalization (§3.3.3)', () => {
  it.each<Case>([
    ['a reference to " that does not end the value', '<doc a="&#34;"/>', '<doc a="&quot;"></doc>'],
    ['U+FEFF by reference and written', '<P a="&#xFEFF;" b="\uFEFF"/>', '<P a="\uFEFF" b="\uFEFF"></P>'],
    ['&amp; and &lt;', '<r a="&lt;&amp;" b="&amp;"/>', '<r a="&lt;&amp;" b="&amp;"></r>'],
    [
      'tab, LF and CR written become spaces; by reference they stay',
      '<r a="a\tb\nc\rd" b="a&#9;b&#10;c&#13;d"/>',
      '<r a="a b c d" b="a&#9;b&#10;c&#13;d"></r>',
    ],
    ['CRLF as one space', '<r a="a\r\nb"/>', '<r a="a b"></r>'],
    ['references, tabs and CRLF together', '<r a="x&#10;y\tz\r\nw"/>', '<r a="x&#10;y z w"></r>'],
    [
      'entities in values and content, nested',
      `<!DOCTYPE A [<!ENTITY at "1"><!ENTITY t "2.&at;"><!ENTITY el '<B x="&at;.3"/>'>]><A x="&at;.2">&t;&el;</A>`,
      '<A x="1.2">2.1<B x="1.3"></B></A>',
    ],
    [
      'a tab in entity text, which becomes a space',
      '<!DOCTYPE a [<!ENTITY t "a&#9;b">]><a v="&t;"/>',
      '<a v="a b"></a>',
    ],
    [
      'a reference to a tab in entity text, which stays',
      '<!DOCTYPE a [<!ENTITY t "a&#38;#9;b">]><a v="&t;"/>',
      '<a v="a&#9;b"></a>',
    ],
    ['a default value normalized too', '<!DOCTYPE a [<!ATTLIST a v CDATA "x\ty">]><a/>', '<a v="x y"></a>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });
});

describe('SAX agrees with the cursor: character data (§2.4)', () => {
  it.each<Case>([
    ['whitespace-only text, all of it', '<doc> \n<e/> </doc>', '<doc> &#10;<e></e> </doc>'],
    ['text around a child', '<r>a<c/>b</r>', '<r>a<c></c>b</r>'],
    ['text either side of an element', '<root> before <b/> after </root>', '<root> before <b></b> after </root>'],
    ['escaped markup, which stays text', '<r>&lt;![CDATA[ x ]]&gt;</r>', '<r>&lt;![CDATA[ x ]]&gt;</r>'],
    ['text after a comment holding quotes', `<doc><!-- f='FO"O' --> b="B" ></doc>`, '<doc> b=&quot;B&quot; &gt;</doc>'],
    [
      'references, an escaped reference and CDATA',
      '<mi>&#x398;&#920;&amp;#x398;<![CDATA[&#x398;]]></mi>',
      '<mi>ΘΘ&amp;#x398;&amp;#x398;</mi>',
    ],
    [
      'CDATA between text',
      '<item>Start<![CDATA[<xml>data</xml>]]>End</item>',
      '<item>Start&lt;xml&gt;data&lt;/xml&gt;End</item>',
    ],
    [']] and > apart', '<a>]] > ]]</a>', '<a>]] &gt; ]]</a>'],
    ['U+FEFF inside the root', '<div>\uFEFF</div>', '<div>\uFEFF</div>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });

  it('reads 16 KiB of text', async () => {
    const text = 'abcdefgh'.repeat(2048);
    expect(await readEveryWay(`<r>${text}</r>`)).toBe(`<r>${text}</r>`);
  });
});

describe('SAX agrees with the cursor: CDATA sections (§2.7)', () => {
  it.each<Case>([
    [
      'leading and trailing spaces kept',
      '<r><![CDATA[ this is character data  ]]></r>',
      '<r> this is character data  </r>',
    ],
    ['brackets inside', '<r><![CDATA[[[[[[[[[]]]]]]]]]]></r>', '<r>[[[[[[[[]]]]]]]]</r>'],
    ['two sections side by side', '<r><![CDATA[ a ]]><![CDATA[ b [] ]]></r>', '<r> a  b [] </r>'],
    ['markup characters as text', '<r><![CDATA[a > b <c> &amp;]]></r>', '<r>a &gt; b &lt;c&gt; &amp;amp;</r>'],
    ['line ends normalized (§2.11)', '<r><![CDATA[a\r\nb\rc]]></r>', '<r>a&#10;b&#10;c</r>'],
    ['an empty section', '<r>x<![CDATA[]]>y</r>', '<r>xy</r>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });

  it('reads a 1 MiB section', () => {
    const text = 'x'.repeat(1 << 20);
    const xml = `<r><![CDATA[${text}]]></r>`;
    const { handler, written } = canonicalHandler();
    new SAXParser().parse(xml, handler);
    expect(written()).toBe(`<r>${text}</r>`);
  });
});

describe('SAX agrees with the cursor: comments and PIs (§2.5, §2.6)', () => {
  it.each<Case>([
    [
      'a comment with line ends and a dash, between text',
      '<x>\n<!-- \n a single dash- in it\n-->\n<data/>\n</x>',
      '<x>&#10;&#10;<data></data>&#10;</x>',
    ],
    ['> and !>> in comments', '<!-- a > b --><r><!-- !>>> --></r>', '<r></r>'],
    ['a comment starting with a dash', '<!---a--><r/>', '<r></r>'],
    ['markup and references in a comment', '<r><!--a-x <b> &c; ]]>--></r>', '<r></r>'],
    ['a PI in content', '<r><?work now?></r>', '<r><?work now?></r>'],
    ['a PI target with . and -', '<r><?a.b-c d?></r>', '<r><?a.b-c d?></r>'],
    ['line ends in PI data', '<r><?p a\r\nb\rc?></r>', '<r><?p a\nb\nc?></r>'],
    ['markup in PI data', '<r><?p <a> &b; ]]> ?></r>', '<r><?p <a> &b; ]]> ?></r>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });
});

describe('SAX agrees with the cursor: references (§4.1, §4.4, §4.6)', () => {
  it.each<Case>([
    [
      'the predefined entities and character references',
      '<r>&amp;&apos;&gt;&lt;&quot;&#39;&#38;&#0123;&#x0130;</r>',
      `<r>&amp;'&gt;&lt;&quot;'&amp;{İ</r>`,
    ],
    ['references beyond the BMP', '<r>&#x1F600;&#x1f525;&#128578;&#x10FFFF;</r>', '<r>😀🔥🙂\u{10FFFF}</r>'],
    ['references in decimal and hexadecimal', '<r>&#169;&#x20AC;&#xD55C;&#x1F680;</r>', '<r>©€한🚀</r>'],
    ['leading zeros', '<r>&#00065;&#x000042;</r>', '<r>AB</r>'],
    ['references to whitespace', '<r>&#9;&#10;&#13;&#32;</r>', '<r>&#9;&#10;&#13; </r>'],
    ['a CR by reference surviving line-end normalization (§2.11)', '<r>&#xd;&#x0d;\n</r>', '<r>&#13;&#13;&#10;</r>'],
    ['references in an attribute', '<r a="&quot;&#65;&#x42;&apos;"/>', `<r a="&quot;AB'"></r>`],
    [
      'entity text holding escaped markup, which stays text',
      '<!DOCTYPE r [<!ENTITY e "&lt;t&gt;y&lt;/t&gt;">]><r>&e;</r>',
      '<r>&lt;t&gt;y&lt;/t&gt;</r>',
    ],
    [
      'entity text holding markup by reference, which becomes markup (§4.4.2)',
      '<!DOCTYPE r [<!ENTITY e "&#60;t>z&#60;/t>">]><r>&e;</r>',
      '<r><t>z</t></r>',
    ],
    [
      'a doubly escaped & (appendix D)',
      '<!DOCTYPE r [<!ENTITY product "StAX &#38;#38; XML">]><r a="&product;">&product;&amp;product;<![CDATA[&product;]]></r>',
      '<r a="StAX &amp; XML">StAX &amp; XML&amp;product;&amp;product;</r>',
    ],
    [
      'entity names with _, - and . (§2.3)',
      '<!DOCTYPE r [<!ENTITY _u "1"><!ENTITY u_s "2"><!ENTITY d-a "3"><!ENTITY d.o "4">]><r>&_u;&u_s;&d-a;&d.o;</r>',
      '<r>1234</r>',
    ],
    ['&amp; not read again', '<r>&amp;lt;</r>', '<r>&amp;lt;</r>'],
    [
      'entities nested three deep',
      '<!DOCTYPE r [<!ENTITY a "[&b;]"><!ENTITY b "(&c;)"><!ENTITY c "c">]><r>&a;</r>',
      '<r>[(c)]</r>',
    ],
    [
      'an entity holding elements, comments, PIs and CDATA',
      '<!DOCTYPE r [<!ENTITY e "<a x=\'1\'>t<!--c--><?p d?><![CDATA[<]]></a>">]><r>&e;&e;</r>',
      '<r><a x="1">t<?p d?>&lt;</a><a x="1">t<?p d?>&lt;</a></r>',
    ],
    [
      'an entity used for an attribute value with a reference to <',
      '<!DOCTYPE r [<!ENTITY e "&#38;#60;">]><r a="&e;"/>',
      '<r a="&lt;"></r>',
    ],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });

  it('expands entities known in advance (the entities option)', async () => {
    expect(await readEveryWay('<r>&nbsp;&copy;</r>', { entities: { nbsp: '\u00A0', copy: '©' } })).toBe(
      '<r>\u00A0©</r>'
    );
  });

  it('expands a quadratic number of characters within the limits', async () => {
    const xml = `<!DOCTYPE r [<!ENTITY a "${'x'.repeat(1000)}">]><r>${'&a;'.repeat(50)}</r>`;
    expect(await readEveryWay(xml)).toBe(`<r>${'x'.repeat(50_000)}</r>`);
  });
});

describe('SAX agrees with the cursor: line ends (§2.11)', () => {
  it.each<Case>([
    ['CRLF and CR in content becoming LF', '<r>x\r\ny\rz</r>', '<r>x&#10;y&#10;z</r>'],
    [
      'line ends in tags and between attributes',
      '<r a="1"\r\n b="2">\r  <c/>\n</r>',
      '<r a="1" b="2">&#10;  <c></c>&#10;</r>',
    ],
    ['CR at the end of text before a tag', '<r>a\r<b/>\r</r>', '<r>a&#10;<b></b>&#10;</r>'],
    ['NEL and LS as ordinary characters in XML 1.0', '<r>a\u0085b\u2028c</r>', '<r>a\u0085b\u2028c</r>'],
    [
      'NEL, CR NEL and LS as line ends in XML 1.1',
      '<?xml version="1.1"?><r>a\r\u0085b\u0085c\u2028d\r\ne</r>',
      '<r>a&#10;b&#10;c&#10;d&#10;e</r>',
    ],
    ['NEL in an XML 1.1 attribute value as a space', '<?xml version="1.1"?><r a="x\u0085y"/>', '<r a="x y"></r>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });
});

describe('SAX agrees with the cursor: XML 1.1 (§2.2)', () => {
  it.each<Case>([
    [
      'C0 controls by reference',
      '<?xml version="1.1"?><r a="&#x1;">&#x1;&#xB;&#x1F;</r>',
      '<r a="\u0001">\u0001\u000B\u001F</r>',
    ],
    ['C1 controls by reference', '<?xml version="1.1"?><r>&#x80;&#x9F;</r>', '<r>\u0080\u009F</r>'],
    ['an XML 1.1 document with no 1.1 features', '<?xml version="1.1" encoding="UTF-8"?><r>text</r>', '<r>text</r>'],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml)).toBe(expected);
  });
});

describe('SAX agrees with the cursor under other options', () => {
  it('coalesces text, CDATA and entity text', async () => {
    const xml = '<!DOCTYPE r [<!ENTITY e "E">]><r>a<![CDATA[b]]>&e;c</r>';
    expect(await readEveryWay(xml, { coalescing: true })).toBe('<r>abEc</r>');
  });

  it('skips entity references when they are not replaced', async () => {
    const xml = '<!DOCTYPE r [<!ENTITY e "E">]><r>a&e;b&amp;</r>';
    expect(await readEveryWay(xml, { replaceEntityReferences: false })).toBe('<r>ab&amp;</r>');
  });

  it('reads without the structural checks', async () => {
    expect(await readEveryWay('<r a="1">t</r>', { checkWellFormedness: false })).toBe('<r a="1">t</r>');
  });

  it('copies strings', async () => {
    const xml = `<r a="${'v'.repeat(40)}">${'t'.repeat(40)}</r>`;
    expect(await readEveryWay(xml, { copyStrings: true })).toBe(xml);
  });

  it('reads namespace declarations as attributes with namespacePrefixes', async () => {
    expect(await readEveryWay('<r xmlns="urn:d" xmlns:p="urn:p" p:a="1"/>', { namespacePrefixes: true })).toBe(
      '<r p:a="1" xmlns="urn:d" xmlns:p="urn:p"></r>'
    );
  });

  it('gives SAX no whitespace outside the root, which the cursor reports when asked', () => {
    const xml = '\n<!--c-->\n<r> </r>\n';
    const options = { reportPrologWhitespace: true };
    expect(canonicalOf(new XMLInputFactory(options).createStreamReader(xml))).toBe('&#10;&#10;<r> </r>&#10;');
    const { handler, written } = canonicalHandler();
    new SAXParser(new XMLInputFactory(options)).parse(xml, handler);
    expect(written()).toBe('<r> </r>');
  });
});
