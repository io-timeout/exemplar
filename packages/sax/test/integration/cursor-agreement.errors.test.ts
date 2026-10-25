import { errorEveryWay, utf16 } from '@test/helpers/agreement.ts';
import { describe, expect, it } from 'vitest';
import type { InputOptions } from '@exemplarjs/xml';

/** A table row: what is wrong, the document, its error's code and location, and the options to read it with. */
type Case = [string, string, string, InputOptions?];

describe('SAX and the cursor reject the same malformed prolog (§2.1, §2.8)', () => {
  it.each<Case>([
    ['an XML declaration without a version (§2.8 [23])', '<?xml?><r/>', 'WF_XML_DECLARATION at 1:6'],
    ['an XML declaration inside the root', '<r><?xml version="1.0"?></r>', 'WF_XML_DECLARATION_MISPLACED at 1:4'],
    ['a space before the XML declaration', ' <?xml version="1.0"?><r/>', 'WF_XML_DECLARATION_MISPLACED at 1:2'],
    [
      'a comment before the XML declaration',
      '<!--c--><?xml version="1.0"?><r/>',
      'WF_XML_DECLARATION_MISPLACED at 1:9',
    ],
    ['the reserved PI target XML in another case (§2.6)', '<?XML version="1.0"?><r/>', 'WF_PI_TARGET_XML at 1:1'],
    [
      'U+00A0 in the declaration, which is not S (§2.3 [3])',
      '<?xml version="1.0"\u00A0?><r/>',
      'WF_XML_DECLARATION at 1:20',
    ],
    [
      'standalone neither yes nor no (§2.9 [32])',
      '<?xml version="1.0" standalone="maybe"?><r/>',
      'WF_XML_DECLARATION at 1:32',
    ],
    ['the encoding before the version', '<?xml encoding="UTF-8" version="1.0"?><r/>', 'WF_XML_DECLARATION at 1:7'],
    ['a version that is not 1.x (§2.8 [26])', '<?xml version="2.0"?><r/>', 'WF_XML_DECLARATION at 1:15'],
    ['an empty document', '', 'WF_EMPTY_DOCUMENT at 1:1'],
    ['whitespace alone', '   ', 'WF_EMPTY_DOCUMENT at 1:4'],
    ['a comment alone', '<!-- HELLO -->', 'WF_EMPTY_DOCUMENT at 1:15'],
    ['a PI alone', '<?p?>', 'WF_EMPTY_DOCUMENT at 1:6'],
    ['a control character in the prolog', '\n\u0001asdasd', 'WF_INVALID_CHARACTER at 2:1'],
    ['text before the root', 'a<root/>', 'WF_CONTENT_OUTSIDE_ROOT at 1:1'],
    ['text after the XML declaration', '<?xml version="1.0"?>\na\n<root/>', 'WF_CONTENT_OUTSIDE_ROOT at 1:22'],
    ['text after the root', '<root/>a', 'WF_CONTENT_OUTSIDE_ROOT at 1:8'],
    [
      'text after the root, after its end tag',
      '<span>Welcome,</span> to monkey land',
      'WF_CONTENT_OUTSIDE_ROOT at 1:22',
    ],
    ['a second root', '<root/><other/>', 'WF_SECOND_ROOT at 1:8'],
    ['text and a tag after the root', '<root>abc</root>de<f', 'WF_CONTENT_OUTSIDE_ROOT at 1:17'],
    ['a second root after a comment', '<doc/><!--c--><e/>', 'WF_SECOND_ROOT at 1:15'],
    ['a character reference before the root', '&#x20;<r/>', 'WF_CONTENT_OUTSIDE_ROOT at 1:1'],
    ['a character reference after the root', '<r/>&#xA;', 'WF_CONTENT_OUTSIDE_ROOT at 1:5'],
    ['a CDATA section before the root', '<![CDATA[x]]><root/>', 'WF_CONTENT_OUTSIDE_ROOT at 1:1'],
    ['unknown markup in the prolog', '<!XXXXX zzzz="eeee"><r/>', 'WF_MARKUP at 1:1'],
    ['an entity declaration outside a DOCTYPE', '<!ENTITY x "y"><r/>', 'WF_MARKUP at 1:1'],
    ['<!ATTENTION> in the prolog', '<!ATTENTION><r/>', 'WF_MARKUP at 1:1'],
    ['<!X at the end', '<!X', 'WF_MARKUP at 1:1'],
  ])('%s', async (_title, xml, expected) => {
    expect(await errorEveryWay(xml)).toBe(expected);
  });

  it('rejects a second byte order mark, which is character data before the root', async () => {
    expect(
      await errorEveryWay({ xml: new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x3c, 0x50, 0x2f, 0x3e]) })
    ).toBe('WF_CONTENT_OUTSIDE_ROOT at 1:1');
  });

  it('rejects a byte order mark after a space, which is character data', async () => {
    expect(await errorEveryWay({ xml: new Uint8Array([0x20, 0xef, 0xbb, 0xbf, 0x3c, 0x50, 0x2f, 0x3e]) })).toBe(
      'WF_CONTENT_OUTSIDE_ROOT at 1:1'
    );
  });
});

