import { build, domException, newDocument, serialize } from '@test/helpers/dom.ts';
import { resolver } from '@test/helpers/stubs.ts';
import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { type Document, DOMParser, type Element, PARSER_ERROR_NAMESPACE, XMLSerializer } from '@/index.ts';

/** Parses a string as application/xml. */
function parse(text: string, parser = new DOMParser()): Document {
  return parser.parseFromString(text, 'application/xml');
}

/** The parsererror element of a document, checked to be one. */
function parserError(document: Document): Element {
  const root = document.documentElement as Element;
  expect([root.localName, root.namespaceURI]).toEqual(['parsererror', PARSER_ERROR_NAMESPACE]);
  return root;
}

describe('DOMParser.parseFromString', () => {
  it('parses and serializes back', () => {
    const document = parse('<a xmlns="urn:a"><b c="&amp;"/>t</a>');
    expect(serialize(document)).toBe('<a xmlns="urn:a"><b c="&amp;"/>t</a>');
  });

  it.each(['text/xml', 'application/xml', 'application/xhtml+xml', 'image/svg+xml'] as const)(
    'parses the XML type %s',
    (type) => {
      expect(new DOMParser().parseFromString('<r/>', type).documentElement?.nodeName).toBe('r');
    }
  );

  it('raises NOT_SUPPORTED_ERR for text/html, as exemplar parses only XML', () => {
    expect(() => new DOMParser().parseFromString('<a/>', 'text/html')).toThrow(domException('NotSupportedError'));
  });

  it.each(['text/plain', 'application/json', ''])('raises a TypeError for the type %j', (type) => {
    expect(() => new DOMParser().parseFromString('<a/>', type)).toThrow(TypeError);
  });

  it('reads its argument as a string', () => {
    const document = new DOMParser().parseFromString({ toString: () => '<r/>' } as unknown as string, 'text/xml');
    expect(document.documentElement?.nodeName).toBe('r');
  });

  it('parses with the factory it is given', () => {
    const parser = new DOMParser(new XMLInputFactory({ namespaceAware: false }));
    expect(parse('<p:r/>', parser).documentElement?.nodeName).toBe('p:r');
  });
});

