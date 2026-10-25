import { eventsEveryWay, parseAsyncEveryWay, parseAtEverySplit, parseEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { type InputOptions, XMLError } from '@/index.ts';

/** What reading a document every synchronous way gives: `accepted <canonical form>` or `rejected <code> at <line>:<column>`. */
function everyWay(read: () => string): string {
  try {
    return `accepted ${read()}`;
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    return `rejected ${error.code} at ${error.line}:${error.column}`;
  }
}

/** Documents the reader must accept, with their canonical form. */
const ACCEPTED: readonly (readonly [string, string])[] = [
  [
    '<root><child><haha /></child><monkey>=(|)</monkey></root>',
    '<root><child><haha></haha></child><monkey>=(|)</monkey></root>',
  ],
  ['<doc a="&#34;" b="&#xFEFF;" c="&amp;"/>', '<doc a="&quot;" b="\uFEFF" c="&amp;"></doc>'],
  ['<r a="a\tb\nc" d="a&#9;b&#10;c"/>', '<r a="a b c" d="a&#9;b&#10;c"></r>'],
  ['<r a="x\r\ny" b="1"\r\n c="2">\r  <c/>\n</r>', '<r a="x y" b="1" c="2">&#10;  <c></c>&#10;</r>'],
  ['<root a = "1"\t b=\'2\'\n/>', '<root a="1" b="2"></root>'],
  ['<e id="a>b" f="FO\'O" g=\'FO"O\'/>', '<e f="FO\'O" g="FO&quot;O" id="a&gt;b"></e>'],
  [
    '<root length="1" __proto__="2" constructor="3" toString="4" hasOwnProperty="5"/>',
    '<root __proto__="2" constructor="3" hasOwnProperty="5" length="1" toString="4"></root>',
  ],
  ['<r><![CDATA[ this is character data  ]]></r>', '<r> this is character data  </r>'],
  ['<r><![CDATA[[[[[[[[[]]]]]]]]]]></r>', '<r>[[[[[[[[]]]]]]]]</r>'],
  ['<r><![CDATA[a]]><![CDATA[b [] ]]></r>', '<r>ab [] </r>'],
  ['<r><![CDATA[a > b <c> & d]]></r>', '<r>a &gt; b &lt;c&gt; &amp; d</r>'],
  ['<item>Start<![CDATA[<xml>data</xml>]]>End</item>', '<item>Start&lt;xml&gt;data&lt;/xml&gt;End</item>'],
  ['<x>\n<!-- \n a single dash- in it\n-->\n<data/>\n</x>', '<x>&#10;&#10;<data></data>&#10;</x>'],
  ['<r><!-- a > b --><!-- !>>> --><!--a-x--></r>', '<r></r>'],
  ['<doc><!-- f=\'FO"O\' --> b="B" ></doc>', '<doc> b=&quot;B&quot; &gt;</doc>'],
  ['<r>&amp;&apos;&gt;&lt;&quot;&#39;&#38;&#0123;&#x0130;</r>', "<r>&amp;'&gt;&lt;&quot;'&amp;{İ</r>"],
  ['<r>&#x1F525;&#128578;&#x10FFFF;&#169;&#x20AC;&#xD55C;</r>', '<r>🔥🙂\u{10FFFF}©€한</r>'],
  ['<r>&#xd;&#x0d;\n&#9;&#32;</r>', '<r>&#13;&#13;&#10;&#9; </r>'],
  ['<r>a\r\nb\rc\n\r\n</r>', '<r>a&#10;b&#10;c&#10;&#10;</r>'],
  ['<r>&lt;![CDATA[ x ]]&gt;]]&gt;]</r>', '<r>&lt;![CDATA[ x ]]&gt;]]&gt;]</r>'],
  ['<doc><e/>></doc>', '<doc><e></e>&gt;</doc>'],
  ['<mi>&#x398;&#920;&amp;#x398;<![CDATA[&#x398;]]></mi>', '<mi>ΘΘ&amp;#x398;&amp;#x398;</mi>'],
  ['<Р>тест</Р>', '<Р>тест</Р>'],
  ['<𐀀 a𐀀="ok"/>', '<𐀀 a𐀀="ok"></𐀀>'],
  ['<a·b é="1" _x="2" dateTime.iso8601="3" À="4"/>', '<a·b _x="2" dateTime.iso8601="3" À="4" é="1"></a·b>'],
  ['<r p="误😀">误😀한글é</r>', '<r p="误😀">误😀한글é</r>'],
  ['<?work now?><r><?pi a  ?><?p\r\n data?></r><?after?>', '<?work now?><r><?pi a  ?><?p data?></r><?after ?>'],
  ['<?has unbalanced "quotes?><xml>body</xml>', '<?has unbalanced "quotes?><xml>body</xml>'],
  ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n\t <root/>', '<root></root>'],
  ['<?xml version="1.1"?><r a="x\u0085y">\u0085\u2028&#x1;</r>', '<r a="x y">&#10;&#10;\u0001</r>'],
  ['<f xmlns="A" xmlns:m="M" id="x" m:t="y"><m:g/><g xmlns=""/></f>', '<f id="x" m:t="y"><m:g></m:g><g></g></f>'],
  [
    '<r xmlns:p="urn:p"><p:a p:x="1"><p:b xmlns:p="urn:q" p:x="2"/></p:a></r>',
    '<r><p:a p:x="1"><p:b p:x="2"></p:b></p:a></r>',
  ],
  ['<!DOCTYPE svg [<!--a \' and ] b--><!ENTITY ns "http://x/">]><svg>&ns;</svg>', '<svg>http://x/</svg>'],
  [
    '<!DOCTYPE A [<!ENTITY at "1"><!ENTITY t "2.&at;"><!ENTITY el \'<B x="&at;.3"/>\'>]><A x="&at;.2">&t;&el;</A>',
    '<A x="1.2">2.1<B x="1.3"></B></A>',
  ],
  ['<!DOCTYPE a [<!ENTITY e "&lt;t&gt;y&lt;/t&gt;">]><a>&e;</a>', '<a>&lt;t&gt;y&lt;/t&gt;</a>'],
  ['<!DOCTYPE a [<!ENTITY e "&#60;t>z&#60;/t>">]><a>&e;</a>', '<a><t>z</t></a>'],
  [
    '<!DOCTYPE r [<!ENTITY product "StAX &#38;#38; XML">]><r a="&product;">&product;&amp;product;<![CDATA[&product;]]></r>',
    '<r a="StAX &amp; XML">StAX &amp; XML&amp;product;&amp;product;</r>',
  ],
  ['<!DOCTYPE r [<!ENTITY x "a>b"><!-- c [ ] \' --><?pi in dtd?>]><r>&x;</r>', '<r>a&gt;b</r>'],
  ['<!DOCTYPE r [<!ATTLIST r d CDATA "def" t NMTOKENS " a  b ">]><r t=" x  y "/>', '<r d="def" t="x y"></r>'],
  ['<!DOCTYPE r [<!ENTITY % p "<!ENTITY e \'pe\'>"> %p;]><r>&e;</r>', '<r>pe</r>'],
  ['<!DOCTYPE root><root/>', '<root></root>'],
  ['<!DOCTYPE root [<!ENTITY x "a>b"><!--a-x--><!-- c [ ] \' -->]><root>&x;</root>', '<root>a&gt;b</root>'],
  ['<doc> \n<e/> </doc>', '<doc> &#10;<e></e> </doc>'],
  ['<r>a &amp; b</r>', '<r>a &amp; b</r>'],
  ['<r>&#00065;&#x000042;</r>', '<r>AB</r>'],
  ['<root note="a > b"><child value="x"/></root>', '<root note="a &gt; b"><child value="x"></child></root>'],
  ['<xml><script>hello world</script></xml>', '<xml><script>hello world</script></xml>'],
  ['<?xml version="1.1"?><r>&#x3;&#x1F;&#xB;</r>', '<r>\u0003\u001F\u000B</r>'],
];

/** Documents the reader must reject, with the error code and where. */
const REJECTED: readonly (readonly [string, string])[] = [
  ['<r a="first"b="second"/>', 'WF_TAG at 1:13'],
  ['<svg width=20px height=20px />', 'WF_ATTRIBUTE at 1:12'],
  ['<root attrib></root>', 'WF_ATTRIBUTE at 1:13'],
  ['<span id="hello" id="there"></span>', 'WF_DUPLICATE_ATTRIBUTE at 1:18'],
  ['<a href="q?x=1&y=2"/>', 'WF_REFERENCE at 1:17'],
  ['<r a="bad<value"/>', 'WF_LT_IN_ATTRIBUTE at 1:10'],
  ['<r>&lt; < <  </r>', 'WF_NAME at 1:10'],
  ['<script>if (1 < 0) {}</script>', 'WF_NAME at 1:16'],
  ['<r>]]></r>', 'WF_CDATA_END_IN_TEXT at 1:4'],
  ['<r><![CDATA[</r>', 'WF_UNEXPECTED_END at 1:4'],
  ['<r><!-- a ---></r>', 'WF_COMMENT at 1:11'],
  ['<r>&#Xd;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#x1;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#xFFFE;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#12x;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r a="&#x110000;"/>', 'WF_CHARACTER_REFERENCE at 1:7'],
  ['<r>&copy;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
  ['<r>&broken</r>', 'WF_REFERENCE at 1:11'],
  ['<r>\u0001</r>', 'WF_INVALID_CHARACTER at 1:4'],
  ['<r>\uFFFF</r>', 'WF_INVALID_CHARACTER at 1:4'],
  ['<a/><b/>', 'WF_SECOND_ROOT at 1:5'],
  ['<a><b></c></b></a>', 'WF_END_TAG_MISMATCH at 1:9'],
  ['<root></rof</root>', 'WF_END_TAG_MISMATCH at 1:9'],
  ['<doc><e fo>o="F"/></doc>', 'WF_ATTRIBUTE at 1:11'],
  ['<not<quite<xml', 'WF_TAG at 1:5'],
  ['<=div></=div>', 'WF_NAME at 1:2'],
  ['<?1bad?><r/>', 'WF_PI at 1:3'],
  ['<r / >', 'WF_TAG at 1:4'],
  ['<open /', 'WF_UNEXPECTED_END at 1:7'],
  ['<p:r/>', 'NS_UNBOUND_PREFIX at 1:2'],
  ['<a:b:c xmlns:a="urn:a"/>', 'NS_QNAME at 1:2'],
  ['<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>', 'NS_DUPLICATE_ATTRIBUTE at 1:36'],
  ['<!DOCTYPE A [<!ENTITY el "&#60;B/>">]><A x="&el;"/>', 'WF_LT_IN_ATTRIBUTE at 1:45'],
  ['<!DOCTYPE l [<!ELEMENT l (#PCDATA)>]><l>&lol9;</l>', 'WF_UNDECLARED_ENTITY at 1:42'],
  ['<script>a="</scr"+"ipt>";</script>', 'WF_END_TAG_MISMATCH at 1:14'],
  ["<script>'<div>x</div></'</script>", 'WF_END_TAG_MISMATCH at 1:24'],
  ['<doc><e>/></doc>', 'WF_END_TAG_MISMATCH at 1:13'],
  ['<root/><f', 'WF_UNEXPECTED_END at 1:10'],
  ['<root></rof', 'WF_UNEXPECTED_END at 1:12'],
  ['<root><![CDATA[', 'WF_UNEXPECTED_END at 1:7'],
  ['<root><?pi ', 'WF_UNEXPECTED_END at 1:11'],
  ['<!-- note', 'WF_UNEXPECTED_END at 1:1'],
  ['<e foo="FOO>', 'WF_UNEXPECTED_END at 1:9'],
  ['<r a="1 />', 'WF_UNEXPECTED_END at 1:7'],
  ['<!--a--b--><r/>', 'WF_COMMENT at 1:6'],
  ['<div=></div=>', 'WF_TAG at 1:5'],
  ['<a$uri:foo xmlns:a$uri="u"/>', 'WF_TAG at 1:3'],
  ['<r =a="1"/>', 'WF_TAG at 1:4'],
  ['<r $a="1"/>', 'WF_TAG at 1:4'],
  ['<r <a="1"/>', 'WF_TAG at 1:4'],
  ['<DIV\fa="B"></DIV>', 'WF_TAG at 1:5'],
  ['<div></div \u000F>', 'WF_TAG at 1:12'],
  ['<r a\nb="1"/>', 'WF_ATTRIBUTE at 2:1'],
  ['<r a=value b="1"/>', 'WF_ATTRIBUTE at 1:6'],
  ['<root id />', 'WF_ATTRIBUTE at 1:10'],
  ['<tag a="1\'>\nhi\n<![CDATA[c]]>\n</tag>', 'WF_LT_IN_ATTRIBUTE at 3:1'],
  ['<r xmlns="a" xmlns="b"/>', 'WF_DUPLICATE_ATTRIBUTE at 1:14'],
  ['<r xmlns:e="a" xmlns:e="b"/>', 'WF_DUPLICATE_ATTRIBUTE at 1:16'],
  ['<r></ r>', 'WF_NAME at 1:6'],
  ['<1root/>', 'WF_NAME at 1:2'],
  ['<r>&#xD800;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#xFFFF;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#1114112;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#x3;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#-1;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<r>&#NaN;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
  ['<?xml version="1.1"?><r>&#xD800;</r>', 'WF_CHARACTER_REFERENCE at 1:25'],
  ['<r a="&broken"/>', 'WF_REFERENCE at 1:14'],
  ['<r>&unknown;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
  ['<r>&constructor;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
  ['<r>&QUOT;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
  ['\n\u0001asdasd', 'WF_INVALID_CHARACTER at 2:1'],
];

describe('every API agrees on documents the reader accepts', () => {
  it.each(ACCEPTED)('%j', async (xml, expected) => {
    expect(everyWay(() => parseEveryWay(xml))).toBe(`accepted ${expected}`);
    expect(everyWay(() => parseAtEverySplit(xml))).toBe(`accepted ${expected}`);
    expect(await parseAsyncEveryWay(xml)).toBe(`accepted ${expected}`);
  });
});

describe('every API agrees on the error, and where it is, in documents the reader rejects', () => {
  it.each(REJECTED)('%j', async (xml, expected) => {
    expect(everyWay(() => parseEveryWay(xml))).toBe(`rejected ${expected}`);
    expect(everyWay(() => parseAtEverySplit(xml))).toBe(`rejected ${expected}`);
    expect(await parseAsyncEveryWay(xml)).toBe(`rejected ${expected}`);
  });
});

describe('every API agrees under each option that changes how events are delivered', () => {
  const xml =
    '<!DOCTYPE r [<!ENTITY t "T"><!ENTITY m "<i>&t;</i>">]><r xmlns:p="urn:p" p:a="&t;">x<![CDATA[y]]>&t;&m;<p:e/>z</r>';
  const expected = '<r p:a="T">xyT<i>T</i><p:e></p:e>z</r>';

  it.each([
    [{}],
    [{ coalescing: true }],
    [{ reportEntityBoundaries: true }],
    [{ copyStrings: true }],
    [{ coalescing: true, reportEntityBoundaries: true }],
  ] as readonly [InputOptions][])('with %o', async (options) => {
    expect(parseEveryWay(xml, options)).toBe(expected);
    expect(parseAtEverySplit(xml, options)).toBe(expected);
    expect(await parseAsyncEveryWay(xml, options)).toBe(`accepted ${expected}`);
  });

  it('when not namespace-aware, reporting the declarations as attributes', async () => {
    const plain = '<r p:a="T" xmlns:p="urn:p">xyT<i>T</i><p:e></p:e>z</r>';
    expect(parseEveryWay(xml, { namespaceAware: false })).toBe(plain);
    expect(parseAtEverySplit(xml, { namespaceAware: false })).toBe(plain);
    expect(await parseAsyncEveryWay(xml, { namespaceAware: false })).toBe(`accepted ${plain}`);
  });
});

describe('every event, with its details and its location, is the same at every chunk size', () => {
  const MARKUP = [
    '<!DOCTYPE r PUBLIC "-//A//B" "urn:x" [<!ENTITY a "]>"><!-- ]> --><?p ]>?><!ATTLIST r x CDATA "]>">]><r>&a;</r>',
    '<!DOCTYPE r [<!ENTITY % p "<!ENTITY q \'x\'>">%p;<!ENTITY e "&q;&q;">]><r>&e;</r>',
    '<!DOCTYPE r [<!NOTATION n SYSTEM "urn:n"><!ENTITY u SYSTEM "urn:u" NDATA n>]><r/>',
    '<r>a\r\nb\rc\r\r\nd\r<!--a\r\nb\r--><?p a\r\nb\r?></r>',
    '<r><!-- - --><![CDATA[]]]]><![CDATA[>]]>]]&gt;<?pi ??></r>',
    ' \n <r/> \n <!--c--> <?p?> ',
    '<r>   <a/>   </r>',
  ];
  const OPTIONS: readonly InputOptions[] = [
    {},
    { coalescing: true },
    { reportEntityBoundaries: true },
    { replaceEntityReferences: false },
    { namespaceAware: false },
    { reportPrologWhitespace: true },
    { coalescing: true, reportEntityBoundaries: true },
  ];
  const documents = [...ACCEPTED.map(([xml]) => xml), ...REJECTED.map(([xml]) => xml), ...MARKUP];

  it.each(OPTIONS)('with %o', (options) => {
    for (const xml of documents) expect(() => eventsEveryWay(xml, options), xml).not.toThrow();
  });
});
