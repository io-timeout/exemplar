import { verdict } from '@test/helpers/lexical.ts';
import { errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType } from '@/index.ts';

/** The text of each comment in a document. */
function comments(xml: string): string[] {
  const r = reader(xml);
  const out: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) if (e === EventType.COMMENT) out.push(r.text());
  return out;
}

describe('start tags and attributes (§3.1)', () => {
  it('reads names case-sensitively, with space before /> allowed', () => {
    expect(parseEveryWay('<root><child><haha /></child><DIV>=(|)</DIV><dateTime.iso8601/></root>')).toBe(
      '<root><child><haha></haha></child><DIV>=(|)</DIV><dateTime.iso8601></dateTime.iso8601></root>'
    );
    expect(errorOf('<a></A>').code).toBe('WF_END_TAG_MISMATCH');
  });

  it('requires whitespace between attributes (§3.1 [40])', () => {
    expect(errorOf('<a b="1"c="2"/>')).toMatchObject({ code: 'WF_TAG', column: 9 });
  });

  it('allows whitespace around = and before > in tags, of any kind and length', () => {
    expect(parseEveryWay('<a b = "1" ></a >')).toBe('<a b="1"></a>');
    expect(parseEveryWay('<r a="1"\t b="2"\r\n c="3"\n/>')).toBe('<r a="1" b="2" c="3"></r>');
    expect(parseEveryWay(`<r a="1"${' '.repeat(4000)}/>`)).toBe('<r a="1"></r>');
  });

  it('allows =, > and the other quote inside a value', () => {
    expect(parseEveryWay('<r L="abc=ABC" id="a>b" f=\'FO"O\' g="FO\'O"/>')).toBe(
      '<r L="abc=ABC" f="FO&quot;O" g="FO\'O" id="a&gt;b"></r>'
    );
  });

  it('takes attribute names such as __proto__ as ordinary names', () => {
    expect(parseEveryWay('<r __proto__="1" constructor="2" toString="3" hasOwnProperty="4"/>')).toBe(
      '<r __proto__="1" constructor="2" hasOwnProperty="4" toString="3"></r>'
    );
  });

  it('requires quotes around attribute values', () => {
    expect(errorOf('<a b=1/>').code).toBe('WF_ATTRIBUTE');
    expect(errorOf('<svg width=20px height=20px />')).toMatchObject({ code: 'WF_ATTRIBUTE', column: 12 });
  });

  it('rejects < in an attribute value (§3.1 WFC: No < in Attribute Values)', () => {
    expect(errorOf('<a b="<"/>').code).toBe('WF_LT_IN_ATTRIBUTE');
    expect(errorOf('<r a="bad<value"/>')).toMatchObject({ code: 'WF_LT_IN_ATTRIBUTE', column: 10 });
  });

  it.each([
    ['an attribute name that starts with =', '<r =a="1"/>', 'WF_TAG'],
    ['an attribute name that starts with .', '<r .a="1"/>', 'WF_TAG'],
    ['an attribute name that starts with $', '<r $a="1"/>', 'WF_TAG'],
    ['< where an attribute name should be', '<r <a="1"/>', 'WF_TAG'],
    ['an attribute name that starts with ☂', '<r ☂a="1"/>', 'WF_TAG'],
    ['☂ in an attribute name', '<r a☂="1"/>', 'WF_ATTRIBUTE'],
    ['an attribute without a value', '<root attrib>', 'WF_ATTRIBUTE'],
    ['an attribute without a value before another', '<r a b="1"/>', 'WF_ATTRIBUTE'],
    ['an attribute without a value before a line end', '<r a\nb="1"/>', 'WF_ATTRIBUTE'],
    ['an unquoted value before another attribute', '<r a=value b="1"/>', 'WF_ATTRIBUTE'],
    ['a value closed by the other quote', '<r a="1\' b="2"/>', 'WF_TAG'],
    ['a value that never closes', '<r a=\'1" b="2"/>', 'WF_UNEXPECTED_END'],
    ['a value that runs to the end', '<e foo="FOO>', 'WF_UNEXPECTED_END'],
    ['a value that runs into markup', '<tag a="1\'>\nhi\n<![CDATA[c]]>\n</tag>', 'WF_LT_IN_ATTRIBUTE'],
    ['a form feed between attributes, which is not S', '<DIV\fa="B"></DIV>', 'WF_TAG'],
    ['a vertical tab between attributes', '<DIV\va="B"></DIV>', 'WF_TAG'],
    ['> inside an attribute name', '<doc><e fo>o="F"/></doc>', 'WF_ATTRIBUTE'],
    ['/ not followed by >', '<r / >', 'WF_TAG'],
    ['an attribute name that ends at /', '<root id />', 'WF_ATTRIBUTE'],
  ])('rejects %s', (_, xml, code) => {
    expect(errorOf(xml).code).toBe(code);
  });

  it.each([
    ['a name that starts with a digit', '<1root/>', 'WF_NAME'],
    ['a name that starts with =', '<=div></=div>', 'WF_NAME'],
    ['= after a name', '<div=></div=>', 'WF_TAG'],
    ['$ in a name', '<a$uri:foo xmlns:a$uri="u"/>', 'WF_TAG'],
    ['< where a name continues', '<not<quite<xml', 'WF_TAG'],
    ['< followed by a space', '<script>if (1 < 0) {}</script>', 'WF_NAME'],
    ['< among references', '<r>&lt; < &gt;</r>', 'WF_NAME'],
    ['a start tag cut short', '<open', 'WF_UNEXPECTED_END'],
    ['a start tag cut short after /', '<open /', 'WF_UNEXPECTED_END'],
    ['a start tag cut short after the root', '<root/><f', 'WF_UNEXPECTED_END'],
  ])('rejects %s', (_, xml, code) => {
    expect(errorOf(xml).code).toBe(code);
  });

  it('reads names beyond ASCII, the fifth edition way (§2.3 [4])', () => {
    expect(parseEveryWay('<Р>тест</Р>')).toBe('<Р>тест</Р>');
    expect(parseEveryWay('<\u{10000} a\u{10000}="ok" é="1"/>')).toBe('<\u{10000} a\u{10000}="ok" é="1"></\u{10000}>');
    expect(parseEveryWay('<a·b P="误" rain="☂"/>')).toBe('<a·b P="误" rain="☂"></a·b>');
  });

  it.each(['A', 'z', '_', 'À', 'Ø', 'ø', 'Ͱ', 'Ϳ', '‌', '⁰', 'Ⰰ', '、', '豈', 'ﷰ', '\u{10000}'])(
    'lets %s start an element name',
    (c) => {
      expect(parseEveryWay(`<${c}/>`)).toBe(`<${c}></${c}>`);
    }
  );

  it.each(['0', '-', '.', '·', '̀', '‿'])('lets %s follow the first character of a name', (c) => {
    expect(parseEveryWay(`<a${c}/>`)).toBe(`<a${c}></a${c}>`);
  });

  it.each(['̳', '×', '\u{F0000}', '￾', '9'])('does not let %s start an element name', (c) => {
    expect(errorOf(`<${c}/>`).code).toBe('WF_NAME');
  });

  it('lets a colon start a name when namespaceAware is off', () => {
    expect(parseEveryWay('<:/>', { namespaceAware: false })).toBe('<:></:>');
  });
});