describe('DOMParser.parseFromString: documents that are not well-formed', () => {
  it('gives a parsererror document for input that is not well-formed, as Firefox does', () => {
    const root = parserError(parse('<a><b></a>'));
    expect(root.textContent).toContain('Line Number 1, Column 9');
  });

  it('describes the error, its location and the line it is on, with a caret under the column', () => {
    const document = parse('<a>\n<b></a>');
    expect(serialize(document)).toBe(
      `<parsererror xmlns="${PARSER_ERROR_NAMESPACE}">XML Parsing Error: Expected &lt;/b&gt;\n` +
        'Location: about:blank\nLine Number 2, Column 6:' +
        '<sourcetext>&lt;b&gt;&lt;/a&gt;\n-----^</sourcetext></parsererror>'
    );
  });

  it('declares the parsererror namespace on the element', () => {
    const root = parserError(parse('<'));
    expect(root.getAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns')).toBe(PARSER_ERROR_NAMESPACE);
    expect(root.lookupNamespaceURI(null)).toBe(PARSER_ERROR_NAMESPACE);
  });

  it('puts the caret at the first column with no dashes', () => {
    const source = parserError(parse('</a>')).lastChild as Element;
    expect(source.textContent).toBe('</a>\n^');
  });

  it('counts CR, LF and CRLF as line ends, as XML does (§2.11)', () => {
    const source = parserError(parse('<a>\r\n\r<b></a>')).lastChild as Element;
    expect([source.localName, source.textContent]).toEqual(['sourcetext', '<b></a>\n-----^']);
  });

  it('gives an empty source line for empty input', () => {
    const root = parserError(parse(''));
    expect(root.lastChild?.textContent).toBe('\n^');
  });

  it('locates an error in an external entity, and leaves out a source line it does not have', () => {
    const factory = new XMLInputFactory({
      accessExternalEntities: 'all',
      entityResolver: resolver({ 'e.xml': '\n\n\n\n<bad' }, 'file:///ext/'),
    });
    const root = parserError(parse('<!DOCTYPE r [<!ENTITY e SYSTEM "e.xml">]><r>&e;</r>', new DOMParser(factory)));
    expect(root.textContent).toContain('Location: file:///ext/e.xml\nLine Number 5, Column 5:');
    expect(root.childNodes).toHaveLength(1);
  });

  it('lets an error that is not an XMLError through', () => {
    const factory = new XMLInputFactory({
      errorHandler: {
        fatalError: () => {
          throw new RangeError('from the handler');
        },
      },
    });
    expect(() => parse('<a>', new DOMParser(factory))).toThrow(RangeError);
  });

  it('gives a document that can be used like any other', () => {
    const document = parse('<a>');
    document.documentElement?.appendChild(document.createElementNS(PARSER_ERROR_NAMESPACE, 'extra'));
    expect(document.getElementsByTagNameNS(PARSER_ERROR_NAMESPACE, '*')).toHaveLength(3);
  });
});

describe('XMLSerializer.serializeToString', () => {
  it('writes no XML declaration, as browsers do', () => {
    const document = build('<?xml version="1.1" encoding="UTF-8" standalone="yes"?><r/>');
    expect(serialize(document)).toBe('<r/>');
  });

  it('escapes text and attribute values so that they read back the same', () => {
    const document = build('<r a="&lt;&amp;&quot;&#9;&#10;&#13;">a&amp;b&lt;c&gt;]]&gt;&#13;</r>');
    expect(serialize(document)).toBe('<r a="&lt;&amp;&quot;&#9;&#10;&#13;">a&amp;b&lt;c&gt;]]&gt;&#13;</r>');
  });

  it('writes CDATA sections, comments and processing instructions', () => {
    expect(serialize(build('<!--a--><r><![CDATA[<x>]]><!--c--><?pi d?></r><?e?>'))).toBe(
      '<!--a--><r><![CDATA[<x>]]><!--c--><?pi d?></r><?e?>'
    );
  });

  it('writes the document type with its identifiers and internal subset', () => {
    expect(serialize(build('<!DOCTYPE r PUBLIC "p" "s" [<!ENTITY e "x">]><r/>'))).toBe(
      '<!DOCTYPE r PUBLIC "p" "s" [<!ENTITY e "x">]><r/>'
    );
    expect(serialize(build('<!DOCTYPE r SYSTEM "s"><r/>'))).toBe('<!DOCTYPE r SYSTEM "s"><r/>');
  });

  it('writes entity references as references', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>', { replaceEntityReferences: false });
    expect(serialize(document.documentElement as Element)).toBe('<r>&e;</r>');
  });

  it('writes an element, declaring the namespaces in scope that it uses', () => {
    const document = build('<r xmlns="urn:a" xmlns:p="urn:p"><p:c p:x="1"><d/></p:c></r>');
    expect(serialize(document.documentElement?.firstChild as Element)).toBe(
      '<p:c xmlns:p="urn:p" p:x="1"><d xmlns="urn:a"/></p:c>'
    );
  });

  it('declares the namespaces a built tree uses', () => {
    const document = parse('<r/>');
    const e = document.createElementNS('urn:n', 'n:e');
    e.setAttributeNS('urn:m', 'm:at', 'v');
    document.documentElement?.appendChild(e);
    expect(serialize(document)).toBe('<r><n:e xmlns:n="urn:n" xmlns:m="urn:m" m:at="v"/></r>');
  });

  it('makes up a prefix for an attribute in a namespace that has none', () => {
    const document = newDocument();
    const e = document.createElementNS('urn:a', 'a:e');
    e.setAttributeNS('urn:b', 'x', '1');
    document.appendChild(e);
    expect(serialize(document)).toBe('<a:e xmlns:a="urn:a" xmlns:ns1="urn:b" ns1:x="1"/>');
  });

  it('writes DOM Level 1 nodes by their names', () => {
    const document = newDocument();
    const e = document.createElement('p:l');
    e.setAttribute('xmlns:p', 'urn:p');
    e.setAttribute('p:a', 'v');
    expect(serialize(e)).toBe('<p:l xmlns:p="urn:p" p:a="v"/>');
  });

  it('writes the children of a fragment', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('a'));
    fragment.appendChild(document.createComment('b'));
    expect(serialize(fragment)).toBe('<a/><!--b-->');
  });

  it('writes nothing for entities and notations', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "x"><!NOTATION n SYSTEM "n">]><r/>');
    expect([
      serialize(document.doctype?.entities.item(0) as Element),
      serialize(document.doctype?.notations.item(0) as Element),
    ]).toEqual(['', '']);
  });

  it('writes a tree that is not well-formed as it is, without checking', () => {
    expect(serialize(newDocument().createComment('a--b'))).toBe('<!--a--b-->');
  });

  it('keeps one serializer usable for many nodes', () => {
    const serializer = new XMLSerializer();
    expect([serializer.serializeToString(build('<a/>')), serializer.serializeToString(build('<b/>'))]).toEqual([
      '<a/>',
      '<b/>',
    ]);
  });
});
