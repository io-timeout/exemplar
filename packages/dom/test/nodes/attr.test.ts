import { build, children, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import type { Attr, Element, Node } from '@/index.ts';

/** A DTD giving `r` a default `d`, a defaulted enumeration `e` and an ID `i`. */
const DTD = '<!DOCTYPE r [<!ATTLIST r d CDATA "dv" e (x|y) "x" i ID #IMPLIED>]>';

/** An element with no attributes in a fresh document. */
function element(name = 'e'): Element {
  return newDocument().createElement(name);
}

/** An element inside an entity reference, which is read-only, with an attribute a. */
function readOnlyElement(): Element {
  const document = build(`<!DOCTYPE r [<!ENTITY e "<b a='1'/>">]><r>&e;</r>`, { replaceEntityReferences: false });
  return document.documentElement?.firstChild?.firstChild as Element;
}

describe('Attr (DOM Level 3)', () => {
  it('is an attribute node with its name and value', () => {
    const attr = build('<r a="v"/>').documentElement?.getAttributeNode('a') as Attr;
    expect([attr.nodeType, attr.nodeName, attr.name, attr.value, attr.nodeValue, attr.textContent]).toEqual([
      2,
      'a',
      'a',
      'v',
      'v',
      'v',
    ]);
  });

  it('sets its value through value, nodeValue and textContent, null as empty', () => {
    const attr = newDocument().createAttribute('a');
    attr.value = '1';
    expect(attr.value).toBe('1');
    attr.nodeValue = '2';
    expect(attr.value).toBe('2');
    attr.textContent = '3';
    expect(attr.value).toBe('3');
    attr.nodeValue = null;
    expect(attr.value).toBe('');
    attr.textContent = null;
    expect(attr.value).toBe('');
  });

  it('converts its value to a string', () => {
    const attr = newDocument().createAttribute('a');
    attr.value = 3 as unknown as string;
    expect(attr.value).toBe('3');
  });

  it('becomes specified when its value is set', () => {
    const r = build(`${DTD}<r/>`).documentElement as Element;
    const attr = r.getAttributeNode('d') as Attr;
    attr.value = 'set';
    expect(attr.specified).toBe(true);
  });

  it('has a text child holding its value, made when asked for (DOM Level 1 Attr)', () => {
    const attr = build('<r a="v"/>').documentElement?.getAttributeNode('a') as Attr;
    expect(children(attr)).toEqual(['3:#text:v']);
    expect([attr.firstChild, attr.lastChild]).toEqual([attr.childNodes.item(0), attr.childNodes.item(0)]);
    expect(attr.hasChildNodes()).toBe(true);
  });

  it('has no child when its value is empty', () => {
    const attr = newDocument().createAttribute('a');
    expect([attr.firstChild, attr.lastChild, attr.hasChildNodes()]).toEqual([null, null, false]);
  });

  it('takes its value from its children once they change', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "E">]><r a="v"/>');
    const attr = document.documentElement?.getAttributeNode('a') as Attr;
    attr.appendChild(document.createTextNode('w'));
    attr.appendChild(document.createEntityReference('e'));
    expect(attr.value).toBe('vwE');
    attr.removeChild(attr.firstChild as Node);
    expect(attr.value).toBe('wE');
  });

  it('replaces its children when its value is set', () => {
    const document = newDocument();
    const attr = document.createAttribute('a');
    attr.appendChild(document.createTextNode('x'));
    attr.value = 'y';
    expect(children(attr)).toEqual(['3:#text:y']);
  });

  it('becomes specified when a child is added', () => {
    const document = build(`${DTD}<r/>`);
    const attr = document.documentElement?.getAttributeNode('d') as Attr;
    attr.appendChild(document.createTextNode('!'));
    expect([attr.specified, attr.value]).toEqual([true, 'dv!']);
  });

  it('has no parent and gives its owner element', () => {
    const r = build('<r a="v"/>').documentElement as Element;
    const attr = r.getAttributeNode('a') as Attr;
    expect([attr.parentNode, attr.ownerElement]).toEqual([null, r]);
    expect(newDocument().createAttribute('x').ownerElement).toBeNull();
  });

  it('gives the DTD type of a declared attribute, and none for another', () => {
    const r = build(`${DTD}<r i="a" u="b"/>`).documentElement as Element;
    const types = ['i', 'd', 'e', 'u'].map((n) => r.getAttributeNode(n)?.schemaTypeInfo);
    expect(types.map((t) => t?.typeName)).toEqual(['ID', 'CDATA', 'NMTOKEN', null]);
    expect(types.map((t) => t?.typeNamespace)).toEqual([
      'http://www.w3.org/TR/REC-xml',
      'http://www.w3.org/TR/REC-xml',
      'http://www.w3.org/TR/REC-xml',
      null,
    ]);
  });

  it('says whether it is an ID', () => {
    const r = build(`${DTD}<r i="a" u="b"/>`).documentElement as Element;
    expect([r.getAttributeNode('i')?.isId, r.getAttributeNode('u')?.isId]).toEqual([true, false]);
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when set on a read-only element', () => {
    const attr = readOnlyElement().getAttributeNode('a') as Attr;
    expect(() => {
      attr.value = '2';
    }).toThrow(domException('NoModificationAllowedError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when its element cannot change', () => {
    const e = element();
    e.setAttribute('a', '1');
    e._readonly = true;
    expect(() => {
      (e.getAttributeNode('a') as Attr).value = '2';
    }).toThrow(domException('NoModificationAllowedError'));
  });

  it('uses its element for namespace lookups (DOM Level 3 Appendix B)', () => {
    const r = build('<r xmlns:p="urn:p" a="v"/>').documentElement as Element;
    const attr = r.getAttributeNode('a') as Attr;
    expect([attr.lookupNamespaceURI('p'), attr.lookupPrefix('urn:p')]).toEqual(['urn:p', 'p']);
    expect(newDocument().createAttribute('x').lookupNamespaceURI('p')).toBeNull();
  });
});
