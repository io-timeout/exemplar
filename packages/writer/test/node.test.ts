import { canonical, names } from '@test/helpers/canonical.ts';
import { codeOf, written } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import { type StreamWriter, type WritableNode } from '@/index.ts';
import { writeNode } from '@/node.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** A mutable DOM-like node, enough for the writer to read. */
type Node = { -readonly [K in keyof WritableNode]: WritableNode[K] };

/** Makes a node with its children linked under it; `attributes` makes it an element's attribute map. */
function make(
  fields: Partial<Node> & Pick<Node, 'nodeType' | 'nodeName'>,
  children: Node[] = [],
  attributes?: Node[]
): Node {
  const node: Node = {
    nodeValue: null,
    namespaceURI: null,
    localName: null,
    prefix: null,
    firstChild: children[0] ?? null,
    nextSibling: null,
    parentNode: null,
    attributes: attributes === undefined ? null : { length: attributes.length, item: (i) => attributes[i] ?? null },
    ...fields,
  };
  for (const [i, child] of children.entries()) {
    child.parentNode = node;
    child.nextSibling = children[i + 1] ?? null;
  }
  return node;
}

/** Splits a qualified name into prefix and local name, the prefix null when there is none. */
function parts(qName: string): [string | null, string] {
  const colon = qName.indexOf(':');
  return colon === -1 ? [null, qName] : [qName.slice(0, colon), qName.slice(colon + 1)];
}

/** A DOM Level 2 element, created with createElementNS. */
function element(qName: string, uri: string | null, attributes: Node[] = [], children: Node[] = []): Node {
  const [prefix, localName] = parts(qName);
  return make({ nodeType: 1, nodeName: qName, namespaceURI: uri, prefix, localName }, children, attributes);
}

/** A DOM Level 2 attribute, created with createAttributeNS; namespace declarations go in the xmlns namespace. */
function attribute(qName: string, value: string, uri: string | null = null): Node {
  const [prefix, localName] = parts(qName);
  const ns = uri ?? (qName === 'xmlns' || prefix === 'xmlns' ? XMLNS : null);
  return make({ nodeType: 2, nodeName: qName, nodeValue: value, namespaceURI: ns, prefix, localName });
}

/** A DOM Level 1 element, created with createElement: no namespace, no local name. */
function element1(qName: string, attributes: Node[] = [], children: Node[] = []): Node {
  return make({ nodeType: 1, nodeName: qName }, children, attributes);
}

/** A DOM Level 1 attribute. */
function attribute1(qName: string, value: string): Node {
  return make({ nodeType: 2, nodeName: qName, nodeValue: value });
}

/** A text node. */
const text = (value: string) => make({ nodeType: 3, nodeName: '#text', nodeValue: value });

/** Writes a node with a fresh writer and returns the output. */
function writtenNode(node: Node, options = {}): string {
  return written((w: StreamWriter) => w.writeNode(node), options);
}

