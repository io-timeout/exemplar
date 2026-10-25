import { element, failure, fakeTree, present, tree } from '@test/helpers/c14n.ts';
import { describe, expect, it } from 'vitest';
import { DocumentBuilder } from '@exemplarjs/dom';
import { ErrorCode, XMLInputFactory } from '@exemplarjs/xml';
import { type CanonicalMethod, canonicalize } from '@/index.ts';
import { isNode } from '@/tree.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

describe('isNode', () => {
  it('recognizes DOM nodes and node-like objects by a numeric nodeType', () => {
    expect(isNode(tree('<a/>'))).toBe(true);
    expect(isNode({ nodeType: 1 })).toBe(true);
  });

  it.each([
    ['a string', '<a/>'],
    ['bytes', new Uint8Array([0x3c])],
    ['a source object', { text: '<a/>' }],
    ['an object whose nodeType is not a number', { nodeType: '1' }],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_, value) => {
    expect(isNode(value)).toBe(false);
  });
});

describe('canonicalize: a DOM document', () => {
  it('writes the root, with top-level comments and processing instructions on lines of their own', () => {
    const doc = tree('<!--1--><?p d?><!DOCTYPE a [<!ELEMENT a ANY>]><a>x</a><!--2--><?q?>');
    expect(canonicalize(doc)).toBe('<?p d?>\n<a>x</a>\n<?q?>');
    expect(canonicalize(doc, { comments: true })).toBe('<!--1-->\n<?p d?>\n<a>x</a>\n<!--2-->\n<?q?>');
  });

  it('writes entity reference nodes as their content', () => {
    const factory = new XMLInputFactory({ replaceEntityReferences: false });
    const doc = tree('<!DOCTYPE a [<!ENTITY e "<b>x&amp;</b>">]><a>&e;</a>', factory);
    expect(canonicalize(doc)).toBe('<a><b>x&amp;</b></a>');
  });

  it('writes CDATA section nodes as text', () => {
    const doc = tree('<a><![CDATA[<&>]]></a>', new XMLInputFactory({ coalescing: false }));
    expect(canonicalize(doc)).toBe('<a>&lt;&amp;&gt;</a>');
  });
});

describe('canonicalize: an element as the apex of a document subset (C14N §2.4)', () => {
  const doc = tree(
    '<r xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q" xml:lang="en" xml:space="preserve" xml:id="i" xml:foo="f" xml:base="http://e.com/x/">' +
      '<m xmlns:q="urn:q2" xml:lang="fr" xml:base="y/"><p:e q:a="1" xml:base="z"><f xmlns:p="urn:p"/></p:e></m></r>'
  );
  const apex = element(doc, 'p:e');

  it.each([
    ['c14n', 'xml:base="z" xml:foo="f" xml:id="i" xml:lang="fr" xml:space="preserve"'],
    ['c14n11', 'xml:base="http://e.com/x/y/z" xml:lang="fr" xml:space="preserve"'],
  ] as [CanonicalMethod, string][])(
    '%s renders every namespace in scope on the apex, and inherits xml: attributes',
    (method, xml) => {
      expect(canonicalize(apex, { method })).toBe(
        `<p:e xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q2" ${xml} q:a="1"><f></f></p:e>`
      );
    }
  );

  it('exc-c14n renders only the namespaces the subset uses, and inherits no xml: attributes', () => {
    expect(canonicalize(apex, { method: 'exc-c14n' })).toBe(
      '<p:e xmlns:p="urn:p" xmlns:q="urn:q2" xml:base="z" q:a="1"><f xmlns="urn:d"></f></p:e>'
    );
    expect(canonicalize(apex, { method: 'exc-c14n', inclusivePrefixes: ['#default'] })).toBe(
      '<p:e xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q2" xml:base="z" q:a="1"><f></f></p:e>'
    );
  });

  it('keeps an xml: attribute of the apex over its ancestors', () => {
    const b = element(tree('<r xml:lang="en"><b xml:lang="de"/></r>'), 'b');
    for (const method of ['c14n', 'c14n11'] as const) expect(canonicalize(b, { method })).toBe('<b xml:lang="de"></b>');
  });

  it('renders no default namespace on an apex where none is in scope', () => {
    const b = element(tree('<r xmlns:p="urn:p"><b/></r>'), 'b');
    expect(canonicalize(b)).toBe('<b xmlns:p="urn:p"></b>');
  });

  it('writes an element not attached to its document the same way', () => {
    const doc = new DocumentBuilder().newDocument();
    const e = doc.createElementNS('urn:p', 'p:e');
    e.setAttributeNS(XMLNS, 'xmlns:p', 'urn:p');
    e.appendChild(doc.createTextNode('t'));
    expect(canonicalize(e)).toBe('<p:e xmlns:p="urn:p">t</p:e>');
  });
});

