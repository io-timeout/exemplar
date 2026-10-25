import { build, domException } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { DOMImplementation, DOMImplementationRegistry, DocumentType, type Element } from '@/index.ts';

const DTD = `<!DOCTYPE r PUBLIC "-//P//EN" "r.dtd" [
<!ENTITY t "text">
<!ENTITY m "<b>bold</b>">
<!ENTITY u SYSTEM "u.bin" NDATA n>
<!NOTATION n PUBLIC "-//N//EN" "n.sys">
<!ATTLIST r d CDATA "dv">
]>`;

describe('DOMImplementation (DOM Level 3)', () => {
  const implementation = new DOMImplementation();

  it.each([
    ['Core', '3.0', true],
    ['XML', '2.0', true],
    ['xml', '1.0', true],
    ['+XML', null, true],
    ['Core', '', true],
    ['Core', '1.0', false],
    ['Events', '2.0', false],
  ])('says whether it has the feature %s %j', (feature, version, has) => {
    expect(implementation.hasFeature(feature, version)).toBe(has);
    expect(implementation.getFeature(feature, version)).toBe(has ? implementation : null);
  });

  it('makes a document type with no document', () => {
    const doctype = implementation.createDocumentType('p:r', 'pub', 'sys');
    expect([doctype.name, doctype.publicId, doctype.systemId, doctype.internalSubset, doctype.ownerDocument]).toEqual([
      'p:r',
      'pub',
      'sys',
      null,
      null,
    ]);
  });

  it.each([
    ['1r', 'InvalidCharacterError'],
    ['p:', 'NamespaceError'],
    [':r', 'NamespaceError'],
    ['p:1r', 'NamespaceError'],
  ] as const)('raises an exception for the document type name %j', (name, exception) => {
    expect(() => implementation.createDocumentType(name, null, null)).toThrow(domException(exception));
  });

  it('makes a document with a document type, which it then owns', () => {
    const doctype = implementation.createDocumentType('r', null, null);
    const document = implementation.createDocument(null, 'r', doctype);
    expect([document.doctype, doctype.ownerDocument, document.firstChild, document.lastChild?.nodeName]).toEqual([
      doctype,
      document,
      doctype,
      'r',
    ]);
    expect(document.implementation).toBe(implementation);
  });

  it('gives the document the entities and notations of its document type', () => {
    const doctype = build(`${DTD}<r/>`).doctype?.cloneNode() as DocumentType;
    const fresh = new DocumentType(null, 'r', null, null, null);
    fresh._entities.push(...doctype._entities);
    for (const n of fresh._entities) n._owner = null;
    const document = implementation.createDocument(null, 'r', fresh);
    expect(fresh.entities.item(0)?.ownerDocument).toBe(document);
  });

  it('raises WRONG_DOCUMENT_ERR for a document type another document owns', () => {
    const doctype = build('<!DOCTYPE r><r/>').doctype as DocumentType;
    expect(() => implementation.createDocument(null, 'r', doctype)).toThrow(domException('WrongDocumentError'));
  });
});

describe('DOMImplementationRegistry (DOM Level 3 bootstrapping)', () => {
  it.each(['Core 3.0 XML', 'XML 3.0 Core', '+Core 2.0', 'Core', '', '  core   xml 1.0 '])(
    'gives an implementation for the features %j',
    (features) => {
      expect(DOMImplementationRegistry.getDOMImplementation(features)).toBeInstanceOf(DOMImplementation);
    }
  );

  it.each(['HTML', 'Core 1.0', 'Core 3.0 Events'])('gives none for the features %j', (features) => {
    expect(DOMImplementationRegistry.getDOMImplementation(features)).toBeNull();
  });

  it('lists the implementations that have the features', () => {
    const list = DOMImplementationRegistry.getDOMImplementationList('Core XML');
    expect([list.length, list.item(0) instanceof DOMImplementation, list.item(1)]).toEqual([1, true, null]);
    expect(DOMImplementationRegistry.getDOMImplementationList('LS')).toHaveLength(0);
  });
});

describe('DOMImplementation.createDocument namespace checks (DOM Level 2)', () => {
  const implementation = new DOMImplementation();

  it('makes a document whose element has the namespace and name given', () => {
    const document = implementation.createDocument('urn:p', 'p:root', null);
    const root = document.documentElement as Element;
    expect([root.nodeName, root.namespaceURI, root.localName]).toEqual(['p:root', 'urn:p', 'root']);
  });

  it('makes an empty document when the name is null', () => {
    expect(implementation.createDocument(null, null, null).hasChildNodes()).toBe(false);
    expect(implementation.createDocument('', null, null).hasChildNodes()).toBe(false);
  });

  it('raises NAMESPACE_ERR for a namespace with no name', () => {
    expect(() => implementation.createDocument('urn:p', null, null)).toThrow(domException('NamespaceError'));
  });

  it('raises NAMESPACE_ERR for a prefix with no namespace', () => {
    expect(() => implementation.createDocument(null, 'p:root', null)).toThrow(domException('NamespaceError'));
  });

  it('raises NAMESPACE_ERR for a local part that is not an NCName', () => {
    expect(() => implementation.createDocument('urn:p', 'p:1root', null)).toThrow(domException('NamespaceError'));
  });

  it('raises INVALID_CHARACTER_ERR for a name that is not an XML name', () => {
    expect(() => implementation.createDocument(null, '1root', null)).toThrow(domException('InvalidCharacterError'));
  });
});