describe('writeNode: node types', () => {
  it('writes text, escaped', () => {
    expect(written((w) => (w.writeStartElement('r'), writeNode(w, text('a < b & c'))))).toBe('<r>a &lt; b &amp; c');
  });

  it('writes a CDATA section, an entity reference, a comment and a PI', () => {
    const r = element(
      'r',
      null,
      [],
      [
        make({ nodeType: 4, nodeName: '#cdata-section', nodeValue: 'x < y' }),
        make({ nodeType: 5, nodeName: 'ent' }),
        make({ nodeType: 8, nodeName: '#comment', nodeValue: ' c ' }),
        make({ nodeType: 7, nodeName: 'pi', nodeValue: 'data' }),
        make({ nodeType: 7, nodeName: 'empty', nodeValue: '' }),
      ]
    );
    const dtd = '<!DOCTYPE r [<!ENTITY ent "e">]>';
    expect(written((w) => (w.writeDTD(dtd), w.writeNode(r)))).toBe(
      `${dtd}<r><![CDATA[x < y]]>&ent;<!-- c --><?pi data?><?empty?></r>`
    );
  });

  it('writes nodes with a null value as empty', () => {
    const r = element(
      'r',
      null,
      [],
      [
        make({ nodeType: 3, nodeName: '#text' }),
        make({ nodeType: 4, nodeName: '#cdata-section' }),
        make({ nodeType: 8, nodeName: '#comment' }),
        make({ nodeType: 7, nodeName: 'p' }),
      ]
    );
    expect(writtenNode(r)).toBe('<r><![CDATA[]]><!----><?p?></r>');
  });

  it('writes an attribute node as its value', () => {
    expect(written((w) => (w.writeStartElement('r'), w.writeNode(attribute('a', 'v&w'))))).toBe('<r>v&amp;w');
  });

  it('writes a document: its declaration, its children and its end', () => {
    const doc = make({ nodeType: 9, nodeName: '#document', xmlVersion: '1.1', xmlStandalone: true }, [
      make({ nodeType: 8, nodeName: '#comment', nodeValue: 'c' }),
      element('r', null, [], [text('\u0001')]),
    ]);
    expect(writtenNode(doc)).toBe('<?xml version="1.1" encoding="UTF-8" standalone="yes"?><!--c--><r>&#1;</r>');
  });

  it('writes a document with version 1.0 and no standalone by default', () => {
    const plain = make({ nodeType: 9, nodeName: '#document' }, [element('r', null)]);
    expect(writtenNode(plain)).toBe('<?xml version="1.0" encoding="UTF-8"?><r/>');
    const notStandalone = make({ nodeType: 9, nodeName: '#document', xmlStandalone: false }, [element('r', null)]);
    expect(writtenNode(notStandalone)).toBe('<?xml version="1.0" encoding="UTF-8"?><r/>');
  });

  it('writes text outside an element escaped, as in content, with the checks off', () => {
    const off = { checkWellFormedness: false };
    const fragment = make({ nodeType: 11, nodeName: '#document-fragment' }, [
      text('a&b'),
      element('b', null),
      text('<c>'),
    ]);
    const out = writtenNode(fragment, off);
    expect(out).toBe('a&amp;b<b/>&lt;c&gt;');
    expect(canonical(`<r>${out}</r>`)).toBe('<r>a&amp;b<b></b>&lt;c&gt;</r>');
    expect(writtenNode(text('a&b<c'), off)).toBe('a&amp;b&lt;c');
    expect(writtenNode(attribute('a', 'v&w<'), off)).toBe('v&amp;w&lt;');
  });

  it('writes a document fragment as its children', () => {
    const fragment = make({ nodeType: 11, nodeName: '#document-fragment' }, [text('a'), element('b', null), text('c')]);
    expect(written((w) => (w.writeStartElement('r'), w.writeNode(fragment), w.writeEndElement()))).toBe(
      '<r>a<b/>c</r>'
    );
  });

  it('writes nothing for entities and notations, which belong to their document type', () => {
    const r = element('r', null, [], [make({ nodeType: 6, nodeName: 'e' }), make({ nodeType: 12, nodeName: 'n' })]);
    expect(writtenNode(r)).toBe('<r/>');
  });

  it.each([
    ['a name alone', { name: 'r' }, '<!DOCTYPE r>'],
    ['a system id', { name: 'r', systemId: 'r.dtd' }, '<!DOCTYPE r SYSTEM "r.dtd">'],
    [
      'a public and a system id',
      { name: 'r', publicId: '-//R', systemId: 'r.dtd' },
      '<!DOCTYPE r PUBLIC "-//R" "r.dtd">',
    ],
    ['a public id alone', { name: 'r', publicId: '-//R' }, '<!DOCTYPE r PUBLIC "-//R" "">'],
    ['a system id holding a double quote', { name: 'r', systemId: 'a"b.dtd' }, `<!DOCTYPE r SYSTEM 'a"b.dtd'>`],
    ['an internal subset', { name: 'r', internalSubset: '<!ENTITY e "x">' }, '<!DOCTYPE r [<!ENTITY e "x">]>'],
    [
      'everything',
      { name: 'r', publicId: '-//R', systemId: 'r.dtd', internalSubset: '<!ELEMENT r ANY>' },
      '<!DOCTYPE r PUBLIC "-//R" "r.dtd" [<!ELEMENT r ANY>]>',
    ],
    ['empty ids and subset', { name: 'r', publicId: '', systemId: '', internalSubset: '' }, '<!DOCTYPE r>'],
    ['no name but the node name', {}, '<!DOCTYPE x>'],
  ])('writes a document type with %s', (_title, fields, dtd) => {
    expect(writtenNode(make({ nodeType: 10, nodeName: 'x', ...fields }))).toBe(dtd);
  });
});

