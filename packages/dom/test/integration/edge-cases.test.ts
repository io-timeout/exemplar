import { build, buildAsync, children, serialize, streamOf, utf16, utf8 } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { XMLError } from '@exemplarjs/xml';
import { type Attr, type CDATASection, DOMParser, type Element, type Node, type Text } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** The elements of a document in order, as `{uri}name`. */
function expanded(xml: string): string[] {
  return [...build(xml).getElementsByTagName('*')].map((e) => `{${e.namespaceURI ?? ''}}${e.localName}`);
}

/** The attributes of an element that are not namespace declarations, as `{uri}name=value`. */
function attributesOf(element: Element): string[] {
  return [...element.attributes]
    .filter((a) => a.namespaceURI !== XMLNS)
    .map((a) => `{${a.namespaceURI ?? ''}}${a.localName}=${a.nodeValue}`);
}

describe('namespaces and their scope (Namespaces in XML 1.0)', () => {
  it('binds xml without a declaration (§3)', () => {
    const root = build('<xml:root xml:lang="en"/>').documentElement as Element;
    expect([root.namespaceURI, root.prefix, root.getAttributeNS(XML, 'lang')]).toEqual([XML, 'xml', 'en']);
  });

  it('accepts xml bound to its own namespace, and an element named xmlns in no namespace', () => {
    expect(build(`<r xmlns:xml="${XML}"/>`).documentElement?.nodeName).toBe('r');
    expect(expanded('<xmlns/>')).toEqual(['{}xmlns']);
  });

  it('resolves prefixes declared after their use in the same tag', () => {
    expect(expanded('<o:c b="B" xmlns:o="O"/>')).toEqual(['{O}c']);
    for (const xml of ['<p a:attr="v" xmlns:a="http://A"/>', '<p xmlns:a="http://A" a:attr="v"/>']) {
      expect(attributesOf(build(xml).documentElement as Element)).toEqual(['{http://A}attr=v']);
    }
  });

  it('puts unprefixed attributes in no namespace, whatever the default namespace (§6.2)', () => {
    const root = build('<elm xmlns="http://foo" attr="bar"/>').documentElement as Element;
    expect([root.namespaceURI, ...attributesOf(root)]).toEqual(['http://foo', '{}attr=bar']);
  });

  it('ends a default namespace with its element', () => {
    expect(expanded('<root><n xmlns="u:d"><plain/></n><plain/></root>')).toEqual([
      '{}root',
      '{u:d}n',
      '{u:d}plain',
      '{}plain',
    ]);
  });

  it('restores a prefix an inner element rebound', () => {
    const document = build('<r xmlns:x="x1" xmlns:y="y1"><q xmlns:x="x2"><c x:a="" y:a=""/></q><c x:a=""/></r>');
    const [inner, outer] = [...document.getElementsByTagName('c')] as Element[];
    expect(attributesOf(inner as Element)).toEqual(['{x2}a=', '{y1}a=']);
    expect(attributesOf(outer as Element)).toEqual(['{x1}a=']);
    expect(expanded('<r xmlns:a="A"><a:x xmlns:a="R"><a:y/></a:x><a:z/><a:y/></r>')).toEqual([
      '{}r',
      '{R}x',
      '{R}y',
      '{A}z',
      '{A}y',
    ]);
  });

  it('keeps nested scopes apart', () => {
    expect(
      expanded('<r xmlns:p="urn:p0"><p:a><b xmlns="urn:inner" xmlns:p="urn:p1"><p:c/></b><p:d/></p:a></r>')
    ).toEqual(['{}r', '{urn:p0}a', '{urn:inner}b', '{urn:p1}c', '{urn:p0}d']);
    expect(expanded('<root xmlns:p="urn:outer"><p:item xmlns:p="urn:inner"/><p:item/></root>')).toEqual([
      '{}root',
      '{urn:inner}item',
      '{urn:outer}item',
    ]);
    expect(expanded('<foo:r xmlns:foo="F" xmlns:bar="B"><bar:o><n/></bar:o></foo:r>')).toEqual(['{F}r', '{B}o', '{}n']);
    expect(expanded('<rss xmlns:atom="A"><channel/></rss>')).toEqual(['{}rss', '{}channel']);
  });

  it('tells a prefixed attribute from an unprefixed one of the same local name', () => {
    const f = build('<f xmlns="A" xmlns:a="A" id="x" a:title="y"/>').documentElement as Element;
    expect(attributesOf(f)).toEqual(['{}id=x', '{A}title=y']);
    expect([f.getAttributeNS('A', 'title'), f.getAttribute('title')]).toEqual(['y', '']);
    const x = build('<x xmlns="A" xmlns:a="A" t="1" a:t="2"/>').documentElement as Element;
    expect(attributesOf(x)).toEqual(['{}t=1', '{A}t=2']);
  });

  it('gives each element and attribute its namespace in a mixed document', () => {
    const document = build('<foo xmlns="T" xmlns:bar="B"><t xmlns="U" id="a" bar:t="b"><n/><n/></t></foo>');
    expect([...document.getElementsByTagName('*')].map((e) => `{${e.namespaceURI}}${e.localName}`)).toEqual([
      '{T}foo',
      '{U}t',
      '{U}n',
      '{U}n',
    ]);
    expect(attributesOf(document.getElementsByTagName('t').item(0) as Element)).toEqual(['{}id=a', '{B}t=b']);
    const item = build('<r xmlns="urn:default" xmlns:p="urn:p"><p:item id="1" p:id="2"/></r>').documentElement
      ?.firstChild as Element;
    expect([item.namespaceURI, ...attributesOf(item)]).toEqual(['urn:p', '{}id=1', '{urn:p}id=2']);
  });

  it('keeps the prefix as written', () => {
    const root = build('<atom:f xmlns:atom="X"/>').documentElement as Element;
    expect([root.namespaceURI, root.prefix, root.localName]).toEqual(['X', 'atom', 'f']);
  });

  it('accepts a prefix with name characters, and does not read attribute values as names', () => {
    expect(build('<r xmlns:color_1-.0="u"/>').documentElement?.lookupNamespaceURI('color_1-.0')).toBe('u');
    const root = build('<r xmlns:xsi="urn:xsi" xsi:type="bar:Bar"/>').documentElement as Element;
    expect(root.getAttributeNS('urn:xsi', 'type')).toBe('bar:Bar');
  });

  it('binds the normalized attribute value, references expanded (§3)', () => {
    expect(build('<r xmlns:p="a&amp;b"/>').documentElement?.lookupNamespaceURI('p')).toBe('a&b');
    const document = build('<!DOCTYPE r [<!ENTITY product "StAX &#38;#38; XML">]><r xmlns:p="urn:&product;"/>');
    expect(document.documentElement?.lookupNamespaceURI('p')).toBe('urn:StAX & XML');
  });

  it('gives the namespaces in scope at an element', () => {
    const x = build('<root xmlns:a="urn:1"><a:x xmlns:b="urn:2"/></root>').documentElement?.firstChild as Element;
    expect([x.lookupNamespaceURI('a'), x.lookupNamespaceURI('b'), x.lookupPrefix('urn:1')]).toEqual([
      'urn:1',
      'urn:2',
      'a',
    ]);
  });

  it('lets xmlns="" undeclare the default namespace', () => {
    expect(expanded('<r xmlns="u"><c xmlns=""/></r>')).toEqual(['{u}r', '{}c']);
  });

  it('lets XML 1.1 undeclare a prefix (Namespaces 1.1 §5)', () => {
    const c = build('<?xml version="1.1"?><r xmlns:p="urn:p"><c xmlns:p=""/></r>').documentElement
      ?.firstChild as Element;
    expect(c.lookupNamespaceURI('p')).toBeNull();
  });

  it('builds deeply nested scopes, each declaring a prefix', () => {
    const depth = 3000;
    const open = Array.from({ length: depth }, (_, i) => `<p${i}:e xmlns:p${i}="u${i}">`).join('');
    const close = Array.from({ length: depth }, (_, i) => `</p${depth - 1 - i}:e>`).join('');
    const document = build(open + close, { limits: { elementDepth: depth } });
    const deepest = document.getElementsByTagName('*').item(depth - 1) as Element;
    expect([deepest.namespaceURI, deepest.lookupNamespaceURI('p0'), deepest.lookupPrefix(`u${depth - 2}`)]).toEqual([
      `u${depth - 1}`,
      'u0',
      `p${depth - 2}`,
    ]);
  });

  it.each([
    ['an unbound element prefix', '<unbound:root/>'],
    ['an unbound attribute prefix', "<root unbound:attr='v'/>"],
    ['a prefix used out of scope', '<r xmlns:a="A"><a:x xmlns:b="U"/><b:y/></r>'],
    ['the prefix __proto__ unbound', '<__proto__:u/>'],
    ['the prefix constructor unbound', '<constructor:u/>'],
    ['the prefix toString unbound', '<foo xmlns="X"><toString:u/></foo>'],
    ['the prefix hasOwnProperty on an attribute', '<f:f xmlns:f="F" hasOwnProperty:b="1"/>'],
    ['the attribute prefix __proto__', '<r __proto__:b="1"/>'],
    ['xml bound elsewhere', "<xml:root xmlns:xml='ERROR'/>"],
    ['another prefix for the XML namespace', `<r xmlns:p="${XML}"/>`],
    ['a declaration of xmlns', '<r xmlns:xmlns="http://foo"/>'],
    ['the XMLNS namespace as the default', `<r xmlns="${XMLNS}"/>`],
    ['the XMLNS namespace for a prefix', `<r xmlns:p="${XMLNS}"/>`],
    ['the XML namespace as the default', `<r xmlns="${XML}"/>`],
    ['an undeclared prefix in XML 1.0', '<r xmlns:p=""/>'],
    ['an element named xmlns:a', '<xmlns:a/>'],
    ['an empty prefix', '<f xmlns:="M"/>'],
    ['an element with a leading colon', '<_a><:b></:b></_a>'],
    ['an attribute with a leading colon', '<r :b="B"/>'],
    ['an attribute with two colons', '<r a:b:c="B"/>'],
    ['an element with an empty local name', '<p: xmlns:p="urn:p"/>'],
    ['two attributes with one expanded name (§6.3)', '<x xmlns:a="A" xmlns:b="A" a:t="1" b:t="2"/>'],
    ['a colon in a processing instruction target', '<r><?a:b x?></r>'],
    ['a colon in an entity name', '<!DOCTYPE r [<!ENTITY a:b "x">]><r/>'],
  ])('rejects %s', (_case, xml) => {
    expect(() => build(xml)).toThrow(XMLError);
  });

  it('builds DOM Level 1 names, colons kept, when not namespace-aware', () => {
    const document = build('<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"><p:raw/><n x::="A"/></r>', {
      namespaceAware: false,
    });
    const root = document.documentElement as Element;
    expect([...root.attributes].map((a) => a.nodeName)).toEqual(['xmlns:a', 'xmlns:b', 'a:x', 'b:x']);
    expect(children(root).map((c) => c.split(':').slice(0, 3).join(':'))).toEqual(['1:p:raw', '1:n:']);
    expect((root.lastChild as Element).getAttribute('x::')).toBe('A');
  });
});

