import { build, children, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it, vi } from 'vitest';
import {
  type Attr,
  CDATASection,
  Comment,
  DOMImplementation,
  Document,
  DocumentFragment,
  type DocumentType,
  type Element,
  Entity,
  EntityReference,
  type Node,
  Notation,
  ProcessingInstruction,
  Text,
  UserDataOperation,
} from '@/index.ts';

const XMLNS = 'http://www.w3.org/2000/xmlns/';

const DTD = `<!DOCTYPE r PUBLIC "-//P//EN" "r.dtd" [
<!ENTITY t "text">
<!ENTITY m "<b>bold</b>">
<!ENTITY u SYSTEM "u.bin" NDATA n>
<!NOTATION n PUBLIC "-//N//EN" "n.sys">
<!ATTLIST r d CDATA "dv">
]>`;

/** A document with the DTD above, its references kept, and its element r holding `&t;&m;`. */
function withDtd(): Document {
  return build(`${DTD}<r a="1">&t;&m;</r>`, { replaceEntityReferences: false, supportExternalEntities: false });
}

const XML = 'http://www.w3.org/XML/1998/namespace';

describe('Document (DOM Level 3)', () => {
  it('is a document node named #document, owned by no document', () => {
    const document = newDocument();
    expect([document.nodeType, document.nodeName, document.ownerDocument, document.nodeValue]).toEqual([
      9,
      '#document',
      null,
      null,
    ]);
  });

  it('gives its document element and document type', () => {
    const document = withDtd();
    expect([document.documentElement?.nodeName, document.doctype?.name]).toEqual(['r', 'r']);
    expect([newDocument().documentElement, newDocument().doctype]).toEqual([null, null]);
  });

  it('gives and sets its document URI, which is its base URI', () => {
    const document = newDocument();
    expect([document.documentURI, document.baseURI]).toEqual([null, null]);
    document.documentURI = 'http://example.com/d.xml';
    expect([document.documentURI, document.baseURI]).toEqual(['http://example.com/d.xml', 'http://example.com/d.xml']);
  });

  it('defaults its XML properties', () => {
    const document = newDocument();
    expect([document.xmlVersion, document.xmlStandalone, document.xmlEncoding, document.inputEncoding]).toEqual([
      '1.0',
      false,
      null,
      null,
    ]);
    expect(document.strictErrorChecking).toBe(true);
  });

  it('sets xmlStandalone and xmlVersion', () => {
    const document = newDocument();
    document.xmlStandalone = true;
    document.xmlVersion = '1.1';
    expect([document.xmlStandalone, document.xmlVersion]).toEqual([true, '1.1']);
  });

  it('raises NOT_SUPPORTED_ERR for an XML version it does not support', () => {
    expect(() => (newDocument().xmlVersion = '2.0')).toThrow(domException('NotSupportedError'));
  });

  it('keeps one configuration', () => {
    const document = newDocument();
    expect(document.domConfig).toBe(document.domConfig);
  });

  it('has the implementation that made it', () => {
    const implementation = new DOMImplementation();
    expect(new Document(implementation).implementation).toBe(implementation);
    expect(new Document().implementation).toBeInstanceOf(DOMImplementation);
  });
});