describe('end tags (§3.1 [42])', () => {
  it('allows whitespace before >, and nothing else', () => {
    expect(parseEveryWay('<a><b></b ></a\n>')).toBe('<a><b></b></a>');
    expect(errorOf('<div></div \u000F>').code).toBe('WF_TAG');
    expect(errorOf('<r></ r>').code).toBe('WF_NAME');
  });

  it('rejects an end tag cut short, or before one that matches', () => {
    expect(errorOf('<root></rof').code).toBe('WF_UNEXPECTED_END');
    expect(errorOf('<root></rof</root>').code).toBe('WF_END_TAG_MISMATCH');
    expect(errorOf('<doc><e>/></doc>').code).toBe('WF_END_TAG_MISMATCH');
  });

  it('reads > after an end tag as text', () => {
    expect(parseEveryWay('<doc><e/>></doc>')).toBe('<doc><e></e>&gt;</doc>');
  });
});

describe('comments (§2.5)', () => {
  it('rejects -- inside a comment, and a comment ending in --->', () => {
    expect(errorOf('<a><!-- a -- b --></a>').code).toBe('WF_COMMENT');
    expect(errorOf('<a><!-- a ---></a>').code).toBe('WF_COMMENT');
    expect(errorOf('<!--a--b--><r/>').code).toBe('WF_COMMENT');
  });

  it('allows a single -, > and line ends inside a comment, and keeps its text', () => {
    expect(comments('<x>\n<!-- \n a single dash- in it\n--><!-- a > b --><!-- !>>> --><!----></x>')).toEqual([
      ' \n a single dash- in it\n',
      ' a > b ',
      ' !>>> ',
      '',
    ]);
  });

  it('rejects a comment that is cut short or does not open with <!--', () => {
    expect(errorOf('<!-- HELLO').code).toBe('WF_UNEXPECTED_END');
    expect(errorOf('<!- HELLO').code).toBe('WF_MARKUP');
    expect(errorOf('<a><!---></a>').code).toBe('WF_UNEXPECTED_END');
  });
});

