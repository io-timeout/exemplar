import { build, children, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it, vi } from 'vitest';
import {
  type Attr,
  type Document,
  DocumentPosition,
  type DocumentType,
  type Element,
  type Entity,
  Node,
  NodeType,
  type Notation,
  UserDataOperation,
} from '@/index.ts';

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

describe('the constants', () => {
  it('number the node types as DOM Level 3 Core does (§1.4 Node)', () => {
    expect(NodeType).toEqual({
      ELEMENT_NODE: 1,
      ATTRIBUTE_NODE: 2,
      TEXT_NODE: 3,
      CDATA_SECTION_NODE: 4,
      ENTITY_REFERENCE_NODE: 5,
      ENTITY_NODE: 6,
      PROCESSING_INSTRUCTION_NODE: 7,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9,
      DOCUMENT_TYPE_NODE: 10,
      DOCUMENT_FRAGMENT_NODE: 11,
      NOTATION_NODE: 12,
    });
  });

  it('give Node the node types and document positions as static constants', () => {
    for (const [name, value] of Object.entries({ ...NodeType, ...DocumentPosition })) {
      expect(Node[name as keyof typeof Node], name).toBe(value);
    }
  });

  it('number the document positions as bits (DOM Level 3 DocumentPosition)', () => {
    expect(Object.values(DocumentPosition)).toEqual([0x01, 0x02, 0x04, 0x08, 0x10, 0x20]);
  });

  it('number the user data operations (DOM Level 3 UserDataHandler)', () => {
    expect(UserDataOperation).toEqual({
      NODE_CLONED: 1,
      NODE_IMPORTED: 2,
      NODE_DELETED: 3,
      NODE_RENAMED: 4,
      NODE_ADOPTED: 5,
    });
  });
});

describe('Node defaults', () => {
  const document = newDocument();

  it('gives null for nodeValue where DOM Level 1 says so, and ignores setting it', () => {
    const element = document.createElement('e');
    expect(element.nodeValue).toBeNull();
    element.nodeValue = 'ignored';
    expect([element.nodeValue, element.hasChildNodes()]).toEqual([null, false]);
    expect(document.nodeValue).toBeNull();
  });

  it('gives no attributes, namespace, prefix or local name to nodes other than elements and attributes', () => {
    const text = document.createTextNode('t');
    expect([text.attributes, text.namespaceURI, text.prefix, text.localName]).toEqual([null, null, null, null]);
    expect(text.hasAttributes()).toBe(false);
  });

  it('ignores setting the prefix of a node that has none to set (DOM Level 2 Node.prefix)', () => {
    const comment = document.createComment('c');
    comment.prefix = 'p';
    expect(comment.prefix).toBeNull();
  });

  it('gives a base URI of null to text', () => {
    expect(document.createTextNode('t').baseURI).toBeNull();
  });

  it('gives the parent, siblings and children', () => {
    const doc = build('<r><a/><b/></r>');
    const r = doc.documentElement as Element;
    const [a, b] = [r.firstChild as Node, r.lastChild as Node];
    expect([a.parentNode, a.parentElement, a.nextSibling, b.previousSibling]).toEqual([r, r, b, a]);
    expect([a.previousSibling, b.nextSibling, r.parentElement, r.parentNode]).toEqual([null, null, null, doc]);
    expect(r.hasChildNodes()).toBe(true);
  });

  it('caches the child list, which stays live', () => {
    const r = newDocument().createElement('r');
    const list = r.childNodes;
    expect(r.childNodes).toBe(list);
    r.appendChild((r.ownerDocument as NonNullable<Node['ownerDocument']>).createTextNode('t'));
    expect(list).toHaveLength(1);
  });

  it.each([
    ['Core', null, true],
    ['core', '', true],
    ['Core', '3.0', true],
    ['+Core', '2.0', true],
    ['XML', '1.0', true],
    ['XML', '3.0', true],
    ['Core', '1.0', false],
    ['XML', '4.0', false],
    ['HTML', null, false],
    ['LS', '3.0', false],
  ])('says whether the feature %s %s is supported (DOM Level 3 Node.isSupported)', (feature, version, supported) => {
    const node = document.createElement('e');
    expect(node.isSupported(feature, version)).toBe(supported);
    expect(node.getFeature(feature, version)).toBe(supported ? node : null);
  });

  it('gives an attribute no parent (DOM Level 1 Attr)', () => {
    const r = build('<r a="1"/>').documentElement as Element;
    const attr = r.getAttributeNode('a') as Attr;
    expect([attr.parentNode, attr.previousSibling, attr.nextSibling]).toEqual([null, null, null]);
  });
});