describe('attribute names that are names of object properties', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'keeps an attribute named %s as an ordinary attribute',
    (name) => {
      const root = build(`<root ${name}="v" length='12345'/>`).documentElement as Element;
      expect([root.getAttribute(name), root.getAttributeNode(name)?.name, root.hasAttribute(name)]).toEqual([
        'v',
        name,
        true,
      ]);
      expect(root.attributes.getNamedItem(name)?.nodeValue).toBe('v');
    }
  );

  it('keeps the attribute map working with attributes named after its members', () => {
    const map = build('<r item="x" length="5" getNamedItem="g"/>').documentElement?.attributes;
    expect([map?.length, map?.item(0)?.nodeName, map?.getNamedItem('length')?.nodeValue]).toEqual([3, 'item', '5']);
  });

  it('keeps elements named after object properties', () => {
    const document = build('<r><constructor/><__proto__/><toString/></r>');
    expect(document.getElementsByTagName('constructor')).toHaveLength(1);
    expect(children(document.documentElement as Element)).toEqual(['1:constructor:', '1:__proto__:', '1:toString:']);
  });

  it('serializes and reads back such attributes', () => {
    const xml = '<r __proto__="p" constructor="c"/>';
    const once = serialize(build(xml));
    expect(serialize(build(once))).toBe(xml);
  });
});