describe('SAX and the cursor reject the same malformed DOCTYPE (§2.8, §2.5)', () => {
  it.each<Case>([
    ['a start tag in the internal subset', '<!DOCTYPE root [<X>]><root/>', 'WF_DOCTYPE at 1:17'],
    ['an unknown declaration', '<!DOCTYPE root [<!X>]><root/>', 'WF_DECLARATION at 1:17'],
    ['a half-open comment', '<!DOCTYPE root [<!-X>]><root/>', 'WF_DECLARATION at 1:17'],
    ['-- inside a comment', '<!DOCTYPE root [<!--a--x-->]><root/>', 'WF_COMMENT at 1:22'],
    ['--- inside a comment', '<!DOCTYPE root [<!--a---x-->]><root/>', 'WF_COMMENT at 1:22'],
    ['the end of input inside the subset', '<!DOCTYPE root [', 'WF_UNEXPECTED_END at 1:17'],
    ['a DOCTYPE without a name', '<!DOCTYPE ><root/>', 'WF_DOCTYPE at 1:11'],
    ['a second DOCTYPE', '<!DOCTYPE r><!DOCTYPE r><r/>', 'WF_DOCTYPE_MISPLACED at 1:13'],
    ['a DOCTYPE after the root', '<r/><!DOCTYPE r>', 'WF_DOCTYPE_MISPLACED at 1:5'],
    [
      'an undeclared entity with an internal subset alone (WFC: Entity Declared)',
      '<!DOCTYPE l [<!ELEMENT l (#PCDATA)>]><l>&lol9;</l>',
      'WF_UNDECLARED_ENTITY at 1:42',
    ],
    [
      'a parameter entity reference inside a declaration in the internal subset (WFC: PEs in Internal Subset)',
      '<!DOCTYPE a [<!ENTITY % p "x"><!ENTITY e "%p;">]><a/>',
      'WF_PE_IN_INTERNAL_SUBSET at 1:42',
    ],
  ])('%s', async (_title, xml, expected) => {
    expect(await errorEveryWay(xml)).toBe(expected);
  });

  it('rejects a DOCTYPE when DOCTYPEs are disallowed', async () => {
    expect(await errorEveryWay('<!DOCTYPE a><a/>', { disallowDoctype: true })).toBe('DOCTYPE_DISALLOWED at 1:1');
  });
});

