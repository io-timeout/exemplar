import { build, children, domException } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { type Document, type DocumentType, type Element, Entity, type Node, type Text } from '@/index.ts';

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

describe('Entity (DOM Level 3)', () => {
  const doctype = withDtd().doctype as DocumentType;

  it('gives its name, identifiers and notation', () => {
    const u = doctype.entities.getNamedItem('u') as Entity;
    expect([u.nodeType, u.nodeName, u.publicId, u.systemId, u.notationName]).toEqual([6, 'u', null, 'u.bin', 'n']);
    const t = doctype.entities.getNamedItem('t') as Entity;
    expect([t.systemId, t.notationName]).toEqual([null, null]);
  });

  it('holds its replacement text, and is read-only', () => {
    const t = doctype.entities.getNamedItem('t') as Entity;
    expect([t.textContent, t.firstChild?.nodeType]).toEqual(['text', 3]);
    expect(() => t.appendChild(doctype.ownerDocument?.createTextNode('x') as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('holds markup copied from its first expansion, read-only', () => {
    const m = doctype.entities.getNamedItem('m') as Entity;
    expect(children(m)).toEqual(['1:b:bold']);
    expect(() => (m.firstChild as Element).setAttribute('x', 'y')).toThrow(domException('NoModificationAllowedError'));
  });

  it('makes the text of a plain entity read-only', () => {
    const text = (doctype.entities.getNamedItem('t') as Entity).firstChild as Text;
    for (const change of [
      () => (text.data = 'x'),
      () => (text.nodeValue = 'x'),
      () => (text.textContent = 'x'),
      () => text.appendData('x'),
      () => text.insertData(0, 'x'),
      () => text.deleteData(0, 1),
      () => text.replaceData(0, 1, 'x'),
      () => text.splitText(1),
    ]) {
      expect(change).toThrow(domException('NoModificationAllowedError'));
    }
    expect(text.data).toBe('text');
  });

  it('makes a cloned entity read-only, as Xerces does', () => {
    const m = (doctype.entities.getNamedItem('m') as Entity).cloneNode(true);
    expect(() => m.appendChild(doctype.ownerDocument?.createTextNode('x') as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
    expect(() => ((m.firstChild as Node).firstChild as Text).appendData('x')).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('has no encodings or version when internal', () => {
    const t = doctype.entities.getNamedItem('t') as Entity;
    expect([t.inputEncoding, t.xmlEncoding, t.xmlVersion]).toEqual([null, null, null]);
  });

  it('takes the document base URI when it has none of its own', () => {
    const document = build({ systemId: 'http://example.com/d.xml', text: '<!DOCTYPE r [<!ENTITY t "x">]><r/>' });
    expect(document.doctype?.entities.item(0)?.baseURI).toBe('http://example.com/d.xml');
    expect(new Entity(null, 'e', null, null, null).baseURI).toBeNull();
  });
});