describe('processing instructions (§2.6)', () => {
  it('rejects a PI target that matches xml in any case', () => {
    expect(errorOf('<a><?XmL x?></a>').code).toBe('WF_PI_TARGET_XML');
  });

  it('requires whitespace between the PI target and its data', () => {
    expect(errorOf('<a><?p?x?></a>').code).toBe('WF_PI');
    expect(parseEveryWay('<a><?p?></a>')).toBe('<a><?p ?></a>');
  });

  it('requires a target right after <?', () => {
    expect(errorOf('<? QUESTION ?><a/>').code).toBe('WF_PI');
    expect(errorOf('<?1bad?><r/>').code).toBe('WF_PI');
    expect(errorOf('<? QUESTION').code).toBe('WF_PI');
  });

  it('keeps the data after the whitespace that follows the target, quotes and trailing spaces included', () => {
    expect(parseEveryWay('<?has unbalanced "quotes?><xml>body</xml>')).toBe(
      '<?has unbalanced "quotes?><xml>body</xml>'
    );
    expect(parseEveryWay('<r><?pi  a  ?><?work now?></r>')).toBe('<r><?pi a  ?><?work now?></r>');
  });

  it('rejects a PI cut short', () => {
    expect(errorOf('<root><?pi ').code).toBe('WF_UNEXPECTED_END');
  });
});

describe('CDATA sections (§2.7)', () => {
  it('reads CDATA sections as character data, with ]]> only at the end', () => {
    expect(parseEveryWay('<a><![CDATA[<&]]]></a>')).toBe('<a>&lt;&amp;]</a>');
    expect(errorOf('<a><![CDATA[x</a>').code).toBe('WF_UNEXPECTED_END');
  });

  it('keeps markup, references, brackets and whitespace literally', () => {
    expect(parseEveryWay('<r><![CDATA[ a <b> c &amp; ]]><![CDATA[[[[[[[[[]]]]]]]]]]><![CDATA[]]></r>')).toBe(
      '<r> a &lt;b&gt; c &amp;amp; [[[[[[[[]]]]]]]]</r>'
    );
    expect(parseEveryWay('<mi>&#x398;&#920;&amp;#x398;<![CDATA[&#x398;]]></mi>')).toBe(
      '<mi>ΘΘ&amp;#x398;&amp;#x398;</mi>'
    );
  });

  it('reads a large section however it arrives', () => {
    const content = 'data '.repeat(13_000);
    expect(parseEveryWay(`<r><![CDATA[${content}]]></r>`)).toBe(`<r>${content}</r>`);
  });

  it('rejects a section cut short', () => {
    expect(errorOf('<root><![CDATA[').code).toBe('WF_UNEXPECTED_END');
  });
});

describe('character data (§2.4)', () => {
  it('rejects ]]> in character data', () => {
    expect(errorOf('<a>]]></a>')).toMatchObject({ code: 'WF_CDATA_END_IN_TEXT', line: 1, column: 4 });
    expect(errorOf('<a>a]]>b</a>')).toMatchObject({ code: 'WF_CDATA_END_IN_TEXT', column: 5 });
    expect(parseEveryWay('<a>]] ]></a>')).toBe('<a>]] ]&gt;</a>');
  });

  it('reads what only looks like markup as text', () => {
    expect(parseEveryWay('<r>&lt;![CDATA[ x ]]&gt;</r>')).toBe('<r>&lt;![CDATA[ x ]]&gt;</r>');
    expect(parseEveryWay('<doc><!-- f=\'FO"O\' --> b="B" ></doc>')).toBe('<doc> b=&quot;B&quot; &gt;</doc>');
  });

  it('reads text around elements in document order', () => {
    expect(parseEveryWay('<item>Start<![CDATA[<xml>data</xml>]]>End</item>')).toBe(
      '<item>Start&lt;xml&gt;data&lt;/xml&gt;End</item>'
    );
    expect(parseEveryWay('<root> before <b/> after </root>')).toBe('<root> before <b></b> after </root>');
  });
});