describe('SAX and the cursor reject the same malformed elements (§3.1)', () => {
  it.each<Case>([
    ['end tags that differ in case (WFC: Element Type Match)', '<a></A>', 'WF_END_TAG_MISMATCH at 1:6'],
    ['crossed end tags', '<a><b></c></b></a>', 'WF_END_TAG_MISMATCH at 1:9'],
    ['an end tag for the parent before the child ends', '<r><x></r>', 'WF_END_TAG_MISMATCH at 1:9'],
    ['$ in a prefix', '<a$uri:foo xmlns:a$uri="u"/>', 'WF_TAG at 1:3'],
    ['an end tag alone', '</a>', 'WF_END_TAG_MISMATCH at 1:1'],
    ['an end tag that runs into another', '<root></rof</root>', 'WF_END_TAG_MISMATCH at 1:9'],
    ['/> in content, then a mismatch', '<doc><e>/></doc>', 'WF_END_TAG_MISMATCH at 1:13'],
    ['an end tag split by a string in a script', '<script>a="</scr"+"ipt>";</script>', 'WF_END_TAG_MISMATCH at 1:14'],
    ['markup inside quotes in a script', `<script>'<div>x</div></'</script>`, 'WF_END_TAG_MISMATCH at 1:24'],
    ['an unclosed root', '<root>', 'WF_UNCLOSED_ELEMENT at 1:7'],
    ['two unclosed elements', '<root><foo>', 'WF_UNCLOSED_ELEMENT at 1:12'],
    ['< then a space in content', '<script>if (1 < 0) {}</script>', 'WF_NAME at 1:16'],
    ['bare < in text', '<r>&lt; < <  <   < &gt;</r>', 'WF_NAME at 1:10'],
    ['a form feed in a tag, which is not S', '<DIV\fa="B"></DIV>', 'WF_TAG at 1:5'],
    ['a vertical tab in a tag', '<DIV\va="B"></DIV>', 'WF_TAG at 1:5'],
    ['a control character in an end tag', '<div></div \u000F>', 'WF_TAG at 1:12'],
    ['a start tag cut off by the end', '<open', 'WF_UNEXPECTED_END at 1:6'],
    ['an empty-element tag cut off by the end', '<open /', 'WF_UNEXPECTED_END at 1:7'],
    ['a second start tag cut off by the end', '<root/><f', 'WF_UNEXPECTED_END at 1:10'],
    ['an end tag cut off by the end', '<root></rof', 'WF_UNEXPECTED_END at 1:12'],
    ['< inside a start tag', '<not<quite<xml', 'WF_TAG at 1:5'],
    ['= starting a name', '<=div></=div>', 'WF_NAME at 1:2'],
    ['= after a name', '<div=></div=>', 'WF_TAG at 1:5'],
    ['a space after </', '<r></ r>', 'WF_NAME at 1:6'],
    ['a space between / and >', '<r / >', 'WF_TAG at 1:4'],
    ['a digit starting a name', '<1root/>', 'WF_NAME at 1:2'],
    ['an empty name', '<>', 'WF_NAME at 1:2'],
    ['U+0333 starting a name', '<\u0333/>', 'WF_NAME at 1:2'],
    ['U+00D7 starting a name', '<×/>', 'WF_NAME at 1:2'],
    ['U+F0000 starting a name', '<\u{F0000}/>', 'WF_NAME at 1:2'],
    ['U+FFFE starting a name', '<\uFFFE/>', 'WF_NAME at 1:2'],
    ['a lone surrogate starting a name', '<\uD800/>', 'WF_NAME at 1:2'],
    [
      'nesting deeper than the limit',
      '<a><a><a></a></a></a>',
      'LIMIT_ELEMENT_DEPTH at 1:7',
      { limits: { elementDepth: 2 } },
    ],
  ])('%s', async (_title, xml, expected, options) => {
    expect(await errorEveryWay(xml, options)).toBe(expected);
  });
});

