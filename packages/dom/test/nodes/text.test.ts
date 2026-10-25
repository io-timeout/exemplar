import { build, children, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { CDATASection, type Document, type Element, type Node, Text } from '@/index.ts';

/** A text node `hello` in an element. */
function hello(): Text {
  const document = newDocument();
  const e = document.createElement('e');
  return e.appendChild(document.createTextNode('hello'));
}

/** The first child of the root of a document built with entity references kept. */
function firstText(xml: string): Text {
  const document = build(xml, { replaceEntityReferences: false, supportExternalEntities: false });
  return document.documentElement?.firstChild as Text;
}

/** Text inside an entity reference, which is read-only. */
function readOnlyText(): Text {
  const document = build('<!DOCTYPE r [<!ENTITY t "ro">]><r>&t;</r>', { replaceEntityReferences: false });
  return document.documentElement?.firstChild?.firstChild as Text;
}

describe('Text', () => {
  it('is a text node named #text', () => {
    const text = hello();
    expect([text.nodeType, text.nodeName, text instanceof Text]).toEqual([3, '#text', true]);
  });

  it('is whitespace in element content only when the DTD makes it so (DOM Level 3 isElementContentWhitespace)', () => {
    const document = build('<!DOCTYPE r [<!ELEMENT r (a)*>]><r> <a> </a></r>');
    const r = document.documentElement as Element;
    expect((r.firstChild as Text).isElementContentWhitespace).toBe(true);
    expect(((r.lastChild as Element).firstChild as Text).isElementContentWhitespace).toBe(false);
    expect(hello().isElementContentWhitespace).toBe(false);
  });
});

describe('Text.splitText (DOM Level 1)', () => {
  it('splits the text, putting the rest in a new node just after it', () => {
    const text = hello();
    const parent = text.parentNode as Element;
    parent.appendChild((parent.ownerDocument as Document).createElement('after'));
    const rest = text.splitText(2);
    expect([text.data, rest.data, text.nextSibling, rest.nextSibling?.nodeName]).toEqual(['he', 'llo', rest, 'after']);
  });

  it('splits at the start and at the end', () => {
    const text = hello();
    expect(text.splitText(5).data).toBe('');
    expect(text.splitText(0).data).toBe('hello');
    expect(text.data).toBe('');
    expect(text.parentNode?.childNodes.length).toBe(3);
  });

  it('returns a node out of the tree for text with no parent', () => {
    const text = newDocument().createTextNode('ab');
    const rest = text.splitText(1);
    expect([text.data, rest.data, rest.parentNode]).toEqual(['a', 'b', null]);
  });

  it('keeps whether the text is whitespace in element content', () => {
    const document = build('<!DOCTYPE r [<!ELEMENT r (a)*>]><r>  <a/></r>');
    const text = document.documentElement?.firstChild as Text;
    expect(text.splitText(1).isElementContentWhitespace).toBe(true);
  });

  it('gives a CDATA section from a CDATA section', () => {
    const cdata = newDocument().createCDATASection('ab');
    const rest = cdata.splitText(1);
    expect([rest instanceof CDATASection, rest.nodeType, rest.data]).toEqual([true, 4, 'b']);
  });

  it.each([-1, 6])('raises INDEX_SIZE_ERR for the offset %d', (offset) => {
    expect(() => hello().splitText(offset)).toThrow(domException('IndexSizeError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on read-only text', () => {
    expect(() => readOnlyText().splitText(1)).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('Text.wholeText (DOM Level 3)', () => {
  it('joins the text and CDATA logically next to the node, in document order', () => {
    const document = newDocument();
    const e = document.createElement('e');
    e.appendChild(document.createComment('stop'));
    e.appendChild(document.createTextNode('a'));
    e.appendChild(document.createCDATASection('b'));
    const middle = e.appendChild(document.createTextNode('c'));
    e.appendChild(document.createTextNode('d'));
    e.appendChild(document.createElement('stop'));
    e.appendChild(document.createTextNode('z'));
    expect(middle.wholeText).toBe('abcd');
  });

  it('reads through entity references that hold only text, nested ones too', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY t "T"><!ENTITY n "&t;<![CDATA[C]]>">]><r>a&n;b&t;</r>');
    expect(text.wholeText).toBe('aTCbT');
  });

  it('reads backwards through entity references that hold only text', () => {
    const document = build('<!DOCTYPE r [<!ENTITY t "T">]><r>&t;b</r>', { replaceEntityReferences: false });
    const last = document.documentElement?.lastChild as Text;
    expect(last.wholeText).toBe('Tb');
  });

  it('stops at an entity reference that holds markup', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY e "x<b/>">]><r>a&e;b</r>');
    expect(text.wholeText).toBe('a');
  });

  it('is the data of a node on its own', () => {
    expect(newDocument().createTextNode('alone').wholeText).toBe('alone');
  });
});

describe('Text.replaceWholeText (DOM Level 3)', () => {
  it('puts the text in this node and removes the text logically next to it', () => {
    const document = newDocument();
    const e = document.createElement('e');
    e.appendChild(document.createTextNode('a'));
    const middle = e.appendChild(document.createCDATASection('b'));
    e.appendChild(document.createTextNode('c'));
    e.appendChild(document.createElement('stop'));
    e.appendChild(document.createTextNode('z'));
    expect(middle.replaceWholeText('X')).toBe(middle);
    expect(children(e)).toEqual(['4:#cdata-section:X', '1:stop:', '3:#text:z']);
  });

  it('removes entity references that hold only text', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY t "T">]><r>a&t;b</r>');
    expect(text.replaceWholeText('X')).toBe(text);
    expect(children(text.parentNode as Node)).toEqual(['3:#text:X']);
  });

  it('removes only this node when the text is empty, as Xerces does', () => {
    const document = newDocument();
    const e = document.createElement('e');
    const a = e.appendChild(document.createTextNode('a'));
    e.appendChild(document.createTextNode('b'));
    expect(a.replaceWholeText('')).toBeNull();
    expect(children(e)).toEqual(['3:#text:b']);
  });

  it('returns null for empty text on a node with no parent', () => {
    expect(newDocument().createTextNode('a').replaceWholeText('')).toBeNull();
  });

  it('sets the data of a node with no parent', () => {
    const text = newDocument().createTextNode('a');
    expect(text.replaceWholeText('b')).toBe(text);
    expect(text.data).toBe('b');
  });

  it('leaves an entity reference that starts with markup', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY e "<b/>x">]><r>a&e;</r>');
    text.replaceWholeText('X');
    expect(children(text.parentNode as Node)).toEqual(['3:#text:X', '5:e:x']);
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when the text runs into an entity reference holding text then markup', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY e "x<b/>">]><r>a&e;</r>');
    expect(() => text.replaceWholeText('X')).toThrow(domException('NoModificationAllowedError'));
    expect(text.data).toBe('a');
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when an entity reference before it ends in text after markup', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "<b/>x">]><r>&e;a</r>', { replaceEntityReferences: false });
    const text = document.documentElement?.lastChild as Text;
    expect(() => text.replaceWholeText('X')).toThrow(domException('NoModificationAllowedError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR next to an empty entity reference, as Xerces does', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY ext SYSTEM "ext.xml">]><r>a&ext;</r>');
    expect(() => text.replaceWholeText('X')).toThrow(domException('NoModificationAllowedError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when a nested entity reference blocks the replacement', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY t "T"><!ENTITY e "x<b/>"><!ENTITY o "&t;&e;">]><r>a&o;</r>');
    expect(() => text.replaceWholeText('X')).toThrow(domException('NoModificationAllowedError'));
  });

  it('removes a nested entity reference that holds only text', () => {
    const text = firstText('<!DOCTYPE r [<!ENTITY t "T"><!ENTITY o "&t;">]><r>a&o;</r>');
    text.replaceWholeText('X');
    expect(children(text.parentNode as Node)).toEqual(['3:#text:X']);
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR for read-only text in an entity reference', () => {
    expect(() => readOnlyText().replaceWholeText('X')).toThrow(domException('NoModificationAllowedError'));
  });

  it('puts a new text node in place of a read-only one whose parent can change', () => {
    const document = newDocument();
    const e = document.createElement('e');
    const text = e.appendChild(document.createTextNode('a'));
    e.appendChild(document.createTextNode('b'));
    text._readonly = true;
    const replacement = text.replaceWholeText('X') as Text;
    expect(replacement).not.toBe(text);
    expect(children(e)).toEqual(['3:#text:X']);
  });

  it('returns a new text node for a read-only one with no parent', () => {
    const text = newDocument().createTextNode('a');
    text._readonly = true;
    const replacement = text.replaceWholeText('X') as Text;
    expect([replacement === text, replacement.data, text.data]).toEqual([false, 'X', 'a']);
  });
});
