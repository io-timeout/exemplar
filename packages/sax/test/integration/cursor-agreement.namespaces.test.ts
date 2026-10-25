import { namesEveryWay, readEveryWay } from '@test/helpers/agreement.ts';
import { describe, expect, it } from 'vitest';

const XML = 'http://www.w3.org/XML/1998/namespace';

/** A table row: what the document shows, the document, and its names as `namesOf` writes them. */
type Case = [string, string, string[]];

describe('SAX agrees with the cursor on namespaces (Namespaces in XML 1.0)', () => {
  it.each<Case>([
    [
      'the xml prefix, bound without a declaration (§3)',
      "<root xml:lang='en'/>",
      ['root', `@{${XML}}lang=en`, '/root'],
    ],
    ['an element with the xml prefix', '<xml:root/>', [`{${XML}}root`, `/{${XML}}root`]],
    ['the xml prefix declared to its own namespace', `<r xmlns:xml="${XML}"/>`, [`+xml=${XML}`, 'r', '/r', '-xml']],
    ['a prefixed root', '<u:root xmlns:u="someuri"/>', ['+u=someuri', '{someuri}root', '/{someuri}root', '-u']],
    [
      'a declaration after the attribute that uses it',
      '<p a:attr="v" xmlns:a="http://A"/>',
      ['+a=http://A', 'p', '@{http://A}attr=v', '/p', '-a'],
    ],
    [
      'a declaration before the attribute that uses it',
      '<p xmlns:a="http://A" a:attr="v"/>',
      ['+a=http://A', 'p', '@{http://A}attr=v', '/p', '-a'],
    ],
    [
      'a default namespace and a prefix, with plain and prefixed attributes',
      '<f xmlns="A" xmlns:m="M" id="x" m:t="y"/>',
      ['+=A', '+m=M', '{A}f', '@id=x', '@{M}t=y', '/{A}f', '-', '-m'],
    ],
    [
      'a prefixed attribute in the default namespace URI',
      '<f xmlns="A" xmlns:a="A" id="x" a:title="y"/>',
      ['+=A', '+a=A', '{A}f', '@id=x', '@{A}title=y', '/{A}f', '-', '-a'],
    ],
    [
      'a declaration after the element name that uses it',
      '<o:c b="B" xmlns:o="O"/>',
      ['+o=O', '{O}c', '@b=B', '/{O}c', '-o'],
    ],
    [
      'the default namespace, which unprefixed attributes do not take (§6.2)',
      "<elm xmlns='http://foo' attr='bar'/>",
      ['+=http://foo', '{http://foo}elm', '@attr=bar', '/{http://foo}elm', '-'],
    ],
    [
      'a default namespace in scope for one element only',
      '<root><n xmlns="u:d"><plain/></n><plain/></root>',
      ['root', '+=u:d', '{u:d}n', '{u:d}plain', '/{u:d}plain', '/{u:d}n', '-', 'plain', '/plain', '/root'],
    ],
    [
      'the default namespace undeclared with xmlns=""',
      '<a xmlns="u"><b xmlns=""><c/></b></a>',
      ['+=u', '{u}a', '+=', 'b', 'c', '/c', '/b', '-', '/{u}a', '-'],
    ],
    [
      'two prefixes for one URI, and a prefixed and an unprefixed attribute of one local name',
      '<x xmlns="A" xmlns:a="A" t="1" a:t="2"/>',
      ['+=A', '+a=A', '{A}x', '@t=1', '@{A}t=2', '/{A}x', '-', '-a'],
    ],
    [
      'a prefix for the default namespace, used by a child',
      '<f xmlns="A" xmlns:a="A"><a:t/></f>',
      ['+=A', '+a=A', '{A}f', '{A}t', '/{A}t', '/{A}f', '-', '-a'],
    ],
    [
      'a declared prefix that no name uses',
      '<rss xmlns:atom="A"><channel/></rss>',
      ['+atom=A', 'rss', 'channel', '/channel', '/rss', '-atom'],
    ],
    [
      'an unprefixed child of prefixed elements',
      '<foo:r xmlns:foo="F" xmlns:bar="B"><bar:o><n/></bar:o></foo:r>',
      ['+foo=F', '+bar=B', '{F}r', '{B}o', 'n', '/n', '/{B}o', '/{F}r', '-foo', '-bar'],
    ],
    [
      'a default namespace redeclared, and an attribute prefixed from the outer scope',
      '<foo xmlns="T" xmlns:bar="B"><t xmlns="U" id="a" bar:t="b"><n/></t></foo>',
      [
        '+=T',
        '+bar=B',
        '{T}foo',
        '+=U',
        '{U}t',
        '@id=a',
        '@{B}t=b',
        '{U}n',
        '/{U}n',
        '/{U}t',
        '-',
        '/{T}foo',
        '-',
        '-bar',
      ],
    ],
    [
      'a prefix rebound and then back in scope',
      '<r xmlns:a="A"><a:x xmlns:a="R"><a:y/></a:x><a:z/></r>',
      ['+a=A', 'r', '+a=R', '{R}x', '{R}y', '/{R}y', '/{R}x', '-a', '{A}z', '/{A}z', '/r', '-a'],
    ],
    [
      'shadowing restored after the end tag',
      '<r xmlns:x="x1" xmlns:y="y1"><q xmlns:x="x2"><c x:a="" y:a=""/></q><c x:a=""/></r>',
      [
        '+x=x1',
        '+y=y1',
        'r',
        '+x=x2',
        'q',
        'c',
        '@{x2}a=',
        '@{y1}a=',
        '/c',
        '/q',
        '-x',
        'c',
        '@{x1}a=',
        '/c',
        '/r',
        '-x',
        '-y',
      ],
    ],
    [
      'an end tag with the URI its start tag had',
      '<root xmlns:p="urn:outer"><p:item xmlns:p="urn:inner"/><p:item/></root>',
      [
        '+p=urn:outer',
        'root',
        '+p=urn:inner',
        '{urn:inner}item',
        '/{urn:inner}item',
        '-p',
        '{urn:outer}item',
        '/{urn:outer}item',
        '/root',
        '-p',
      ],
    ],
    [
      'a prefixed and an unprefixed attribute in a default namespace',
      '<r xmlns="urn:default" xmlns:p="urn:p"><p:item id="1" p:id="2"/></r>',
      [
        '+=urn:default',
        '+p=urn:p',
        '{urn:default}r',
        '{urn:p}item',
        '@id=1',
        '@{urn:p}id=2',
        '/{urn:p}item',
        '/{urn:default}r',
        '-',
        '-p',
      ],
    ],
    ['an element named xmlns, which is not reserved', '<xmlns/>', ['xmlns', '/xmlns']],
    ['a prefix with name characters', '<r xmlns:color_1-.0="u"/>', ['+color_1-.0=u', 'r', '/r', '-color_1-.0']],
    [
      'an attribute value that looks like an unbound QName',
      '<r xmlns:xsi="urn:xsi" xsi:type="bar:Bar"/>',
      ['+xsi=urn:xsi', 'r', '@{urn:xsi}type=bar:Bar', '/r', '-xsi'],
    ],
    [
      'a namespace name that is the normalized value',
      '<p:r xmlns:p="a&amp;b&#9;c"/>',
      ['+p=a&b\tc', '{a&b\tc}r', '/{a&b\tc}r', '-p'],
    ],
    [
      'a namespace name from an entity',
      '<!DOCTYPE p:r [<!ENTITY product "prod">]><p:r xmlns:p="urn:&product;"/>',
      ['+p=urn:prod', '{urn:prod}r', '/{urn:prod}r', '-p'],
    ],
    [
      'a defaulted namespace declaration',
      '<!DOCTYPE p:r [<!ATTLIST p:r xmlns:p CDATA "urn:d">]><p:r/>',
      ['+p=urn:d', '{urn:d}r', '/{urn:d}r', '-p'],
    ],
    [
      'undeclaring a prefix in XML 1.1 (Namespaces 1.1 §5)',
      '<?xml version="1.1"?><p:a xmlns:p="u"><b xmlns:p=""/></p:a>',
      ['+p=u', '{u}a', '+p=', 'b', '/b', '-p', '/{u}a', '-p'],
    ],
  ])('%s', (_title, xml, names) => {
    expect(namesEveryWay(xml)).toEqual(names);
  });

  it('reads 3,000 nested elements that each declare a prefix', () => {
    const depth = 3000;
    const open = Array.from({ length: depth }, (_, i) => `<p${i}:e xmlns:p${i}="urn:${i}">`).join('');
    const close = Array.from({ length: depth }, (_, i) => `</p${depth - 1 - i}:e>`).join('');
    const names = namesEveryWay(open + close, { limits: { elementDepth: depth } });
    expect(names).toHaveLength(depth * 4);
    expect(names.slice(-2)).toEqual(['/{urn:0}e', '-p0']);
  });

  it('writes the canonical form with qualified names', async () => {
    expect(await readEveryWay('<p:a xmlns:p="urn:p" p:x="1"><p:b/></p:a>')).toBe('<p:a p:x="1"><p:b></p:b></p:a>');
  });
});

describe('SAX agrees with the cursor without namespace processing', () => {
  it.each([
    ['colons anywhere in names', '<a:b:c x:y:z="1"/>', '<a:b:c x:y:z="1"></a:b:c>'],
    ['names starting or ending with a colon', '<_a><:b></:b><c: d:="1"/></_a>', '<_a><:b></:b><c: d:="1"></c:></_a>'],
    ['an unbound prefix', '<p:raw/>', '<p:raw></p:raw>'],
    [
      'two prefixes for one URI on one local name',
      '<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>',
      '<r a:x="1" b:x="2" xmlns:a="u" xmlns:b="u"></r>',
    ],
    ['a reserved prefix', '<xmlns:a xmlns:xmlns="u"/>', '<xmlns:a xmlns:xmlns="u"></xmlns:a>'],
    [
      'a colon in a PI target and an entity name',
      '<!DOCTYPE r [<!ENTITY a:b "x">]><r><?a:b d?>&a:b;</r>',
      '<r><?a:b d?>x</r>',
    ],
  ])('reads %s', async (_title, xml, expected) => {
    expect(await readEveryWay(xml, { namespaceAware: false })).toBe(expected);
  });
});