describe('the Document factory methods (DOM Level 2)', () => {
  const document = newDocument();

  it('make nodes owned by the document', () => {
    const nodes: Node[] = [
      document.createElement('e'),
      document.createAttribute('a'),
      document.createTextNode('t'),
      document.createComment('c'),
      document.createCDATASection('d'),
      document.createProcessingInstruction('p', 'q'),
      document.createDocumentFragment(),
      document.createEntityReference('r'),
    ];
    expect(nodes.map((n) => [n.nodeType, n.ownerDocument === document, n.parentNode])).toEqual([
      [1, true, null],
      [2, true, null],
      [3, true, null],
      [8, true, null],
      [4, true, null],
      [7, true, null],
      [11, true, null],
      [5, true, null],
    ]);
  });

  it('make nodes of the right classes', () => {
    expect(document.createTextNode('t')).toBeInstanceOf(Text);
    expect(document.createComment('c')).toBeInstanceOf(Comment);
    expect(document.createCDATASection('d')).toBeInstanceOf(CDATASection);
    expect(document.createProcessingInstruction('p', '')).toBeInstanceOf(ProcessingInstruction);
    expect(document.createDocumentFragment()).toBeInstanceOf(DocumentFragment);
    expect(document.createEntityReference('r')).toBeInstanceOf(EntityReference);
  });

  it('convert data to strings', () => {
    const n = 5 as unknown as string;
    expect([
      document.createTextNode(n).data,
      document.createComment(n).data,
      document.createCDATASection(n).data,
      document.createProcessingInstruction('p', n).data,
    ]).toEqual(['5', '5', '5', '5']);
  });

  it('make DOM Level 1 elements and attributes, with no local name', () => {
    const e = document.createElement('p:e');
    const a = document.createAttribute('p:a');
    expect([e.localName, e.namespaceURI, e.prefix, a.localName, a.namespaceURI]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it.each([
    ['createElement', () => document.createElement('1e')],
    ['createAttribute', () => document.createAttribute('a b')],
    ['createProcessingInstruction', () => document.createProcessingInstruction('1p', '')],
    ['createEntityReference', () => document.createEntityReference('-r')],
  ])('%s raises INVALID_CHARACTER_ERR for a name that is not an XML name', (_name, create) => {
    expect(create).toThrow(domException('InvalidCharacterError'));
  });

  it('make an entity reference holding a read-only copy of the entity (DOM Level 1 createEntityReference)', () => {
    const doc = withDtd();
    const reference = doc.createEntityReference('m');
    expect(children(reference)).toEqual(['1:b:bold']);
    expect(() => (reference.firstChild as Element).setAttribute('x', 'y')).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('make an empty, read-only entity reference to an entity that is not declared', () => {
    const reference = newDocument().createEntityReference('none');
    expect(reference.hasChildNodes()).toBe(false);
    expect(() => reference.appendChild(reference.ownerDocument?.createTextNode('t') as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
  });
});

describe('Document.getElementsByTagName and getElementById', () => {
  it('finds elements below the document by name, the document element included', () => {
    const document = build('<a><b/><a/></a>');
    expect(document.getElementsByTagName('a')).toHaveLength(2);
    expect(document.getElementsByTagName('*')).toHaveLength(3);
  });

  it('finds elements below the document by namespace and local name', () => {
    const document = build('<r xmlns="urn:x"><p:c xmlns:p="urn:y"/></r>');
    expect([...document.getElementsByTagNameNS('urn:y', '*')].map((e) => e.nodeName)).toEqual(['p:c']);
    expect([...document.getElementsByTagNameNS('*', 'r')].map((e) => e.nodeName)).toEqual(['r']);
    expect(document.getElementsByTagNameNS('', 'r')).toHaveLength(0);
  });

  it('finds the first element with an ID attribute of a value (DOM Level 2 getElementById)', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST e id ID #IMPLIED>]><r><e id="x"><e id="y"/></e><e id="z"/></r>');
    expect(document.getElementById('y')?.parentNode?.nodeName).toBe('e');
    expect(document.getElementById('z')?.getAttribute('id')).toBe('z');
    expect(document.getElementById('none')).toBeNull();
  });

  it('does not take an attribute named id as an ID', () => {
    expect(build('<r id="x"/>').getElementById('x')).toBeNull();
  });
});

describe('Document.importNode (DOM Level 3)', () => {
  it('raises NOT_SUPPORTED_ERR for documents and document types', () => {
    const document = newDocument();
    const other = withDtd();
    expect(() => document.importNode(other)).toThrow(domException('NotSupportedError'));
    expect(() => document.importNode(other.doctype as DocumentType)).toThrow(domException('NotSupportedError'));
  });

  it('copies an element and its specified attributes, without children unless deep', () => {
    const document = newDocument();
    const r = withDtd().documentElement as Element;
    const shallow = document.importNode(r);
    expect([shallow.ownerDocument === document, shallow.parentNode, shallow.hasChildNodes()]).toEqual([
      true,
      null,
      false,
    ]);
    expect([...shallow.attributes].map((a) => `${a.nodeName}=${a.nodeValue}`)).toEqual(['a=1']);
    expect(children(document.importNode(r, true))).toEqual(['5:t:', '5:m:']);
  });

  it('gives an imported element the defaults of the document it joins', () => {
    const target = build('<!DOCTYPE e [<!ATTLIST e x CDATA "fromTarget">]><e/>');
    const copy = target.importNode(build('<e/>').documentElement as Element);
    expect([copy.getAttribute('x'), copy.getAttributeNode('x')?.specified]).toEqual(['fromTarget', false]);
  });

  it('keeps a specified attribute that the document it joins defaults', () => {
    const target = build('<!DOCTYPE e [<!ATTLIST e x CDATA "fromTarget">]><e/>');
    const copy = target.importNode(build('<e x="mine"/>').documentElement as Element);
    expect([copy.getAttribute('x'), copy.getAttributeNode('x')?.specified, copy.attributes.length]).toEqual([
      'mine',
      true,
      1,
    ]);
  });

  it('copies an attribute as specified and unowned', () => {
    const document = newDocument();
    const attr = withDtd().documentElement?.getAttributeNode('d') as Attr;
    const copy = document.importNode(attr);
    expect([copy.value, copy.specified, copy.ownerElement, copy.ownerDocument === document]).toEqual([
      'dv',
      true,
      null,
      true,
    ]);
  });

  it('copies an attribute with its children', () => {
    const source = newDocument();
    const attr = source.createAttribute('a');
    attr.appendChild(source.createTextNode('x'));
    attr.appendChild(source.createTextNode('y'));
    const copy = newDocument().importNode(attr);
    expect(children(copy)).toEqual(['3:#text:x', '3:#text:y']);
  });

  it('rebuilds an entity reference from the entities of the document it joins', () => {
    const target = build('<!DOCTYPE r [<!ENTITY m "theirs">]><r/>');
    const reference = withDtd().documentElement?.lastChild as Node;
    const copy = target.importNode(reference, true);
    expect(children(copy)).toEqual(['3:#text:theirs']);
  });

  it('copies an entity, read-only, with its expansion when deep', () => {
    const entity = withDtd().doctype?.entities.getNamedItem('m') as Entity;
    const copy = newDocument().importNode(entity, true);
    expect([copy.nodeName, children(copy)]).toEqual(['m', ['1:b:bold']]);
    expect(() => copy.appendChild(copy.ownerDocument?.createTextNode('t') as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('copies a notation', () => {
    const notation = withDtd().doctype?.notations.getNamedItem('n') as Notation;
    const copy = newDocument().importNode(notation);
    expect([copy.nodeName, copy.publicId, copy.systemId]).toEqual(['n', '-//N//EN', 'n.sys']);
  });

  it('copies text, comments, CDATA, processing instructions and fragments', () => {
    const source = newDocument();
    const fragment = source.createDocumentFragment();
    fragment.appendChild(source.createTextNode('t'));
    fragment.appendChild(source.createComment('c'));
    fragment.appendChild(source.createCDATASection('d'));
    fragment.appendChild(source.createProcessingInstruction('p', 'q'));
    expect(children(newDocument().importNode(fragment, true))).toEqual([
      '3:#text:t',
      '8:#comment:c',
      '4:#cdata-section:d',
      '7:p:q',
    ]);
  });

  it('makes a writable copy of a read-only node', () => {
    const text = withDtd().documentElement?.firstChild?.firstChild as Text;
    const copy = newDocument().importNode(text);
    copy.appendData('!');
    expect(copy.data).toBe('text!');
  });

  it('tells user data handlers of the import (DOM Level 3 UserDataHandler)', () => {
    const source = newDocument().createElement('e');
    const handler = vi.fn();
    source.setUserData('k', 'v', handler);
    const copy = newDocument().importNode(source);
    expect(handler).toHaveBeenCalledWith(UserDataOperation.NODE_IMPORTED, 'k', 'v', source, copy);
  });
});

describe('Document.adoptNode (DOM Level 3)', () => {
  it('moves a node and its subtree into the document, out of its old parent', () => {
    const source = build('<r><e a="1"><c/></e></r>');
    const e = source.documentElement?.firstChild as Element;
    const document = newDocument();
    expect(document.adoptNode(e)).toBe(e);
    expect([
      e.parentNode,
      e.ownerDocument,
      e.firstChild?.ownerDocument,
      e.getAttributeNode('a')?.ownerDocument,
    ]).toEqual([null, document, document, document]);
    expect(source.documentElement?.hasChildNodes()).toBe(false);
  });

  it('drops defaulted attributes and gives the defaults of the document it joins', () => {
    const source = build('<!DOCTYPE e [<!ATTLIST e old CDATA "o">]><e/>');
    const target = build('<!DOCTYPE e [<!ATTLIST e new CDATA "n">]><e/>');
    const e = source.documentElement as Element;
    target.adoptNode(e);
    expect([...e.attributes].map((a) => `${a.nodeName}=${a.nodeValue}`)).toEqual(['new=n']);
  });

  it('takes an attribute from its element, making it specified', () => {
    const source = build('<!DOCTYPE r [<!ATTLIST r d CDATA "dv">]><r/>');
    const attr = source.documentElement?.getAttributeNode('d') as Attr;
    const document = newDocument();
    document.adoptNode(attr);
    expect([attr.ownerElement, attr.specified, attr.ownerDocument]).toEqual([null, true, document]);
  });

  it('adopts an attribute with no element', () => {
    const attr = newDocument().createAttribute('a');
    const document = newDocument();
    expect(document.adoptNode(attr)?.ownerDocument).toBe(document);
  });

  /** A fragment holding a reference to the entity m, made by a document. */
  function referenceIn(source: Document): DocumentFragment {
    const fragment = source.createDocumentFragment();
    fragment.appendChild(source.createEntityReference('m'));
    return fragment;
  }

  it('gives an entity reference the expansion of the document it joins', () => {
    const fragment = referenceIn(newDocument());
    const target = build('<!DOCTYPE r [<!ENTITY m "<i>theirs</i>">]><r>&m;</r>');
    target.adoptNode(fragment);
    expect(children(fragment.firstChild as Node)).toEqual(['1:i:theirs']);
  });

  it('empties an entity reference the document it joins does not declare', () => {
    const fragment = referenceIn(withDtd());
    expect(fragment.firstChild?.hasChildNodes()).toBe(true);
    newDocument().adoptNode(fragment);
    expect(fragment.firstChild?.hasChildNodes()).toBe(false);
  });

  it('raises NOT_SUPPORTED_ERR for documents and document types', () => {
    const document = newDocument();
    const other = build('<!DOCTYPE r><r/>');
    expect(() => document.adoptNode(other)).toThrow(domException('NotSupportedError'));
    expect(() => document.adoptNode(other.doctype as DocumentType)).toThrow(domException('NotSupportedError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR for a read-only node', () => {
    const document = withDtd();
    expect(() => newDocument().adoptNode(document.doctype?.entities.item(0) as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
    expect(() => newDocument().adoptNode(document.documentElement?.firstChild?.firstChild as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('raises NOT_SUPPORTED_ERR for entities and notations that are not read-only', () => {
    const document = newDocument();
    expect(() => document.adoptNode(new Entity(document, 'e', null, null, null))).toThrow(
      domException('NotSupportedError')
    );
    expect(() => document.adoptNode(new Notation(document, 'n', null, null))).toThrow(
      domException('NotSupportedError')
    );
  });

  it('tells user data handlers of the adoption', () => {
    const e = newDocument().createElement('e');
    const handler = { handle: vi.fn() };
    e.setUserData('k', 1, handler);
    newDocument().adoptNode(e);
    expect(handler.handle).toHaveBeenCalledWith(UserDataOperation.NODE_ADOPTED, 'k', 1, e, null);
  });
});

describe('Document.renameNode (DOM Level 3)', () => {
  it('renames an element, giving it a namespace', () => {
    const document = build('<r/>');
    const r = document.documentElement as Element;
    expect(document.renameNode(r, 'urn:p', 'p:root')).toBe(r);
    expect([r.nodeName, r.namespaceURI, r.prefix, r.localName]).toEqual(['p:root', 'urn:p', 'p', 'root']);
  });

  it('gives a renamed element the defaults of its new name', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST s d CDATA "dv">]><r/>');
    const r = document.documentElement as Element;
    document.renameNode(r, null, 's');
    expect(r.getAttribute('d')).toBe('dv');
  });

  it('renames an attribute on its element', () => {
    const document = build('<r a="1"/>');
    const r = document.documentElement as Element;
    const attr = r.getAttributeNode('a') as Attr;
    document.renameNode(attr, 'urn:p', 'p:b');
    expect([attr.ownerElement, r.getAttributeNS('urn:p', 'b'), r.hasAttribute('a')]).toEqual([r, '1', false]);
  });

  it('renames an attribute to a namespace declaration in the XMLNS namespace', () => {
    const document = newDocument();
    const r = document.createElementNS(null, 'r');
    r.setAttributeNS(null, 'a', 'urn:d');
    const attr = r.getAttributeNode('a') as Attr;
    expect(document.renameNode(attr, XMLNS, 'xmlns')).toBe(attr);
    expect([attr.name, attr.namespaceURI, attr.prefix, attr.localName]).toEqual(['xmlns', XMLNS, null, 'xmlns']);
    expect(r.getAttributeNodeNS(XMLNS, 'xmlns')).toBe(attr);
    expect([r.hasAttribute('a'), r.lookupNamespaceURI(null)]).toEqual([false, 'urn:d']);
  });

  it('renames an attribute with no element', () => {
    const document = newDocument();
    const attr = document.createAttribute('a');
    document.renameNode(attr, null, 'b');
    expect([attr.name, attr.localName]).toEqual(['b', 'b']);
  });

  it('keeps live lists current', () => {
    const document = build('<r><a/></r>');
    const list = document.getElementsByTagName('b');
    document.renameNode(document.documentElement?.firstChild as Node, null, 'b');
    expect(list).toHaveLength(1);
  });

  it('raises NOT_SUPPORTED_ERR for nodes other than elements and attributes', () => {
    const document = newDocument();
    expect(() => document.renameNode(document.createTextNode('t'), null, 'x')).toThrow(
      domException('NotSupportedError')
    );
  });

  it('raises WRONG_DOCUMENT_ERR for a node of another document', () => {
    expect(() => newDocument().renameNode(newDocument().createElement('e'), null, 'x')).toThrow(
      domException('WrongDocumentError')
    );
  });

  it.each([
    ['a prefix with no namespace', null, 'p:e', 'NamespaceError'],
    ['xmlns outside its namespace', 'urn:p', 'xmlns', 'NamespaceError'],
    ['a local part that is not an NCName', 'urn:p', 'p:1e', 'NamespaceError'],
    ['a name that is not an XML name', null, '1e', 'InvalidCharacterError'],
  ] as const)('raises an exception for %s', (_case, uri, name, exception) => {
    const document = newDocument();
    expect(() => document.renameNode(document.createAttribute('a'), uri, name)).toThrow(domException(exception));
  });

  it('tells user data handlers of the rename', () => {
    const document = newDocument();
    const e = document.createElement('e');
    const handler = vi.fn();
    e.setUserData('k', 'v', handler);
    document.renameNode(e, null, 'f');
    expect(handler).toHaveBeenCalledWith(UserDataOperation.NODE_RENAMED, 'k', 'v', e, e);
  });
});

describe('Document.createElementNS (DOM Level 2)', () => {
  const document = newDocument();

  it('makes an element with a namespace, prefix and local name', () => {
    const e = document.createElementNS('urn:p', 'p:e');
    expect([e.nodeName, e.namespaceURI, e.prefix, e.localName]).toEqual(['p:e', 'urn:p', 'p', 'e']);
  });

  it('reads the empty namespace as none', () => {
    const e = document.createElementNS('', 'e');
    expect([e.namespaceURI, e.prefix, e.localName]).toEqual([null, null, 'e']);
  });

  it('accepts the xml prefix in the XML namespace and xmlns in the XMLNS namespace', () => {
    expect(document.createElementNS(XML, 'xml:e').prefix).toBe('xml');
    expect(document.createElementNS(XMLNS, 'xmlns:e').namespaceURI).toBe(XMLNS);
  });

  it.each([
    ['a prefix with no namespace', null, 'p:e'],
    ['a prefix with the empty namespace', '', 'p:e'],
    ['xml with another namespace', 'urn:p', 'xml:e'],
    ['the xmlns prefix with another namespace', 'urn:p', 'xmlns:e'],
    ['the name xmlns with another namespace', 'urn:p', 'xmlns'],
    ['the XMLNS namespace with another prefix', XMLNS, 'p:e'],
    ['the XMLNS namespace with no prefix', XMLNS, 'e'],
    ['a leading colon', 'urn:p', ':e'],
    ['a trailing colon', 'urn:p', 'p:'],
    ['two colons', 'urn:p', 'p:q:e'],
    ['a local part that is not an NCName', 'urn:p', 'p:1e'],
  ])('raises NAMESPACE_ERR for %s', (_case, uri, name) => {
    expect(() => document.createElementNS(uri, name)).toThrow(domException('NamespaceError'));
  });

  it.each(['1e', 'e f', '', '-e', '1p:e'])('raises INVALID_CHARACTER_ERR for %j', (name) => {
    expect(() => document.createElementNS('urn:p', name)).toThrow(domException('InvalidCharacterError'));
  });
});

describe('Document.createAttributeNS (DOM Level 2)', () => {
  const document = newDocument();

  it('makes an attribute with a namespace, prefix and local name, not owned', () => {
    const a = document.createAttributeNS('urn:p', 'p:a');
    expect([a.name, a.namespaceURI, a.prefix, a.localName, a.ownerElement, a.value]).toEqual([
      'p:a',
      'urn:p',
      'p',
      'a',
      null,
      '',
    ]);
  });

  it('makes namespace declarations in the XMLNS namespace', () => {
    expect(document.createAttributeNS(XMLNS, 'xmlns').localName).toBe('xmlns');
    expect(document.createAttributeNS(XMLNS, 'xmlns:p').localName).toBe('p');
  });

  it.each([
    ['a prefix with no namespace', null, 'p:a'],
    ['xml with another namespace', 'urn:p', 'xml:a'],
    ['xmlns with another namespace', 'urn:p', 'xmlns'],
    ['the XMLNS namespace with another name', XMLNS, 'a'],
    ['two colons', 'urn:p', 'a:b:c'],
    ['a local part that is not an NCName', 'urn:p', 'p:1a'],
  ])('raises NAMESPACE_ERR for %s', (_case, uri, name) => {
    expect(() => document.createAttributeNS(uri, name)).toThrow(domException('NamespaceError'));
  });

  it('raises INVALID_CHARACTER_ERR for a name that is not an XML name', () => {
    expect(() => document.createAttributeNS('urn:p', 'a b')).toThrow(domException('InvalidCharacterError'));
  });
});