describe('writeNode: DOM Level 2 elements and namespaces', () => {
  it('declares an element namespace the tree does not declare', () => {
    expect(writtenNode(element('p:a', 'urn:p'))).toBe('<p:a xmlns:p="urn:p"/>');
    expect(writtenNode(element('a', 'urn:d'))).toBe('<a xmlns="urn:d"/>');
  });

  it('writes the declarations the tree has, and nothing more for names they bind', () => {
    const a = element(
      'p:a',
      'urn:p',
      [attribute('xmlns:p', 'urn:p'), attribute('xmlns', 'urn:d')],
      [element('b', 'urn:d'), element('p:c', 'urn:p')]
    );
    expect(writtenNode(a)).toBe('<p:a xmlns:p="urn:p" xmlns="urn:d"><b/><p:c/></p:a>');
  });

  it('undeclares the default namespace for a child in no namespace', () => {
    const tree = element('a', 'urn:d', [], [element('b', null)]);
    expect(writtenNode(tree)).toBe('<a xmlns="urn:d"><b xmlns=""/></a>');
  });

  it('lets the element name win over a declaration of its own prefix that contradicts it', () => {
    const a = element('p:a', 'urn:right', [attribute('xmlns:p', 'urn:wrong')]);
    expect(writtenNode(a)).toBe('<p:a xmlns:p="urn:right"/>');
  });

  it('skips a declaration of the xml prefix and repeated declarations', () => {
    const a = element('a', null, [
      attribute('xmlns:xml', XML),
      attribute('xmlns:q', 'urn:q'),
      attribute1('xmlns:q', 'urn:q'),
    ]);
    expect(writtenNode(a)).toBe('<a xmlns:q="urn:q"/>');
  });

  it('writes attributes in no namespace, with the xml prefix, and with a prefix in scope', () => {
    const a = element('p:a', 'urn:p', [
      attribute('x', '1'),
      attribute('xml:lang', 'en', XML),
      attribute('p:y', '2', 'urn:p'),
    ]);
    expect(writtenNode(a)).toBe('<p:a xmlns:p="urn:p" x="1" xml:lang="en" p:y="2"/>');
  });

  it('writes an attribute with a null value as empty', () => {
    const a = element('a', null, [make({ nodeType: 2, nodeName: 'x', localName: 'x' })]);
    expect(writtenNode(a)).toBe('<a x=""/>');
  });

  it('declares the prefix an attribute has when nothing binds its namespace', () => {
    const a = element('a', null, [attribute('q:x', '1', 'urn:q')]);
    expect(writtenNode(a)).toBe('<a xmlns:q="urn:q" q:x="1"/>');
  });

  it('uses a prefix bound in scope for an attribute that has none of its own', () => {
    const tree = element(
      'r',
      null,
      [attribute('xmlns:p', 'urn:p')],
      [element('a', null, [attribute('x', '1', 'urn:p')])]
    );
    expect(writtenNode(tree)).toBe('<r xmlns:p="urn:p"><a p:x="1"/></r>');
  });

  it('generates a prefix for an attribute namespace with no prefix, skipping prefixes in use', () => {
    const a = element('a', null, [attribute('xmlns:ns1', 'urn:one'), attribute('x', '1', 'urn:x')]);
    expect(writtenNode(a)).toBe('<a xmlns:ns1="urn:one" xmlns:ns2="urn:x" ns2:x="1"/>');
  });

  it('gives an attribute in the default namespace a prefix, as unprefixed attributes have none', () => {
    const a = element('a', 'urn:d', [attribute('x', '1', 'urn:d')]);
    expect(writtenNode(a)).toBe('<a xmlns="urn:d" xmlns:ns1="urn:d" ns1:x="1"/>');
  });

  it('declares a new prefix when the attribute prefix is bound to another namespace on the element', () => {
    const a = element('p:a', 'urn:1', [attribute('p:x', '1', 'urn:2')]);
    expect(writtenNode(a)).toBe('<p:a xmlns:p="urn:1" xmlns:ns1="urn:2" ns1:x="1"/>');
  });

  it('redeclares an attribute prefix bound to another namespace higher up', () => {
    const tree = element('p:r', 'urn:1', [], [element('a', null, [attribute('p:x', '1', 'urn:2')])]);
    expect(writtenNode(tree)).toBe('<p:r xmlns:p="urn:1"><a xmlns:p="urn:2" p:x="1"/></p:r>');
  });

  it('gives what it writes the namespaces the tree has', () => {
    const tree = element(
      'p:r',
      'urn:p',
      [attribute('xmlns', 'urn:d')],
      [element('a', 'urn:d', [attribute('q:x', '1', 'urn:q'), attribute('y', '2')]), element('b', null)]
    );
    expect(names(writtenNode(tree))).toEqual([
      '{urn:p}r',
      '{urn:d}a',
      '@y=2',
      '@{urn:q}x=1',
      '/{urn:d}a',
      'b',
      '/b',
      '/{urn:p}r',
    ]);
  });
});

