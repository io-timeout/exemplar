import { build } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import type { Document, Notation } from '@/index.ts';

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

describe('Notation (DOM Level 1)', () => {
  it('gives its name and identifiers, and no text content', () => {
    const notation = withDtd().doctype?.notations.item(0) as Notation;
    expect([notation.nodeType, notation.nodeName, notation.publicId, notation.systemId, notation.textContent]).toEqual([
      12,
      'n',
      '-//N//EN',
      'n.sys',
      null,
    ]);
  });

  it('ignores setting its text content, which is null (DOM Level 3 Node.textContent)', () => {
    const notation = withDtd().doctype?.notations.item(0) as Notation;
    notation.textContent = 'x';
    expect([notation.textContent, notation.hasChildNodes()]).toEqual([null, false]);
  });

  it('takes the base URI of the entity holding its declaration', () => {
    const document = build({
      systemId: 'http://example.com/d.xml',
      text: '<!DOCTYPE r [<!NOTATION n SYSTEM "x">]><r/>',
    });
    expect(document.doctype?.notations.item(0)?.baseURI).toBe('http://example.com/d.xml');
  });
});