describe('markup after <! (§2.5, §2.7, §2.8)', () => {
  it('rejects markup after <! that is not a comment, CDATA section or DOCTYPE', () => {
    expect(errorOf('<a><!ELEMENT a ANY></a>').code).toBe('WF_MARKUP');
    expect(errorOf('<!ENTITY x "y"><r/>').code).toBe('WF_MARKUP');
    expect(errorOf('<doc><! foo="FO\'O" > x</doc>').code).toBe('WF_MARKUP');
    expect(errorOf('<!X').code).toBe('WF_MARKUP');
  });
});

describe('the DOCTYPE (§2.8)', () => {
  it('delimits the DOCTYPE and its internal subset', () => {
    const r = reader('<!DOCTYPE a PUBLIC "-//X//Y" "a.dtd" [<!ENTITY e "]>"> <!-- ] -->]><a/>');
    expect(r.next()).toBe(EventType.DTD);
    expect(r.doctype()).toMatchObject({
      name: 'a',
      publicId: '-//X//Y',
      systemId: 'a.dtd',
      internalSubset: '<!ENTITY e "]>"> <!-- ] -->',
    });
  });

  it('accepts every character PubidChar allows (§2.3 [13])', () => {
    const pubid = "-'()+,./:=?;!*#@$_% \r\nAZaz09";
    const r = reader(`<!DOCTYPE a PUBLIC "${pubid}" "a.dtd"><a/>`);
    r.next();
    expect(r.doctype().publicId).toBe(pubid);
  });

  it('rejects a public identifier with a character PubidChar does not allow (§2.3 [13])', () => {
    expect(errorOf('<!DOCTYPE a PUBLIC "a{b" "a.dtd"><a/>').code).toBe('WF_DOCTYPE');
    expect(errorOf('<!DOCTYPE a PUBLIC "a\tb" "a.dtd"><a/>').code).toBe('WF_DOCTYPE');
  });

  it('skips parameter-entity references, PIs and comments in the internal subset', () => {
    const subset = ' <!ENTITY % p ""> %p; <?pi data?> <!-- c --> <!ATTLIST a b CDATA "x>y"> ';
    const r = reader(`<!DOCTYPE a [${subset}]><a/>`);
    expect(r.next()).toBe(EventType.DTD);
    expect(r.doctype().internalSubset).toBe(subset);
    expect(errorOf('<!DOCTYPE a [ %p ]><a/>').code).toBe('WF_DOCTYPE');
    expect(errorOf('<!DOCTYPE a [ <![INCLUDE[ ]]> ]><a/>').code).toBe('WF_DOCTYPE');
  });

  it('does not end the subset or open a literal inside a comment or PI', () => {
    expect(parseEveryWay("<!DOCTYPE svg [<!--a ' and ] b-->]><svg/>")).toBe('<svg></svg>');
    expect(parseEveryWay('<!DOCTYPE s [<!--x ] \'--> <!ENTITY e "v"> ]><s>&e;</s>')).toBe('<s>v</s>');
    expect(parseEveryWay('<!DOCTYPE s [<?pi ]> \' ?><!ENTITY e "v">]><s>&e;</s>')).toBe('<s>v</s>');
    expect(parseEveryWay('<!DOCTYPE root [<!ENTITY x "a>b"><!-- c [ ] \' -->]><root>&x;</root>')).toBe(
      '<root>a&gt;b</root>'
    );
  });

  it('accepts an empty subset, a long one, and comments and PIs after the DOCTYPE', () => {
    expect(parseEveryWay('<!DOCTYPE svg []><svg/>')).toBe('<svg></svg>');
    expect(parseEveryWay(`<!DOCTYPE r [${' '.repeat(5000)}]><r/>`)).toBe('<r></r>');
    expect(parseEveryWay('<!DOCTYPE root [<!ELEMENT root ANY>]><!--note--><?work now?><root/>')).toBe(
      '<?work now?><root></root>'
    );
  });

  it('checks the internal subset for well-formedness', () => {
    expect(errorOf('<!DOCTYPE a [ x ]><a/>').code).toBe('WF_DOCTYPE');
    expect(errorOf('<!DOCTYPE a [<!-- a -- b -->]><a/>').code).toBe('WF_COMMENT');
    expect(errorOf('<!DOCTYPE root [<X>]><root/>').code).toBe('WF_DOCTYPE');
    expect(errorOf('<!DOCTYPE root [<!--a---x-->]><root/>').code).toBe('WF_COMMENT');
    expect(parseEveryWay('<!DOCTYPE root [<!--a-x-->]><root/>')).toBe('<root></root>');
  });

  it('rejects a DOCTYPE without a name, or cut short', () => {
    expect(errorOf('<!DOCTYPE ><root/>').code).toBe('WF_DOCTYPE');
    expect(errorOf('<!DOCTYPE root [').code).toBe('WF_UNEXPECTED_END');
  });
});