describe('Node.cloneNode (DOM Level 3)', () => {
  it('copies an element and its attributes, without children unless deep', () => {
    const document = build('<r a="1"><c>t</c></r>');
    const r = document.documentElement as Element;
    const shallow = r.cloneNode() as Element;
    expect([shallow.parentNode, shallow.ownerDocument, shallow.getAttribute('a'), shallow.hasChildNodes()]).toEqual([
      null,
      document,
      '1',
      false,
    ]);
    const deep = r.cloneNode(true) as Element;
    expect([deep.textContent, deep.firstChild === r.firstChild]).toEqual(['t', false]);
  });

  it('keeps whether attributes were specified and are IDs when cloning an element', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r d CDATA "dv" i ID #IMPLIED>]><r i="x"/>');
    const clone = document.documentElement?.cloneNode() as Element;
    expect([clone.getAttributeNode('d')?.specified, clone.getAttributeNode('i')?.isId]).toEqual([false, true]);
    expect(clone.getAttributeNode('i')?.ownerElement).toBe(clone);
  });

  it('gives a cloned attribute specified, with its value', () => {
    const attr = newDocument().createAttribute('a');
    attr.value = 'v';
    const clone = attr.cloneNode() as Attr;
    expect([clone.value, clone.specified, clone.ownerElement]).toEqual(['v', true, null]);
  });

  it('gives a cloned attribute specified when the DTD defaulted it (DOM Level 3 Node.cloneNode)', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r d CDATA "dv">]><r/>');
    const attr = document.documentElement?.getAttributeNode('d') as Attr;
    const clone = attr.cloneNode() as Attr;
    expect([attr.specified, clone.specified, clone.value, clone.ownerElement]).toEqual([false, true, 'dv', null]);
  });

  it('copies the children of an attribute', () => {
    const document = newDocument();
    const attr = document.createAttribute('a');
    attr.appendChild(document.createTextNode('x'));
    expect(children(attr.cloneNode(true))).toEqual(['3:#text:x']);
  });

  it('makes a writable copy of a read-only subtree', () => {
    const document = withDtd();
    const b = document.documentElement?.lastChild?.firstChild as Element;
    const clone = b.cloneNode(true) as Element;
    clone.setAttribute('x', 'y');
    expect(clone.getAttribute('x')).toBe('y');
  });

  it('gives a cloned entity reference read-only children', () => {
    const reference = withDtd().documentElement?.lastChild as Node;
    const clone = reference.cloneNode(false);
    expect(children(clone)).toEqual(['1:b:bold']);
    expect(() => clone.removeChild(clone.firstChild as Node)).toThrow(domException('NoModificationAllowedError'));
  });

  it('copies a document type with its entities and notations, read-only', () => {
    const doctype = withDtd().doctype as DocumentType;
    const clone = doctype.cloneNode() as DocumentType;
    expect([clone.name, clone.publicId, clone.systemId, clone.internalSubset]).toEqual([
      doctype.name,
      doctype.publicId,
      doctype.systemId,
      doctype.internalSubset,
    ]);
    expect([clone.entities.length, clone.notations.length]).toEqual([3, 1]);
    expect(children(clone.entities.getNamedItem('m') as Node)).toEqual(['1:b:bold']);
    expect(() => clone.entities.getNamedItem('t')?.appendChild(newDocument())).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('copies a document, shallow or deep, with its properties', () => {
    const document = build({
      systemId: 'http://example.com/d.xml',
      text: '<?xml version="1.1" standalone="yes"?><r/>',
    });
    const shallow = document.cloneNode() as Document;
    expect([shallow.hasChildNodes(), shallow.documentURI, shallow.xmlVersion, shallow.xmlStandalone]).toEqual([
      false,
      'http://example.com/d.xml',
      '1.1',
      true,
    ]);
    const deep = document.cloneNode(true) as Document;
    expect([deep.documentElement?.nodeName, deep.documentElement?.ownerDocument === deep]).toEqual(['r', true]);
  });

  it('keeps the DTD defaults in a copied document', () => {
    const document = build('<!DOCTYPE r [<!ATTLIST r d CDATA "dv">]><r/>');
    const copy = document.cloneNode(true) as Document;
    expect(copy.createElement('r').getAttribute('d')).toBe('dv');
  });

  it('copies fragments, text, comments and processing instructions', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('t'));
    fragment.appendChild(document.createComment('c'));
    fragment.appendChild(document.createProcessingInstruction('p', 'd'));
    expect(children(fragment.cloneNode(true))).toEqual(['3:#text:t', '8:#comment:c', '7:p:d']);
    expect(fragment.cloneNode().hasChildNodes()).toBe(false);
  });

  it('copies entities and notations', () => {
    const doctype = withDtd().doctype as DocumentType;
    const entity = doctype.entities.getNamedItem('u')?.cloneNode() as Entity;
    const notation = doctype.notations.getNamedItem('n')?.cloneNode() as Notation;
    expect([entity.nodeName, entity.systemId, entity.notationName]).toEqual(['u', 'u.bin', 'n']);
    expect([notation.nodeName, notation.publicId]).toEqual(['n', '-//N//EN']);
  });

  it('tells user data handlers of the clone', () => {
    const e = newDocument().createElement('e');
    const handler = vi.fn();
    e.setUserData('k', 'v', handler);
    const clone = e.cloneNode();
    expect(handler).toHaveBeenCalledWith(UserDataOperation.NODE_CLONED, 'k', 'v', e, clone);
  });
});