describe('entities and references (XML 1.0 §4)', () => {
  it('expands entities nested in text, attributes and markup', () => {
    const document = build(
      `<!DOCTYPE A [<!ENTITY at "1"><!ENTITY t "2.&at;"><!ENTITY el '<B x="&at;.3"/>'>]><A x="&at;.2">&t;&el;</A>`
    );
    const a = document.documentElement as Element;
    expect([a.getAttribute('x'), (a.firstChild as Text).data, (a.lastChild as Element).getAttribute('x')]).toEqual([
      '1.2',
      '2.1',
      '1.3',
    ]);
  });

  it('gives the predefined and character references their characters, once', () => {
    const r = build('<r>&amp;&apos;&gt;&lt;&quot;&#39;&#38;&#0123;&#x0130;&amp;amp;</r>').documentElement as Element;
    expect(r.textContent).toBe(`&'><"'&{\u{130}&amp;`);
  });

  it('keeps references in CDATA as written', () => {
    const r = build('<mi>&#x398;&#920;&amp;#x398;<![CDATA[&#x398;]]></mi>').documentElement as Element;
    expect(children(r)).toEqual(['3:#text:\u{398}\u{398}&#x398;', '4:#cdata-section:&#x398;']);
  });

  it('expands an entity whose value holds an escaped ampersand once (§4.5)', () => {
    const document = build(
      '<!DOCTYPE r [<!ENTITY product "StAX &#38;#38; XML">]><r a="&product;">&product;|&amp;product;|<![CDATA[&product;]]></r>'
    );
    const r = document.documentElement as Element;
    expect([r.getAttribute('a'), r.textContent]).toEqual(['StAX & XML', 'StAX & XML|&product;|&product;']);
  });

  it('lets the first declaration of an entity bind (§4.2)', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "first"><!ENTITY e "second">]><r>&e;</r>');
    expect([document.doctype?.entities.length, document.documentElement?.textContent]).toEqual([1, 'first']);
  });

  it('accepts a redeclared predefined entity (§4.6)', () => {
    expect(build('<!DOCTYPE r [<!ENTITY amp "&#38;#38;">]><r>&amp;</r>').documentElement?.textContent).toBe('&');
  });

  it('keeps a character reference to CR through line-end normalization (§2.11)', () => {
    const document = build('<x>&#xd;&#x0d;\n</x>');
    expect(document.documentElement?.textContent).toBe('\r\r\n');
    expect(serialize(document)).toBe('<x>&#13;&#13;\n</x>');
  });

  it('gives an astral character reference as one code point', () => {
    expect(build('<a>&#x1f525;</a>').documentElement?.textContent).toBe('\u{1F525}');
  });

  it.each([
    ['an undeclared entity', '<!DOCTYPE l [<!ELEMENT l (#PCDATA)>]><l>&lol9;</l>'],
    ['an HTML entity', '<r>&copy;</r>'],
    ['a predefined entity in the wrong case', '<r>&AMP;</r>'],
    ['an upper-case X in a character reference', '<r>&#X41;</r>'],
    ['a reference to a character XML does not allow', '<r>&#x1;</r>'],
    ['markup from an entity in an attribute', '<!DOCTYPE A [<!ENTITY el "&#60;B/>">]><A x="&el;"/>'],
  ])('rejects %s', (_case, xml) => {
    expect(() => build(xml)).toThrow(XMLError);
  });

  it('stops an exponential expansion at the limit', () => {
    const reference = (i: number): string => `&l${i};`;
    const laughs = Array.from({ length: 9 }, (_, i) => `<!ENTITY l${i + 1} "${reference(i).repeat(10)}">`).join('');
    expect(() => build(`<!DOCTYPE r [<!ENTITY l0 "lol">${laughs}]><r>&l9;</r>`)).toThrow(XMLError);
  });

  it('gives a parsererror document for an undeclared entity through DOMParser', () => {
    const document = new DOMParser().parseFromString('<r>&euro;</r>', 'application/xml');
    expect(document.documentElement?.localName).toBe('parsererror');
  });
});