describe('references (§4.1)', () => {
  it('decodes the predefined entities and character references', () => {
    expect(parseEveryWay('<a b="&lt;&#65;&#x42;">&amp;&gt;&apos;&quot;&#x1F600;</a>')).toBe(
      '<a b="&lt;AB">&amp;&gt;\'&quot;😀</a>'
    );
  });

  it('decodes character references with leading zeros, outside the BMP and up to U+10FFFF', () => {
    expect(
      parseEveryWay('<r>&#00065;&#x000042;&#169;&#x20AC;&#xD55C;&#128578;&#x1F680;&#x10FFFF;&#0123;&#x0130;</r>')
    ).toBe('<r>AB©€한🙂🚀\u{10FFFF}{İ</r>');
    expect(parseEveryWay('<r a="&#9;&#10;&#13;&#32;">&#9;&#10;&#13;&#32;</r>')).toBe(
      '<r a="&#9;&#10;&#13; ">&#9;&#10;&#13; </r>'
    );
  });

  it('does not read the text of a reference again', () => {
    expect(parseEveryWay('<r a="&amp;lt;">&amp;amp;&amp;#38;</r>')).toBe('<r a="&amp;lt;">&amp;amp;&amp;#38;</r>');
  });

  it('rejects a reference without its ;', () => {
    expect(errorOf('<a>&amp </a>').code).toBe('WF_REFERENCE');
    expect(errorOf('<a>& </a>').code).toBe('WF_REFERENCE');
    expect(errorOf('<r>&broken</r>').code).toBe('WF_REFERENCE');
    expect(errorOf('<r a="&broken"/>').code).toBe('WF_REFERENCE');
  });

  it.each([
    ['a bare & in text', '<r>bare & value</r>'],
    ['a bare & in a value', '<a href="q?x=1&y=2&z=3"/>'],
    ['a name that starts with -', '<a>&-bad;</a>'],
    ['a name that starts with .', '<a>&.bad;</a>'],
  ])('rejects %s (§4.1 [68])', (_, xml) => {
    expect(errorOf(xml).code).toBe('WF_REFERENCE');
  });

  it.each([['&#-1;'], ['&#NaN;'], ['&#hash;'], ['&#12x;'], ['&#x1g;'], ['&#X58;'], ['&#Xd;'], ['&#;'], ['&#x;']])(
    'rejects the malformed character reference %s (§4.1 [66])',
    (reference) => {
      expect(errorOf(`<a>${reference}</a>`).code).toBe('WF_CHARACTER_REFERENCE');
      expect(errorOf(`<a b="${reference}"/>`).code).toBe('WF_CHARACTER_REFERENCE');
    }
  );

  it.each(['&#0;', '&#xD800;', '&#xDFFF;', '&#xFFFE;', '&#xFFFF;', '&#1114112;', '&#x110000;'])(
    'rejects %s in both versions (WFC: Legal Character)',
    (reference) => {
      expect(errorOf(`<a>${reference}</a>`).code).toBe('WF_CHARACTER_REFERENCE');
      expect(errorOf(`<?xml version="1.1"?><a>${reference}</a>`).code).toBe('WF_CHARACTER_REFERENCE');
    }
  );

  it.each(['&#x1;', '&#xB;', '&#x1F;', '&#3;'])('rejects %s in XML 1.0 and accepts it in XML 1.1', (reference) => {
    expect(errorOf(`<a>${reference}</a>`)).toMatchObject({ code: 'WF_CHARACTER_REFERENCE', column: 4 });
    expect(() => parseEveryWay(`<?xml version="1.1"?><a b="${reference}">${reference}</a>`)).not.toThrow();
  });

  it('rejects a malformed character reference in an entity value or attribute value, in XML 1.0 and 1.1', () => {
    for (const version of ['1.0', '1.1']) {
      const declaration = `<?xml version="${version}"?>`;
      expect(errorOf(`${declaration}<!DOCTYPE a [<!ENTITY e "&#;">]><a/>`).code).toBe('WF_CHARACTER_REFERENCE');
      expect(errorOf(`${declaration}<!DOCTYPE a [<!ENTITY e "&#x0$;">]><a/>`).code).toBe('WF_CHARACTER_REFERENCE');
      expect(errorOf(`${declaration}<a b="&#x;"/>`).code).toBe('WF_CHARACTER_REFERENCE');
    }
  });

  it('rejects a reference to an undeclared entity in a document with no DOCTYPE (WFC: Entity Declared)', () => {
    expect(errorOf('<a>&e;</a>')).toMatchObject({ code: 'WF_UNDECLARED_ENTITY', line: 1, column: 5 });
    expect(errorOf('<a b="&e;"/>').code).toBe('WF_UNDECLARED_ENTITY');
  });

  it.each(['&copy;', '&AMP;', '&QUOT;', '&Quot;', '&constructor;', '&_u;', '&u_s;', '&d-a;', '&d.o;'])(
    'reads %s as a well-formed reference to an entity that is not declared',
    (reference) => {
      expect(errorOf(`<a>${reference}</a>`).code).toBe('WF_UNDECLARED_ENTITY');
    }
  );
});

