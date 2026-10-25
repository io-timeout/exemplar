import { build, children, domException, newDocument, serialize } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import {
  type Attr,
  type Comment,
  type Document,
  type Element,
  EntityReference,
  type Node,
  type ProcessingInstruction,
  Text,
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

describe('EntityReference (DOM Level 1)', () => {
  it('is named after its entity', () => {
    const reference = withDtd().documentElement?.firstChild as Node;
    expect([reference.nodeType, reference.nodeName, reference.nodeValue, reference.textContent]).toEqual([
      5,
      't',
      null,
      'text',
    ]);
  });

  it('takes the base URI of its entity, or null with none', () => {
    const document = build(
      { systemId: 'http://example.com/d.xml', text: '<!DOCTYPE r [<!ENTITY t "x">]><r>&t;</r>' },
      {
        replaceEntityReferences: false,
      }
    );
    expect(document.documentElement?.firstChild?.baseURI).toBe('http://example.com/d.xml');
    expect(newDocument().createEntityReference('none').baseURI).toBeNull();
    expect(new EntityReference(null, 'x').baseURI).toBeNull();
  });
});

describe('the read-only content of entity references (DOM Level 1 EntityReference)', () => {
  /** A kept reference to an entity holding an element with an attribute, text, a PI and a comment. */
  function reference(): { document: Document; ref: Node; b: Element; attr: Attr } {
    const document = build(`<!DOCTYPE r [<!ENTITY e "<b a='1'>x<?p d?><!--c--></b>">]><r>&e;</r>`, {
      replaceEntityReferences: false,
    });
    const ref = document.documentElement?.firstChild as Node;
    const b = ref.firstChild as Element;
    return { document, ref, b, attr: b.getAttributeNode('a') as Attr };
  }

  it.each([
    ['setAttribute', ({ b }) => b.setAttribute('x', 'y')],
    ['setAttributeNS', ({ b }) => b.setAttributeNS('urn:x', 'x:y', 'z')],
    ['setAttributeNode', ({ b, document }) => b.setAttributeNode(document.createAttribute('x'))],
    ['attributes.setNamedItem', ({ b, document }) => b.attributes.setNamedItem(document.createAttribute('x'))],
    ['removeAttribute', ({ b }) => b.removeAttribute('a')],
    ['removeAttributeNode', ({ b, attr }) => b.removeAttributeNode(attr)],
    ['setIdAttribute', ({ b }) => b.setIdAttribute('a', true)],
    ['an attribute value', ({ attr }) => (attr.value = 'z')],
    ['the text of an attribute', ({ attr }) => ((attr.firstChild as Text).data = 'z')],
    ['an attribute child', ({ attr, document }) => attr.appendChild(document.createTextNode('z'))],
    ['the text of an element', ({ b }) => ((b.firstChild as Text).data = 'z')],
    ['a processing instruction', ({ b }) => ((b.childNodes.item(1) as ProcessingInstruction).data = 'z')],
    ['a comment', ({ b }) => (b.lastChild as Comment).appendData('z')],
    ['an element textContent', ({ b }) => (b.textContent = 'z')],
    ['the reference textContent', ({ ref }) => (ref.textContent = 'z')],
    ['appendChild', ({ b, document }) => b.appendChild(document.createElement('z'))],
    ['removeChild', ({ b }) => b.removeChild(b.firstChild as Node)],
    ['the prefix of an element', ({ b }) => (b.prefix = 'p')],
    ['renameNode of an element', ({ b, document }) => document.renameNode(b, null, 'z')],
    ['renameNode of an attribute', ({ attr, document }) => document.renameNode(attr, null, 'z')],
  ] as [string, (nodes: ReturnType<typeof reference>) => unknown][])(
    'raises NO_MODIFICATION_ALLOWED_ERR on changing %s',
    (_case, change) => {
      const nodes = reference();
      expect(() => change(nodes)).toThrow(domException('NoModificationAllowedError'));
      expect(serialize(nodes.b)).toBe('<b a="1">x<?p d?><!--c--></b>');
    }
  );

  it('lets normalize pass over content that needs no change, NFC included', () => {
    const { document, ref } = reference();
    document.domConfig.setParameter('normalize-characters', true);
    document.normalize();
    expect(children(ref)).toEqual(['1:b:x']);
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when normalize would join text in it', () => {
    const { document, b } = reference();
    const text = new Text(document, 'y');
    text._setReadonly(true);
    b._insert(text, b.childNodes.item(1));
    expect(() => b.normalize()).toThrow(domException('NoModificationAllowedError'));
    expect((b.firstChild as Text).data).toBe('x');
  });
});