describe('whitespace and line ends', () => {
  it('keeps whitespace-only text between elements, untrimmed', () => {
    expect(children(build('<doc> \n<e/> </doc>').documentElement as Element)).toEqual([
      '3:#text: \n',
      '1:e:',
      '3:#text: ',
    ]);
  });

  it('keeps no whitespace outside the document element', () => {
    const document = build('<?xml version="1.0" encoding="UTF-8"?>\n\t <root/>\n');
    expect(children(document)).toEqual(['1:root:']);
  });

  it('turns CR and CRLF into LF in text, comments and processing instructions (§2.11)', () => {
    const r = build('<r>x\r\ny\rz<!--a\r\nb--><?p c\rd?></r>').documentElement as Element;
    expect(children(r)).toEqual(['3:#text:x\ny\nz', '8:#comment:a\nb', '7:p:c\nd']);
  });

  it('normalizes whitespace in attribute values, but not whitespace from references (§3.3.3)', () => {
    const r = build('<r a="a\tb\nc" b="x&#10;y\tz\r\nw" c="&#9;&#10;&#13;"/>').documentElement as Element;
    expect([r.getAttribute('a'), r.getAttribute('b'), r.getAttribute('c')]).toEqual(['a b c', 'x\ny z w', '\t\n\r']);
  });

  it('keeps a comment with its line breaks, and the text around it', () => {
    const x = build('<x>\n<!-- \n a single dash- in it\n-->\n<data/>\n</x>').documentElement as Element;
    expect(children(x)).toEqual([
      '3:#text:\n',
      '8:#comment: \n a single dash- in it\n',
      '3:#text:\n',
      '1:data:',
      '3:#text:\n',
    ]);
  });

  it('keeps trailing whitespace in processing instruction data, not leading', () => {
    const pi = build('<r><?pi   a  ?></r>').documentElement?.firstChild as Node;
    expect(pi.nodeValue).toBe('a  ');
  });

  it('keeps a PI with an unbalanced quote, and an element named xml', () => {
    const document = build('<?has unbalanced "quotes?><xml>body</xml>');
    expect(children(document)).toEqual(['7:has:unbalanced "quotes', '1:xml:body']);
  });

  it('builds text split across stream chunks as one node', async () => {
    const document = await buildAsync(streamOf(utf8('<T>flush</T>'), 5));
    expect(children(document.documentElement as Element)).toEqual(['3:#text:flush']);
  });
});