describe('locations', () => {
  it('counts lines at LF, CRLF and a lone CR (§2.11)', () => {
    expect(errorOf('<a>\n\r\n\r<b></a>')).toMatchObject({ line: 4, column: 6 });
  });

  it('counts NEL and LS as line ends in XML 1.1 only', () => {
    expect(errorOf('<?xml version="1.1"?><a>\u0085 <b></a>')).toMatchObject({ line: 3, column: 6 });
    expect(errorOf('<a>\u0085 <b></a>')).toMatchObject({ line: 1, column: 11 });
  });

  it('counts CR NEL as one line end in XML 1.1 (XML 1.1 §2.11)', () => {
    expect(errorOf('<?xml version="1.1"?><a>\r\u0085<b></a>')).toMatchObject({
      code: 'WF_END_TAG_MISMATCH',
      line: 2,
      column: 6,
    });
  });

  it('counts columns in UTF-16 code units', () => {
    expect(errorOf('<a>𝄞<b></a>')).toMatchObject({ line: 1, column: 11 });
  });

  it('gives each event the line and column where it starts', () => {
    const r = reader('<a>\n  <b x="1"/>\r\n  text</a>');
    const starts: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      const { line, column } = r.location();
      starts.push(`${e}@${line}:${column}`);
    }
    expect(starts).toEqual(['1@1:1', '4@1:4', '1@2:3', '2@2:3', '4@2:13', '2@3:7']);
  });

  it('gives an empty element’s start and end the same location, after mixed line ends', () => {
    const r = reader('<r a="1"\r\n b="2">\r  <c/>\n</r>');
    const starts: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      starts.push(`${e}@${r.location().line}:${r.location().column}`);
    }
    expect(starts).toEqual(['1@1:1', '4@2:8', '1@3:3', '2@3:3', '4@3:7', '2@4:1']);
  });

  it('keeps locations right when the buffer is compacted between chunks', () => {
    const line = `<b>${'x'.repeat(40)}</b>\n`;
    const xml = `<a>\n${line.repeat(50)}<c></a>`;
    expect(errorOf(xml)).toMatchObject({ code: 'WF_END_TAG_MISMATCH', line: 52, column: 6 });
  });

  it('gives offsets in the whole document, not the buffer', () => {
    const xml = `<a>${'x'.repeat(300)}<b>&#0;</b></a>`;
    expect(errorOf(xml)).toMatchObject({ offset: 306, column: 307 });
  });

  it('places errors the same whether a document arrives whole or split', () => {
    expect(verdict('<div>abcdefgh</div><x/>')).toBe('WF_SECOND_ROOT 1:20');
    expect(errorOf('<div>abcdefgh</div><x/>')).toMatchObject({ line: 1, column: 20 });
    expect(errorOf('<div>abcdefgh</div><x')).toMatchObject({ code: 'WF_UNEXPECTED_END', line: 1, column: 22 });
  });
});