describe('writeNode: DOM Level 1 elements', () => {
  it('splits a qualified name and finds its namespace in the declarations of the element and its ancestors', () => {
    const tree = element1(
      'p:r',
      [attribute1('xmlns:p', 'urn:p'), attribute1('xmlns', 'urn:d')],
      [element1('p:a'), element1('b')]
    );
    expect(writtenNode(tree)).toBe('<p:r xmlns:p="urn:p" xmlns="urn:d"><p:a/><b/></p:r>');
    expect(names(writtenNode(tree))).toEqual([
      '{urn:p}r',
      '{urn:p}a',
      '/{urn:p}a',
      '{urn:d}b',
      '/{urn:d}b',
      '/{urn:p}r',
    ]);
  });

  it('puts the xml prefix in the XML namespace without a declaration', () => {
    const r = element1('r', [attribute1('xml:lang', 'en')]);
    expect(writtenNode(r)).toBe('<r xml:lang="en"/>');
  });

  it('finds an attribute prefix in the declarations', () => {
    const r = element1('r', [attribute1('xmlns:q', 'urn:q'), attribute1('q:x', '1'), attribute1('y', '2')]);
    expect(writtenNode(r)).toBe('<r xmlns:q="urn:q" q:x="1" y="2"/>');
  });

  it('writes a declaration with no value as one undeclaring the default namespace', () => {
    const tree = element('a', 'urn:d', [], [element1('b', [make({ nodeType: 2, nodeName: 'xmlns' })])]);
    expect(writtenNode(tree)).toBe('<a xmlns="urn:d"><b xmlns=""/></a>');
  });

  it('refuses an element prefix nothing declares, rather than write a name no namespace binds', () => {
    expect(() => writtenNode(element1('p:a'))).toThrow(expect.objectContaining({ code: 'WRITE_UNBOUND_PREFIX' }));
  });

  it.each([
    ['an attribute prefix nothing declares', element1('r', [attribute1('xsi:type', 't')]), '<r xsi:type="t"/>'],
    ['an element name starting with a colon', element1(':b'), '<:b/>'],
    ['a name with two colons', element1('r', [attribute1('a:b:c', 'B')]), '<r a:b:c="B"/>'],
    ['a name ending with a colon', element1('r', [attribute1('xmlns:', 'u')]), '<r xmlns:="u"/>'],
    [
      'an attribute set by name on a namespaced element',
      element('a', 'urn:a', [attribute1('p:x', '1')]),
      '<a xmlns="urn:a" p:x="1"/>',
    ],
  ])('writes %s exactly as named, with the checks off', (_title, node, out) => {
    expect(writtenNode(node, { checkWellFormedness: false })).toBe(out);
  });

  it.each([
    [
      'an attribute prefix nothing declares, as for an element',
      element1('r', [attribute1('q:x', '1')]),
      'WRITE_UNBOUND_PREFIX',
    ],
    ['a name with two colons', element1('r', [attribute1('a:b:c', 'B')]), 'WRITE_NAME'],
    ['an element name starting with a colon', element1(':b'), 'WRITE_NAME'],
  ])('refuses %s with the checks on, rather than rename it', (_title, node, code) => {
    expect(codeOf((w) => w.writeNode(node))).toBe(code);
  });

  it('keeps an attribute prefix where the writer binds another prefix to its namespace', () => {
    const c = element1('c', [attribute1('p:x', '1')]);
    element1('r', [attribute1('xmlns:p', 'urn:p')], [c]);
    const out = written((w) => {
      w.writeStartElement('w');
      w.writeNamespace('q', 'urn:p');
      w.writeNode(c);
      w.writeEndDocument();
    });
    expect(out).toBe('<w xmlns:q="urn:p"><c xmlns:p="urn:p" p:x="1"/></w>');
  });

  it('reads an element with no attribute map', () => {
    const r = make({ nodeType: 1, nodeName: 'r' }, [text('t')]);
    expect(writtenNode(r)).toBe('<r>t</r>');
  });
});

describe('writeNode to a writer that is not namespace-aware', () => {
  const unaware = { namespaceAware: false };

  it('writes every name as the node gives it, declaring nothing', () => {
    const tree = element(
      'p:r',
      'urn:p',
      [attribute('xmlns:p', 'urn:p'), attribute('q:x', '1', 'urn:q')],
      [element1('a:b:c', [attribute1('xmlns', 'urn:d')]), element('s:e', 'urn:s')]
    );
    expect(writtenNode(tree, unaware)).toBe('<p:r xmlns:p="urn:p" q:x="1"><a:b:c xmlns="urn:d"/><s:e/></p:r>');
  });

  it('writes a document and its children', () => {
    const doc = make({ nodeType: 9, nodeName: '#document' }, [element1('p:r', [], [text('t')])]);
    expect(writtenNode(doc, unaware)).toBe('<?xml version="1.0" encoding="UTF-8"?><p:r>t</p:r>');
  });

  it('writes an attribute with a null value as empty', () => {
    const a = element1('a', [make({ nodeType: 2, nodeName: 'p:x' })]);
    expect(writtenNode(a, unaware)).toBe('<a p:x=""/>');
  });
});