describe('canonicalize: xml:base fix-up in Canonical XML 1.1 (C14N 1.1 §2.4)', () => {
  /** The xml:base the element `e` gets as an apex under Canonical XML 1.1. */
  const baseOf = (xml: string): string | undefined => {
    const apex = element(tree(xml), 'e');
    return /xml:base="([^"]*)"/.exec(canonicalize(apex, { method: 'c14n11' }))?.[1];
  };

  it.each([
    [
      'joins relative values onto an absolute base',
      '<r xml:base="http://e.com/a/"><m xml:base="b/"><e xml:base="c"/></m></r>',
      'http://e.com/a/b/c',
    ],
    [
      'resolves dot segments against an absolute base',
      '<r xml:base="http://e.com/a/b/"><e xml:base="../c/"/></r>',
      'http://e.com/a/c/',
    ],
    [
      'inherits an absolute base the apex does not change',
      '<r xml:base="http://e.com/a/b"><e/></r>',
      'http://e.com/a/b',
    ],
    ['keeps an absolute value of the apex', '<r xml:base="http://e.com/a/"><e xml:base="urn:x"/></r>', 'urn:x'],
    [
      'replaces the last segment of a base not ending in /',
      '<r xml:base="http://e.com/a/b"><e xml:base="c"/></r>',
      'http://e.com/a/c',
    ],
    ['joins relative values onto a relative base', '<r xml:base="a/"><m xml:base="b/"/><e xml:base="c/"/></r>', 'a/c/'],
    ['replaces the last segment of a relative base', '<r xml:base="a/b"><e xml:base="c"/></r>', 'a/c'],
    ['keeps the apex value with no ancestor base', '<r><e xml:base="c"/></r>', 'c'],
    ['inherits a relative base the apex does not change', '<r xml:base="something/else"><e/></r>', 'something/else'],
    ['resolves dot segments against a relative base', '<r xml:base="a/b/"><e xml:base="../c/"/></r>', 'a/c/'],
    ['takes an absolute path over a relative base', '<r xml:base="a/b"><e xml:base="/c"/></r>', '/c'],
    ['keeps leading .. segments', '<r xml:base=".."><m xml:base=".."><e xml:base="x"/></m></r>', '../../x'],
    [
      'joins the values of every omitted ancestor, innermost first',
      '<a xml:base="foo/bar"><b xml:base=".."><c xml:base=".."><e xml:base="x"/></c></b></a>',
      '../x',
    ],
    [
      'changes no case and escapes nothing in an absolute base',
      '<r xml:base="http://E.com/a b/"><e xml:base="y/"/></r>',
      'http://E.com/a b/y/',
    ],
  ])('%s', (_, xml, base) => {
    expect(baseOf(xml)).toBe(base);
  });

  it('gives the recommendation’s §3.8 values to e1 and e3 as apexes', () => {
    const doc = tree(
      '<doc xmlns="http://www.ietf.org" xml:base="something/else"><e1><e2 xmlns="" xml:base="bar/"><e3 xml:base="foo"/></e2></e1></doc>'
    );
    const base = (name: string) =>
      /xml:base="([^"]*)"/.exec(canonicalize(element(doc, name), { method: 'c14n11' }))?.[1];
    expect(base('e1')).toBe('something/else');
    expect(base('e3')).toBe('something/bar/foo');
  });

  it('writes no xml:base when the apex value joins to nothing (§2.4: "abc/" and "../")', () => {
    expect(baseOf('<r xml:base="abc/"><e xml:base="../"/></r>')).toBeUndefined();
  });

  it('writes no xml:base when neither the apex nor an ancestor has one', () => {
    expect(baseOf('<r><e/></r>')).toBeUndefined();
  });

  it('writes no xml:base when the values join to nothing, as libxml2 does', () => {
    expect(baseOf('<r xml:base=""><e/></r>')).toBeUndefined();
  });
});

