import { build } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { DOMImplementation, type Document, type DocumentType } from '@/index.ts';

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

describe('DocumentType (DOM Level 2)', () => {
  it('gives its name, identifiers and internal subset', () => {
    const doctype = withDtd().doctype as DocumentType;
    expect([doctype.nodeType, doctype.nodeName, doctype.name, doctype.publicId, doctype.systemId]).toEqual([
      10,
      'r',
      'r',
      '-//P//EN',
      'r.dtd',
    ]);
    expect(doctype.internalSubset).toContain('<!ENTITY t "text">');
  });

  it('holds the entities and notations the DTD declares', () => {
    const doctype = withDtd().doctype as DocumentType;
    expect([...doctype.entities].map((e) => e.nodeName)).toEqual(['t', 'm', 'u']);
    expect([...doctype.notations].map((n) => n.nodeName)).toEqual(['n']);
  });

  it('has no text content and no children', () => {
    const doctype = withDtd().doctype as DocumentType;
    expect([doctype.textContent, doctype.nodeValue, doctype.hasChildNodes()]).toEqual([null, null, false]);
  });

  it('ignores setting its text content, which is null (DOM Level 3 Node.textContent)', () => {
    for (const doctype of [
      withDtd().doctype as DocumentType,
      new DOMImplementation().createDocumentType('r', null, null),
    ]) {
      doctype.textContent = 'x';
      expect([doctype.textContent, doctype.hasChildNodes()]).toEqual([null, false]);
    }
  });

  it('has null identifiers and subset when there are none', () => {
    const doctype = build('<!DOCTYPE r><r/>').doctype as DocumentType;
    expect([doctype.publicId, doctype.systemId, doctype.internalSubset]).toEqual([null, null, null]);
  });
});