describe('CDATA sections (XML 1.0 §2.7)', () => {
  it('keeps text joined to whitespace in element content as text, not as ignorable whitespace', () => {
    const dtd = '<!DOCTYPE a [<!ELEMENT a (b)*><!ELEMENT b EMPTY><!ENTITY x "x">]>';
    const coalesced = build(`${dtd}<a>  <![CDATA[x]]></a>`, { coalescing: true }).documentElement as Element;
    const text = coalesced.firstChild as Text;
    expect([text.data, text.isElementContentWhitespace, coalesced.textContent]).toEqual(['  x', false, '  x']);
    const expanded = build(`${dtd}<a>  &x;</a>`).documentElement as Element;
    expect([(expanded.firstChild as Text).isElementContentWhitespace, expanded.textContent]).toEqual([false, '  x']);
    // Whitespace joined onto text after it leaves the text as it was.
    const after = build(`${dtd}<a>&x;  </a>`).documentElement as Element;
    const joined = after.firstChild as Text;
    expect([joined.data, joined.isElementContentWhitespace, after.childNodes.length]).toEqual(['x  ', false, 1]);
  });

  it('keeps leading and trailing spaces', () => {
    const r = build('<r><![CDATA[ this is character data  ]]></r>').documentElement as Element;
    expect((r.firstChild as CDATASection).data).toBe(' this is character data  ');
  });

  it('keeps brackets next to the delimiters', () => {
    const r = build('<r><![CDATA[[[[[[[[[]]]]]]]]]]></r>').documentElement as Element;
    expect((r.firstChild as CDATASection).data).toBe('[[[[[[[[]]]]]]]]');
  });

  it('keeps markup as text', () => {
    const r = build('<r><![CDATA[a <b> c > d &amp;]]></r>').documentElement as Element;
    expect(r.textContent).toBe('a <b> c > d &amp;');
  });

  it('keeps adjacent sections apart, and joins them when coalescing', () => {
    const xml = '<r><![CDATA[ a ]]><![CDATA[ b [] ]]></r>';
    expect(children(build(xml).documentElement as Element)).toEqual([
      '4:#cdata-section: a ',
      '4:#cdata-section: b [] ',
    ]);
    expect(children(build(xml, { coalescing: true }).documentElement as Element)).toEqual(['3:#text: a  b [] ']);
  });

  it('builds one section from a stream split anywhere inside it', async () => {
    const bytes = utf8('<r><![CDATA[a]]><![CDATA[ this is ]]></r>');
    for (const size of [1, 2, 3, 5]) {
      const document = await buildAsync(streamOf(bytes, size));
      expect(children(document.documentElement as Element), `chunks of ${size}`).toEqual([
        '4:#cdata-section:a',
        '4:#cdata-section: this is ',
      ]);
    }
  });

  it('builds a large section', () => {
    const big = 'x'.repeat(1 << 20);
    const cdata = build(`<r><![CDATA[${big}]]></r>`).documentElement?.firstChild as CDATASection;
    expect(cdata).toHaveLength(1 << 20);
  });

  it('reads escaped CDATA delimiters as text', () => {
    expect(build('<r>&lt;![CDATA[ x ]]&gt;</r>').documentElement?.textContent).toBe('<![CDATA[ x ]]>');
  });

  it('writes CDATA back as CDATA', () => {
    expect(serialize(build('<r><![CDATA[<x>]]></r>'))).toBe('<r><![CDATA[<x>]]></r>');
  });

  it.each([
    [']]> in text', '<r>a]]>b</r>'],
    ['an unterminated section', '<r><![CDATA[</r>'],
  ])('rejects %s', (_case, xml) => {
    expect(() => build(xml)).toThrow(XMLError);
  });
});