describe('canonicalize: other nodes', () => {
  const doc = tree('<a b="1"><!--c--><?p d?>x&amp;y</a>');
  const a = element(doc, 'a');

  it('writes a text node as escaped text', () => {
    expect(canonicalize(present(a.lastChild))).toBe('x&amp;y');
  });

  it('writes a comment only when asked, and a processing instruction', () => {
    expect(canonicalize(present(a.firstChild))).toBe('');
    expect(canonicalize(present(a.firstChild), { comments: true })).toBe('<!--c-->');
    const pi = present(a.childNodes.item(1));
    expect(canonicalize(pi)).toBe('<?p d?>');
  });

  it('writes a document fragment as its children in order', () => {
    const fragment = doc.createDocumentFragment();
    fragment.appendChild(doc.createElement('x'));
    fragment.appendChild(doc.createTextNode('t<'));
    expect(canonicalize(fragment)).toBe('<x></x>t&lt;');
  });

  it('writes nothing for an attribute or a document type, which have no canonical form of their own', () => {
    const attribute = present(a.getAttributeNode('b'));
    const doctype = present(tree('<!DOCTYPE a []><a/>').doctype);
    expect(canonicalize(attribute)).toBe('');
    expect(canonicalize(doctype)).toBe('');
  });
});

describe('canonicalize: DOM Level 1 nodes', () => {
  it('reads namespace declarations and xml: attributes from qualified names alone', () => {
    const doc = new DocumentBuilder().newDocument();
    const e = doc.createElement('p:e');
    e.setAttribute('xml:lang', 'en');
    e.setAttribute('xmlns:p', 'urn:p');
    e.setAttribute('b', '1');
    doc.appendChild(e);
    expect(canonicalize(doc)).toBe('<p:e xmlns:p="urn:p" b="1" xml:lang="en"></p:e>');
  });
});