describe('SAX and the cursor reject the same malformed attributes (§3.1, §3.3.3)', () => {
  it.each<Case>([
    ['no space between attributes (§3.1 [40])', '<r a="first"b="second"/>', 'WF_TAG at 1:13'],
    ['unquoted values', '<svg width=20px height=20px />', 'WF_ATTRIBUTE at 1:12'],
    ['an attribute without a value', '<root attrib>', 'WF_ATTRIBUTE at 1:13'],
    ['an attribute without a value before />', '<root id />', 'WF_ATTRIBUTE at 1:10'],
    ['an unquoted value before />', '<root id=value/>', 'WF_ATTRIBUTE at 1:10'],
    ['an attribute name and then another', '<r a b="1"/>', 'WF_ATTRIBUTE at 1:6'],
    ['an attribute name and a line break', '<r a\nb="1"/>', 'WF_ATTRIBUTE at 2:1'],
    ['an unquoted value and another attribute', '<r a=value b="1"/>', 'WF_ATTRIBUTE at 1:6'],
    ['a name stopped by >', '<doc><e fo>o="F"/></doc>', 'WF_ATTRIBUTE at 1:11'],
    ['a character that is not a name character in a name', '<r a☂="1"/>', 'WF_ATTRIBUTE at 1:5'],
    ['= starting an attribute name', '<r =a="1"/>', 'WF_TAG at 1:4'],
    ['. starting an attribute name', '<r .a="1"/>', 'WF_TAG at 1:4'],
    ['$ starting an attribute name', '<r $a="1"/>', 'WF_TAG at 1:4'],
    ['< starting an attribute name', '<r <a="1"/>', 'WF_TAG at 1:4'],
    ['☂ starting an attribute name', '<r ☂a="1"/>', 'WF_TAG at 1:4'],
    ['a double quote closed by a single one', `<r a="1' b="2"/>`, 'WF_TAG at 1:13'],
    ['a single quote never closed', `<r a='1" b="2"/>`, 'WF_UNEXPECTED_END at 1:7'],
    ['a value never closed', '<r a="1 />', 'WF_UNEXPECTED_END at 1:7'],
    ['a value cut off by the end', '<e foo="FOO>', 'WF_UNEXPECTED_END at 1:9'],
    ['a value cut off by the end after text', '<root value="still-open', 'WF_UNEXPECTED_END at 1:14'],
    ['< in a value (WFC: No < in Attribute Values)', '<r a="bad<value"/>', 'WF_LT_IN_ATTRIBUTE at 1:10'],
    ['an unclosed value running into content', `<tag a="1'>\nhi\n<![CDATA[c]]>\n</tag>`, 'WF_LT_IN_ATTRIBUTE at 3:1'],
    [
      '< from an entity in a value',
      '<!DOCTYPE A [<!ENTITY el "&#60;B/>">]><A x="&el;"/>',
      'WF_LT_IN_ATTRIBUTE at 1:45',
    ],
    [
      'an external entity in a value (WFC: No External Entity References)',
      '<!DOCTYPE A [<!ENTITY e SYSTEM "e.xml">]><A x="&e;"/>',
      'WF_EXTERNAL_ENTITY_IN_ATTRIBUTE at 1:48',
    ],
    ['a bare & in a value', '<a href="q?x=1&y=2&z=3"/>', 'WF_REFERENCE at 1:17'],
    ['a reference without ; in a value', '<r a="&broken"/>', 'WF_REFERENCE at 1:14'],
    [
      'a repeated attribute (WFC: Unique Att Spec)',
      '<span id="hello" id="there"></span>',
      'WF_DUPLICATE_ATTRIBUTE at 1:18',
    ],
    ['a repeated default namespace declaration', '<r xmlns="u" xmlns="u"/>', 'WF_DUPLICATE_ATTRIBUTE at 1:14'],
    ['a repeated prefix declaration', '<r xmlns:e="u" xmlns:e="u"/>', 'WF_DUPLICATE_ATTRIBUTE at 1:16'],
    [
      'more attributes than the limit',
      '<a b="1" c="2" d="3"/>',
      'LIMIT_ATTRIBUTES at 1:1',
      { limits: { attributesPerElement: 2 } },
    ],
    ['a name longer than the limit', '<abcdef/>', 'LIMIT_NAME_LENGTH at 1:2', { limits: { nameLength: 3 } }],
  ])('%s', async (_title, xml, expected, options) => {
    expect(await errorEveryWay(xml, options)).toBe(expected);
  });

  it('finds two attributes of one expanded name among many (NSC: Attributes Unique)', async () => {
    const others = Array.from({ length: 20 }, (_, i) => `o${i}="${i}"`).join(' ');
    const error = await errorEveryWay(`<r xmlns:a="u" xmlns:b="u" ${others} a:x="1" b:x="2"/>`);
    expect(error).toMatch(/^NS_DUPLICATE_ATTRIBUTE /);
  });

  it.each([15, 16, 17, 32, 64, 256])('finds a repeated attribute in the last place of %i', async (n) => {
    const names = Array.from({ length: n - 1 }, (_, i) => `a${i}="${i}"`);
    const xml = `<r ${names.join(' ')} a0="again"/>`;
    const error = await errorEveryWay(xml, { limits: { attributesPerElement: 300 } });
    expect(error).toMatch(/^WF_DUPLICATE_ATTRIBUTE /);
  });
});