describe('byte-order marks (XML 1.0 §4.3.3)', () => {
  const BOM = [0xef, 0xbb, 0xbf];

  it('skips a leading byte-order mark and keeps U+FEFF later on as a character', () => {
    const document = build(new Uint8Array([...BOM, ...utf8('<div>\u{FEFF}</div>')]));
    expect([document.childNodes.length, document.documentElement?.textContent]).toEqual([1, '\u{FEFF}']);
  });

  it('skips a byte-order mark split across chunks', async () => {
    const bytes = new Uint8Array([...BOM, ...utf8('<?xml version="1.0"?><root xml:lang="en"/>')]);
    const document = await buildAsync(streamOf(bytes, 1));
    expect([document.childNodes.length, document.documentElement?.getAttributeNS(XML, 'lang')]).toEqual([1, 'en']);
  });

  it('keeps U+FEFF in attribute values, literal or referenced', () => {
    const p = build('<P a="&#xFEFF;" b="\u{FEFF}"/>').documentElement as Element;
    expect([p.getAttribute('a'), p.getAttribute('b')]).toEqual(['\u{FEFF}', '\u{FEFF}']);
  });

  it.each([
    ['a space before the mark', new Uint8Array([0x20, ...BOM, ...utf8('<P/>')])],
    ['two marks', new Uint8Array([...BOM, ...BOM, ...utf8('<P/>')])],
    ['a UTF-16 mark with UTF-8 declared', utf16('<?xml version="1.0" encoding="UTF-8"?><r/>', true)],
  ])('rejects %s', (_case, bytes) => {
    expect(() => build(bytes)).toThrow(XMLError);
  });
});

describe('names (XML 1.0 Fifth Edition §2.3)', () => {
  it.each([
    ['Cyrillic', '<\u{420}>\u{442}\u{435}\u{441}\u{442}</\u{420}>'],
    ['a name start character beyond the BMP', '<\u{10000} a\u{10000}="ok"/>'],
    ['a middle dot', '<a\u{B7}b/>'],
    ['a period and digits', '<dateTime.iso8601/>'],
    ['an underscore', '<_a/>'],
  ])('accepts %s', (_case, xml) => {
    expect(build(xml).documentElement).not.toBeNull();
  });

  it('keeps the case of names, and rejects end tags that differ in case', () => {
    expect(build('<DIV class="Test"/>').documentElement?.getAttribute('class')).toBe('Test');
    expect(() => build('<a></A>')).toThrow(XMLError);
  });
});

describe('serializing namespaces', () => {
  it.each([
    ['declares a prefix once and reuses it below', '<p:a xmlns:p="u"><p:b><p:c p:x="1"/></p:b></p:a>'],
    ['restores a prefix after an element that rebinds it', '<p:a xmlns:p="u1"><p:b xmlns:p="u2"/><p:c/></p:a>'],
    ['writes xml:lang without a declaration, and keeps attribute order', '<r z="1" xml:lang="en" a="2"/>'],
  ])('%s', (_title, xml) => {
    expect(serialize(build(xml))).toBe(xml);
  });

  it('writes an attribute in a namespace whose prefix the tree binds elsewhere', () => {
    const document = build('<r xmlns:p="urn:p"><c/></r>');
    const c = document.documentElement?.firstChild as Element;
    c.setAttributeNS('urn:p', 'q:a', 'v');
    const back = build(serialize(document)).documentElement?.firstChild as Element;
    expect((back.getAttributeNodeNS('urn:p', 'a') as Attr).value).toBe('v');
  });
});