describe('canonicalize: plain node-like trees', () => {
  it('canonicalizes any tree that has the DOM Level 2 properties', () => {
    const node = fakeTree({
      type: 9,
      children: [
        { type: 7, name: 'p', value: null },
        {
          type: 1,
          name: 'p:e',
          localName: 'e',
          namespaceURI: 'urn:p',
          attributes: [
            { type: 2, name: 'xmlns:p', localName: 'p', namespaceURI: XMLNS, value: 'urn:p' },
            { type: 2, name: 'xml:lang', localName: 'lang', namespaceURI: XML, value: null },
          ],
          children: [
            { type: 3, value: null },
            { type: 8, value: null },
            { type: 3, value: '&' },
          ],
        },
      ],
    });
    expect(canonicalize(node, { comments: true })).toBe('<?p?>\n<p:e xmlns:p="urn:p" xml:lang=""><!---->&amp;</p:e>');
  });

  it('takes a declaration without a value as undeclaring', () => {
    const node = fakeTree({
      type: 1,
      name: 'e',
      attributes: [{ type: 2, name: 'xmlns', value: null }],
    });
    expect(canonicalize(node)).toBe('<e></e>');
  });

  it('inherits from ancestors whose xml: attributes have no value', () => {
    const root = fakeTree({
      type: 1,
      name: 'r',
      attributes: [
        { type: 2, name: 'xmlns:p', value: null },
        { type: 2, name: 'xml:lang', value: null },
        { type: 2, name: 'xml:base', value: null },
      ],
      children: [{ type: 1, name: 'e', attributes: [{ type: 2, name: 'xml:base', value: 'http://e.com/' }] }],
    });
    const e = present(root.firstChild);
    expect(canonicalize(e)).toBe('<e xml:base="http://e.com/" xml:lang=""></e>');
    expect(canonicalize(e, { method: 'c14n11' })).toBe('<e xml:base="http://e.com/" xml:lang=""></e>');
  });

  it('puts text in Normalization Form C by the encoding the document declares, or else the one detected', () => {
    /** A document of one element holding decomposed text, canonicalized. */
    const text = (encodings: { xmlEncoding?: string | null; inputEncoding?: string | null }): string =>
      canonicalize(
        fakeTree({
          type: 9,
          ...encodings,
          children: [{ type: 1, name: 'a', children: [{ type: 3, value: 'e\u0301' }] }],
        })
      );
    expect(text({ xmlEncoding: 'ISO-8859-1', inputEncoding: 'utf-8' })).toBe('<a>\u00E9</a>');
    expect(text({ xmlEncoding: null, inputEncoding: 'windows-1252' })).toBe('<a>\u00E9</a>');
    expect(text({ xmlEncoding: 'UTF-8', inputEncoding: 'windows-1252' })).toBe('<a>e\u0301</a>');
    expect(text({})).toBe('<a>e\u0301</a>');
  });
});

describe('canonicalize: what a tree is refused for', () => {
  it.each(['c14n', 'c14n11', 'exc-c14n'] as const)(
    '%s fails with C14N_VERSION on a node of an XML 1.1 document',
    (method) => {
      const doc = tree('<?xml version="1.1"?><a><b/></a>');
      expect(failure(doc, { method })).toBe(ErrorCode.C14N_VERSION);
      expect(failure(element(doc, 'b'), { method })).toBe(ErrorCode.C14N_VERSION);
    }
  );

  it.each(['c14n', 'c14n11', 'exc-c14n'] as const)(
    '%s fails with C14N_RELATIVE_NAMESPACE on a relative namespace in the subset',
    (method) => {
      const doc = tree('<r><a xmlns:p="rel"><b/></a></r>');
      expect(failure(doc, { method })).toBe(ErrorCode.C14N_RELATIVE_NAMESPACE);
      expect(() => canonicalize(element(doc, 'a'), { method })).toThrow(
        expect.objectContaining({ code: ErrorCode.C14N_RELATIVE_NAMESPACE, line: 0, column: 0 })
      );
    }
  );

  it.each(['c14n', 'c14n11', 'exc-c14n'] as const)(
    '%s fails with C14N_RELATIVE_NAMESPACE on a relative namespace the apex inherits (C14N §2.1)',
    (method) => {
      /** The failure of the element `e` as an apex. */
      const apex = (xml: string, name = 'e') => failure(element(tree(xml), name), { method });
      expect(apex('<r xmlns:p="rel"><e/></r>')).toBe(ErrorCode.C14N_RELATIVE_NAMESPACE);
      expect(apex('<r xmlns:p="rel"><p:e/></r>', 'p:e')).toBe(ErrorCode.C14N_RELATIVE_NAMESPACE);
      expect(apex('<r xmlns="rel"><m><e/></m></r>')).toBe(ErrorCode.C14N_RELATIVE_NAMESPACE);
    }
  );

  it('canonicalizes an apex whose own declaration hides an ancestor’s relative namespace', () => {
    const e = element(tree('<r xmlns:p="rel"><e xmlns:p="urn:p"/></r>'), 'e');
    expect(canonicalize(e)).toBe('<e xmlns:p="urn:p"></e>');
  });
});