describe('SAX and the cursor reject the same malformed text and references (§2.4, §4.1)', () => {
  it.each<Case>([
    [']]> in text (§2.4 [14])', '<r>]]></r>', 'WF_CDATA_END_IN_TEXT at 1:4'],
    [']]> after text', '<r>a]]>b</r>', 'WF_CDATA_END_IN_TEXT at 1:5'],
    [
      'an upper-case X in a character reference (§4.1 [66])',
      '<xml>&#Xd;&#X0d;\n</xml>',
      'WF_CHARACTER_REFERENCE at 1:6',
    ],
    ['a reference to U+0000', '<r>&#0;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to U+0001 in XML 1.0 (WFC: Legal Character)', '<r>&#x1;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to U+000B in XML 1.0', '<r>&#xB;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to U+001F in XML 1.0', '<r>&#x1F;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to U+0003 in XML 1.0', '<r>&#x3;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['an upper-case X before a letter', '<r>&#X41;&#X58;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to a high surrogate', '<r>&#xD800;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to a low surrogate', '<r>&#xDFFF;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to U+FFFE', '<r>&#xFFFE;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to U+FFFF', '<r>&#xFFFF;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference beyond U+10FFFF in decimal', '<r>&#1114112;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference beyond U+10FFFF in hexadecimal', '<r>&#x110000;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a negative reference', '<r>&#-1;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to NaN', '<r>&#NaN;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a letter in a decimal reference', '<r>&#12x;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a letter beyond f in a hexadecimal reference', '<r>&#x1g;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a name in a character reference', '<r>&#hash;</r>', 'WF_CHARACTER_REFERENCE at 1:4'],
    ['a reference to a surrogate in XML 1.1', '<?xml version="1.1"?><r>&#xD800;</r>', 'WF_CHARACTER_REFERENCE at 1:25'],
    ['a reference to U+FFFF in XML 1.1', '<?xml version="1.1"?><r>&#xFFFF;</r>', 'WF_CHARACTER_REFERENCE at 1:25'],
    ['a reference to U+0000 in XML 1.1', '<?xml version="1.1"?><r>&#0;</r>', 'WF_CHARACTER_REFERENCE at 1:25'],
    [
      'a reference beyond U+10FFFF in XML 1.1',
      '<?xml version="1.1"?><r>&#x110000;</r>',
      'WF_CHARACTER_REFERENCE at 1:25',
    ],
    ['an HTML entity never declared', '<r>&copy;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
    ['&AMP;, as entity names are case-sensitive', '<r>&AMP;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
    ['&QUOT;', '<r>&QUOT;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
    ['&Quot;', '<r>&Quot;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
    ['&raquo;', '<r>&raquo;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
    ['&euro; in an attribute value', '<r a="&euro;"/>', 'WF_UNDECLARED_ENTITY at 1:7'],
    [
      'an entity named after an Object.prototype member: constructor',
      '<r>&constructor;</r>',
      'WF_UNDECLARED_ENTITY at 1:5',
    ],
    [
      'an entity named after an Object.prototype member: __proto__',
      '<r>&__proto__;</r>',
      'WF_UNDECLARED_ENTITY at 1:5',
    ],
    ['an entity named after an Object.prototype member: toString', '<r>&toString;</r>', 'WF_UNDECLARED_ENTITY at 1:5'],
    ['- starting an entity name', '<r>&-bad;</r>', 'WF_REFERENCE at 1:4'],
    ['. starting an entity name', '<r>&.bad;</r>', 'WF_REFERENCE at 1:4'],
    ['a reference without ; in text', '<r>&broken</r>', 'WF_REFERENCE at 1:11'],
    ['a bare & in text', '<r>bare & value</r>', 'WF_REFERENCE at 1:9'],
    [
      'an entity that refers to itself (WFC: No Recursion)',
      '<!DOCTYPE a [<!ENTITY e "&e;">]><a>&e;</a>',
      'WF_RECURSIVE_ENTITY at 1:36',
    ],
    [
      'two entities that refer to each other',
      '<!DOCTYPE a [<!ENTITY e "&f;"><!ENTITY f "&e;">]><a>&e;</a>',
      'WF_RECURSIVE_ENTITY at 1:53',
    ],
    [
      'a reference to an unparsed entity in content (WFC: Parsed Entity)',
      '<!DOCTYPE A [<!NOTATION n SYSTEM "n"><!ENTITY u SYSTEM "u" NDATA n>]><A>&u;</A>',
      'WF_UNPARSED_ENTITY at 1:73',
    ],
  ])('%s', async (_title, xml, expected) => {
    expect(await errorEveryWay(xml)).toBe(expected);
  });

  it('stops a billion laughs at the expansion limit', async () => {
    const levels = ['<!ENTITY a "aaaaaaaaaa">'];
    for (const [from, to] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
    ]) {
      const references = `&${from};`.repeat(10);
      levels.push(`<!ENTITY ${to} "${references}">`);
    }
    const error = await errorEveryWay(`<!DOCTYPE l [${levels.join('')}]><l>&e;</l>`);
    expect(error).toMatch(/^LIMIT_ENTITY_EXPANSIONS /);
  });
});

describe('SAX and the cursor reject the same malformed CDATA, comments and PIs (§2.5–§2.7)', () => {
  it.each<Case>([
    ['a CDATA section never closed', '<r><![CDATA[</r>', 'WF_UNEXPECTED_END at 1:4'],
    ['a CDATA section cut off by the end', '<root><![CDATA[', 'WF_UNEXPECTED_END at 1:7'],
    ['a comment cut off by the end', '<!-- HELLO', 'WF_UNEXPECTED_END at 1:1'],
    ['a comment opened with one dash', '<!- HELLO', 'WF_MARKUP at 1:1'],
    ['-- inside a comment (§2.5 [15])', '<r><!-- a -- b --></r>', 'WF_COMMENT at 1:11'],
    ['a comment ending with --->', '<!-- a ---><r/>', 'WF_COMMENT at 1:8'],
    ['-- inside a comment before the root', '<!--a--b--><r/>', 'WF_COMMENT at 1:6'],
    ['a PI without a target (§2.6 [16])', '<? QUESTION ?><r/>', 'WF_PI at 1:3'],
    ['a PI without a target, cut off', '<? QUESTION', 'WF_PI at 1:3'],
    ['a PI target starting with a digit', '<?1bad?><r/>', 'WF_PI at 1:3'],
    ['a PI cut off by the end', '<root><?pi ', 'WF_UNEXPECTED_END at 1:11'],
  ])('%s', async (_title, xml, expected) => {
    expect(await errorEveryWay(xml)).toBe(expected);
  });
});

describe('SAX and the cursor reject the same characters XML does not allow (§2.2)', () => {
  it.each<Case>([
    ['U+0000 in text', '<r>\u0000</r>', 'WF_INVALID_CHARACTER at 1:4'],
    ['U+0001 in text in XML 1.0', '<r>\u0001</r>', 'WF_INVALID_CHARACTER at 1:4'],
    ['a lone surrogate in text', '<r>\uD800x</r>', 'WF_INVALID_CHARACTER at 1:4'],
    ['U+FFFE in text', '<r>\uFFFE</r>', 'WF_INVALID_CHARACTER at 1:4'],
    ['U+FFFF in a value', '<r a="\uFFFF"/>', 'WF_INVALID_CHARACTER at 1:7'],
    ['U+0000 in a comment', '<r><!--\u0000--></r>', 'WF_INVALID_CHARACTER at 1:8'],
    ['U+0000 in a PI', '<r><?p \u0000?></r>', 'WF_INVALID_CHARACTER at 1:8'],
    ['U+0000 in a CDATA section', '<r><![CDATA[\u0000]]></r>', 'WF_INVALID_CHARACTER at 1:13'],
    ['U+0000 in a tag', '<r\u0000/>', 'WF_TAG at 1:3'],
    ['U+0001 in the internal subset', '<!DOCTYPE r [<!--\u0001-->]><r/>', 'WF_INVALID_CHARACTER at 1:18'],
    [
      'a restricted character written in XML 1.1 (XML 1.1 §2.2)',
      '<?xml version="1.1"?><r>\u0001</r>',
      'WF_INVALID_CHARACTER at 1:25',
    ],
    ['a C1 control written in XML 1.1', '<?xml version="1.1"?><r>\u0080</r>', 'WF_INVALID_CHARACTER at 1:25'],
  ])('%s', async (_title, xml, expected) => {
    expect(await errorEveryWay(xml)).toBe(expected);
  });
});

describe('SAX and the cursor reject the same namespace errors (Namespaces in XML 1.0)', () => {
  it.each<Case>([
    ['an unbound element prefix (NSC: Prefix Declared)', '<unbound:root/>', 'NS_UNBOUND_PREFIX at 1:2'],
    ['an unbound attribute prefix', '<root unbound:attr="v"/>', 'NS_UNBOUND_PREFIX at 1:7'],
    ['a prefix used outside its scope', '<r xmlns:a="A"><a:x xmlns:b="U"/><b:y/></r>', 'NS_UNBOUND_PREFIX at 1:35'],
    ['an unbound prefix under a default namespace', '<foo xmlns="X"><bar:u/></foo>', 'NS_UNBOUND_PREFIX at 1:17'],
    ['an unbound attribute prefix on a bound element', '<f:f xmlns:f="F" bar:n="1"/>', 'NS_UNBOUND_PREFIX at 1:18'],
    ['the prefix __proto__, never bound through the prototype', '<__proto__:u/>', 'NS_UNBOUND_PREFIX at 1:2'],
    ['the prefix constructor', '<constructor:u/>', 'NS_UNBOUND_PREFIX at 1:2'],
    ['the prefix toString', '<toString:u/>', 'NS_UNBOUND_PREFIX at 1:2'],
    ['the prefix hasOwnProperty', '<hasOwnProperty:u/>', 'NS_UNBOUND_PREFIX at 1:2'],
    ['the attribute prefix __proto__', '<r __proto__:b="1"/>', 'NS_UNBOUND_PREFIX at 1:4'],
    ['the attribute prefix hasOwnProperty', '<r hasOwnProperty:b="1"/>', 'NS_UNBOUND_PREFIX at 1:4'],
    ['the xml prefix bound elsewhere (§3)', `<xml:root xmlns:xml='ERROR'/>`, 'NS_RESERVED at 1:11'],
    ['the xml prefix bound to another URI', '<r xmlns:xml="urn:bad"/>', 'NS_RESERVED at 1:4'],
    ['an element with the prefix xmlns', '<xmlns:a/>', 'NS_RESERVED at 1:2'],
    ['the prefix xmlns declared', '<r xmlns:xmlns="http://foo"/>', 'NS_RESERVED at 1:4'],
    [
      'another prefix bound to the XML namespace',
      '<r xmlns:p="http://www.w3.org/XML/1998/namespace"/>',
      'NS_RESERVED at 1:4',
    ],
    ['a prefix bound to the xmlns namespace', '<r xmlns:p="http://www.w3.org/2000/xmlns/"/>', 'NS_RESERVED at 1:4'],
    ['the xmlns namespace as the default', '<r xmlns="http://www.w3.org/2000/xmlns/"/>', 'NS_RESERVED at 1:4'],
    ['the XML namespace as the default', '<r xmlns="http://www.w3.org/XML/1998/namespace"/>', 'NS_RESERVED at 1:4'],
    [
      'two attributes of one expanded name (NSC: Attributes Unique)',
      '<r xmlns:x="x1" xmlns:y="x1"><c x:a="" y:a=""/></r>',
      'NS_DUPLICATE_ATTRIBUTE at 1:40',
    ],
    ['a name starting with a colon', '<_a><:b></:b></_a>', 'NS_QNAME at 1:6'],
    ['an element named :r', '<:r/>', 'NS_QNAME at 1:2'],
    ['an attribute named :b', '<r :b="B"/>', 'NS_QNAME at 1:4'],
    ['an attribute name of colons', '<r a:::="A"/>', 'NS_QNAME at 1:4'],
    ['two colons in an attribute name', '<r a:b:c="B"/>', 'NS_QNAME at 1:4'],
    ['two colons in an element name', '<a:b:c xmlns:a="urn:a"/>', 'NS_QNAME at 1:2'],
    ['an empty local name', '<p: xmlns:p="urn:p"/>', 'NS_QNAME at 1:2'],
    ['xmlns: with no prefix', '<f xmlns:="M"/>', 'NS_QNAME at 1:4'],
    ['a prefix undeclared in XML 1.0 (Namespaces 1.0 §2.2)', '<r xmlns:p=""/>', 'NS_UNDECLARED_PREFIX at 1:4'],
    ['a colon in a PI target (§7)', '<r><?a:b x?></r>', 'NS_COLON at 1:4'],
    ['a colon in an entity name', '<!DOCTYPE r [<!ENTITY a:b "x">]><r/>', 'NS_COLON at 1:26'],
    ['a colon starting an entity reference', '<r>&:c;</r>', 'NS_COLON at 1:5'],
  ])('%s', async (_title, xml, expected) => {
    expect(await errorEveryWay(xml)).toBe(expected);
  });
});

describe('SAX and the cursor reject the same bytes (§4.3.3)', () => {
  it('rejects UTF-16 bytes that declare UTF-8', async () => {
    expect(await errorEveryWay({ xml: utf16('<?xml version="1.0" encoding="UTF-8"?><a/>', true) })).toBe(
      'ENCODING_MISMATCH at 1:1'
    );
  });

  it.each([
    ['a lone 0xC0', [0x3c, 0x61, 0x3e, 0xc0, 0x3c, 0x2f, 0x61, 0x3e]],
    ['a truncated three-byte sequence', [0x3c, 0x61, 0x3e, 0xe8, 0x3c, 0x2f, 0x61, 0x3e]],
  ])('rejects %s in UTF-8, without substituting U+FFFD', async (_title, bytes) => {
    expect(await errorEveryWay({ xml: Uint8Array.from(bytes) })).toBe('ENCODING_INVALID_BYTES at 1:4');
  });

  it('rejects UTF-16 that loses its last byte', async () => {
    expect(await errorEveryWay({ xml: utf16('<a/>', true).subarray(0, 9) })).toBe('ENCODING_INVALID_BYTES at 1:4');
  });

  it('rejects a document of one 0xFF byte', async () => {
    expect(await errorEveryWay({ xml: new Uint8Array([0xff]) })).toBe('ENCODING_INVALID_BYTES at 1:1');
  });

  it('rejects UTF-16 without a byte order mark or a declaration (§4.3.3)', async () => {
    expect(await errorEveryWay({ xml: new Uint8Array([0x3c, 0x00, 0x3f, 0x00]) })).toBe('ENCODING_UNDECLARED at 1:1');
  });
});
