import { build, children, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { type Attr, DOMImplementation, type Document, type Element, type Node, type Text } from '@/index.ts';

/** A document `<r><a/><b/><c/></r>` and its nodes. */
function tree(): { document: Document; r: Element; a: Element; b: Element; c: Element } {
  const document = build('<r><a/><b/><c/></r>');
  const r = document.documentElement as Element;
  const [a, b, c] = [...r.childNodes] as Element[];
  return { document, r, a: a as Element, b: b as Element, c: c as Element };
}

/** The names of a node's children. */
function names(node: Node): string[] {
  return [...node.childNodes].map((n) => n.nodeName);
}

/** A document with an entity reference `&e;` to `<b>x</b>` kept in the tree. */
function withReference(): { document: Document; r: Element; reference: Node } {
  const document = build('<!DOCTYPE r [<!ENTITY e "<b>x</b>">]><r>&e;</r>', { replaceEntityReferences: false });
  const r = document.documentElement as Element;
  return { document, r, reference: r.firstChild as Node };
}

describe('Node.insertBefore', () => {
  it('inserts a node before the reference node (DOM Level 1 Node.insertBefore)', () => {
    const { document, r, b } = tree();
    const x = document.createElement('x');
    expect(r.insertBefore(x, b)).toBe(x);
    expect(names(r)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('appends when the reference node is null', () => {
    const { document, r } = tree();
    r.insertBefore(document.createElement('x'), null);
    expect(names(r)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('moves a node already in the tree', () => {
    const { r, a, c } = tree();
    r.insertBefore(c, a);
    expect(names(r)).toEqual(['c', 'a', 'b']);
  });

  it('moves a node from another parent', () => {
    const { document, r, a } = tree();
    const x = document.createElement('x');
    x.appendChild(document.createTextNode('t'));
    a.appendChild(x.firstChild as Node);
    expect([x.hasChildNodes(), a.textContent, r.textContent]).toEqual([false, 't', 't']);
  });

  it('changes nothing when a node is inserted before itself', () => {
    const { r, b } = tree();
    expect(r.insertBefore(b, b)).toBe(b);
    expect(names(r)).toEqual(['a', 'b', 'c']);
  });

  it('inserts the children of a document fragment, leaving it empty', () => {
    const { document, r, b } = tree();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('x'));
    fragment.appendChild(document.createTextNode('y'));
    expect(r.insertBefore(fragment, b)).toBe(fragment);
    expect(names(r)).toEqual(['a', 'x', '#text', 'b', 'c']);
    expect(fragment.hasChildNodes()).toBe(false);
  });

  it('inserts nothing from an empty fragment', () => {
    const { document, r } = tree();
    r.appendChild(document.createDocumentFragment());
    expect(names(r)).toEqual(['a', 'b', 'c']);
  });

  it('raises NOT_FOUND_ERR when the reference node is not a child', () => {
    const { document, r, a } = tree();
    expect(() => r.insertBefore(document.createElement('x'), a.ownerDocument as Node)).toThrow(
      domException('NotFoundError')
    );
    const other = document.createElement('o');
    expect(() => a.insertBefore(document.createElement('x'), other)).toThrow(domException('NotFoundError'));
  });

  it('raises WRONG_DOCUMENT_ERR for a node from another document', () => {
    const { r } = tree();
    expect(() => r.appendChild(newDocument().createElement('x'))).toThrow(domException('WrongDocumentError'));
  });

  it('raises WRONG_DOCUMENT_ERR for another document', () => {
    const { r } = tree();
    expect(() => r.appendChild(newDocument())).toThrow(domException('WrongDocumentError'));
  });

  it('raises HIERARCHY_REQUEST_ERR for a node inserted into itself', () => {
    const { a } = tree();
    expect(() => a.appendChild(a)).toThrow(domException('HierarchyRequestError'));
  });

  it('raises HIERARCHY_REQUEST_ERR for an ancestor inserted into its descendant', () => {
    const { r, a } = tree();
    expect(() => a.appendChild(r)).toThrow(domException('HierarchyRequestError'));
  });

  it('raises HIERARCHY_REQUEST_ERR for a document inserted into its own element', () => {
    const { document, r } = tree();
    expect(() => r.appendChild(document)).toThrow(domException('HierarchyRequestError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR for a read-only parent', () => {
    const { document, reference } = withReference();
    expect(() => reference.appendChild(document.createElement('x'))).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when moving a node out of a read-only parent', () => {
    const { r, reference } = withReference();
    expect(() => r.appendChild(reference.firstChild as Node)).toThrow(domException('NoModificationAllowedError'));
  });

  it('checks writability before the document, as Xerces does', () => {
    const { reference } = withReference();
    expect(() => reference.appendChild(newDocument().createElement('x'))).toThrow(
      domException('NoModificationAllowedError')
    );
  });

  it('checks the document before the hierarchy', () => {
    const { document } = tree();
    expect(() => document.appendChild(newDocument().createElement('x'))).toThrow(domException('WrongDocumentError'));
  });

  it('checks the hierarchy before the reference node', () => {
    const { document, a } = tree();
    expect(() => document.insertBefore(document.createTextNode('t'), a)).toThrow(domException('HierarchyRequestError'));
  });
});

describe('the children each node type may hold (DOM Level 3 §1.1.1)', () => {
  /** A node of each kind, owned by one document. */
  function kinds(document: Document): Record<string, () => Node> {
    return {
      element: () => document.createElement('e'),
      attribute: () => document.createAttribute('a'),
      text: () => document.createTextNode('t'),
      cdata: () => document.createCDATASection('c'),
      reference: () => document.createEntityReference('e'),
      pi: () => document.createProcessingInstruction('p', 'd'),
      comment: () => document.createComment('c'),
      fragment: () => document.createDocumentFragment(),
      doctype: () => document.implementation.createDocumentType('d', null, null),
    };
  }

  it.each([
    ['element', ['element', 'text', 'cdata', 'reference', 'pi', 'comment']],
    ['fragment', ['element', 'text', 'cdata', 'reference', 'pi', 'comment']],
    ['attribute', ['text', 'reference']],
    ['document', ['element', 'pi', 'comment', 'doctype']],
  ])('lets a %s hold %j', (parentKind, allowed) => {
    for (const kind of allowed) {
      const document = newDocument();
      const parent = parentKind === 'document' ? document : (kinds(document)[parentKind] as () => Node)();
      const child = (kinds(document)[kind] as () => Node)();
      expect(parent.appendChild(child), `${parentKind} holding ${kind}`).toBe(child);
    }
  });

  it.each([
    ['element', ['attribute', 'doctype']],
    ['fragment', ['attribute', 'doctype']],
    ['attribute', ['element', 'cdata', 'pi', 'comment', 'attribute']],
    ['document', ['text', 'cdata', 'reference', 'attribute']],
    ['text', ['text', 'element']],
    ['comment', ['text']],
    ['pi', ['text']],
    ['cdata', ['text']],
    ['doctype', ['text', 'element']],
  ])('raises HIERARCHY_REQUEST_ERR when a %s is given any of %j', (parentKind, refused) => {
    for (const kind of refused) {
      const document = newDocument();
      const parent = parentKind === 'document' ? document : (kinds(document)[parentKind] as () => Node)();
      if (parentKind === 'doctype') document.appendChild(parent);
      const child = (kinds(document)[kind] as () => Node)();
      expect(() => parent.appendChild(child), `${parentKind} holding ${kind}`).toThrow(
        domException('HierarchyRequestError')
      );
    }
  });

  it('raises HIERARCHY_REQUEST_ERR for a fragment holding a node its new parent cannot hold', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('t'));
    expect(() => document.appendChild(fragment)).toThrow(domException('HierarchyRequestError'));
    expect(fragment.hasChildNodes()).toBe(true);
  });

  it('raises HIERARCHY_REQUEST_ERR for entity and notation nodes', () => {
    const document = build('<!DOCTYPE r [<!ENTITY e "x"><!NOTATION n SYSTEM "n">]><r/>');
    const r = document.documentElement as Element;
    for (const node of [document.doctype?.entities.item(0), document.doctype?.notations.item(0)]) {
      expect(() => r.appendChild(node as Node)).toThrow(domException('HierarchyRequestError'));
    }
  });
});

describe('the children of a document (DOM Level 3 §1.1.1)', () => {
  it('raises HIERARCHY_REQUEST_ERR for a second document element', () => {
    const { document } = tree();
    expect(() => document.appendChild(document.createElement('x'))).toThrow(domException('HierarchyRequestError'));
  });

  it('raises HIERARCHY_REQUEST_ERR for a second document type', () => {
    const document = build('<!DOCTYPE r><r/>');
    const doctype = document.implementation.createDocumentType('s', null, null);
    expect(() => document.insertBefore(doctype, document.documentElement)).toThrow(
      domException('HierarchyRequestError')
    );
  });

  it('raises HIERARCHY_REQUEST_ERR for a fragment holding two elements', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('a'));
    fragment.appendChild(document.createElement('b'));
    expect(() => document.appendChild(fragment)).toThrow(domException('HierarchyRequestError'));
  });

  it('raises HIERARCHY_REQUEST_ERR for a fragment holding an element when there is one', () => {
    const { document } = tree();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('x'));
    expect(() => document.appendChild(fragment)).toThrow(domException('HierarchyRequestError'));
  });

  it('accepts a fragment holding an element, a comment and a processing instruction', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createComment('c'));
    fragment.appendChild(document.createElement('r'));
    fragment.appendChild(document.createProcessingInstruction('p', ''));
    document.appendChild(fragment);
    expect(names(document)).toEqual(['#comment', 'r', 'p']);
    expect(document.documentElement?.nodeName).toBe('r');
  });

  it('lets the document element move within the document', () => {
    const document = build('<!--c--><r/>');
    document.insertBefore(document.documentElement as Node, document.firstChild);
    expect(names(document)).toEqual(['r', '#comment']);
  });

  it('replaces the document element with another', () => {
    const { document, r } = tree();
    const x = document.createElement('x');
    expect(document.replaceChild(x, r)).toBe(r);
    expect(document.documentElement).toBe(x);
  });

  it('raises HIERARCHY_REQUEST_ERR when replacing another child with a second element', () => {
    const document = build('<!--c--><r/>');
    expect(() => document.replaceChild(document.createElement('x'), document.firstChild as Node)).toThrow(
      domException('HierarchyRequestError')
    );
  });

  it('takes ownership of a document type created without a document (DOM Level 3 §1.4 DocumentType)', () => {
    const document = newDocument();
    const doctype = new DOMImplementation().createDocumentType('r', null, null);
    expect(doctype.ownerDocument).toBeNull();
    document.appendChild(doctype);
    expect([doctype.ownerDocument, document.doctype]).toEqual([document, doctype]);
  });

  it('raises WRONG_DOCUMENT_ERR for a document type another document owns', () => {
    const other = build('<!DOCTYPE r><r/>');
    const doctype = other.doctype as Node;
    other.removeChild(doctype);
    expect(() => newDocument().appendChild(doctype)).toThrow(domException('WrongDocumentError'));
  });
});

describe('Node.appendChild', () => {
  it('appends and returns the child (DOM Level 1 Node.appendChild)', () => {
    const { document, r } = tree();
    const x = document.createElement('x');
    expect(r.appendChild(x)).toBe(x);
    expect([r.lastChild, x.previousSibling?.nodeName]).toEqual([x, 'c']);
  });

  it('makes the first child of an empty node', () => {
    const document = newDocument();
    const e = document.createElement('e');
    const t = e.appendChild(document.createTextNode('t'));
    expect([e.firstChild, e.lastChild, t.previousSibling, t.nextSibling]).toEqual([t, t, null, null]);
  });
});

describe('Node.removeChild', () => {
  it('removes and returns the child, unlinking it (DOM Level 1 Node.removeChild)', () => {
    const { r, a, b, c } = tree();
    expect(r.removeChild(b)).toBe(b);
    expect([b.parentNode, b.previousSibling, b.nextSibling, a.nextSibling, c.previousSibling]).toEqual([
      null,
      null,
      null,
      c,
      a,
    ]);
  });

  it('removes the first and last children', () => {
    const { r, a, b, c } = tree();
    r.removeChild(a);
    r.removeChild(c);
    expect([r.firstChild, r.lastChild]).toEqual([b, b]);
  });

  it('raises NOT_FOUND_ERR for a node that is not a child', () => {
    const { r, a } = tree();
    expect(() => a.removeChild(r)).toThrow(domException('NotFoundError'));
    expect(() => r.removeChild(null as unknown as Node)).toThrow(domException('NotFoundError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR for a read-only parent', () => {
    const { reference } = withReference();
    expect(() => reference.removeChild(reference.firstChild as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
  });
});

describe('Node.remove', () => {
  it('removes the node from its parent and unlinks it (WHATWG DOM ChildNode.remove)', () => {
    const { r, a, b, c } = tree();
    b.remove();
    expect([b.parentNode, b.previousSibling, b.nextSibling, a.nextSibling, c.previousSibling]).toEqual([
      null,
      null,
      null,
      c,
      a,
    ]);
    expect(names(r)).toEqual(['a', 'c']);
  });

  it('removes the document type and the document element', () => {
    const document = build('<!DOCTYPE r><r/>');
    document.doctype?.remove();
    document.documentElement?.remove();
    expect([document.doctype, document.documentElement, document.firstChild]).toEqual([null, null, null]);
  });

  it('does nothing for a node without a parent, attributes included', () => {
    const { document, r } = tree();
    r.setAttribute('x', '1');
    const attr = r.getAttributeNode('x') as Attr;
    for (const node of [document.createElement('loose'), document.createDocumentFragment(), document, attr]) {
      node.remove();
    }
    expect([attr.ownerElement, r.getAttribute('x'), document.documentElement]).toEqual([r, '1', r]);
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR for a child of a read-only node', () => {
    const { reference } = withReference();
    expect(() => (reference.firstChild as Node).remove()).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('Node.replaceChild', () => {
  it('puts the new child where the old one was and returns the old (DOM Level 1 Node.replaceChild)', () => {
    const { document, r, b } = tree();
    const x = document.createElement('x');
    expect(r.replaceChild(x, b)).toBe(b);
    expect(names(r)).toEqual(['a', 'x', 'c']);
    expect(b.parentNode).toBeNull();
  });

  it('replaces a node with its next sibling', () => {
    const { r, a, b } = tree();
    r.replaceChild(b, a);
    expect(names(r)).toEqual(['b', 'c']);
  });

  it('replaces a node with its previous sibling', () => {
    const { r, a, b } = tree();
    r.replaceChild(a, b);
    expect(names(r)).toEqual(['a', 'c']);
  });

  it('changes nothing when a node replaces itself', () => {
    const { r, b } = tree();
    expect(r.replaceChild(b, b)).toBe(b);
    expect(names(r)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a node with the children of a fragment', () => {
    const { document, r, b } = tree();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('x'));
    fragment.appendChild(document.createElement('y'));
    r.replaceChild(fragment, b);
    expect(names(r)).toEqual(['a', 'x', 'y', 'c']);
  });

  it('raises NOT_FOUND_ERR when the old node is not a child', () => {
    const { document, a } = tree();
    expect(() => a.replaceChild(document.createElement('x'), document.createElement('y'))).toThrow(
      domException('NotFoundError')
    );
  });

  it('checks the new node before finding the old one, as Xerces does', () => {
    const { a } = tree();
    expect(() => a.replaceChild(newDocument().createElement('x'), a)).toThrow(domException('WrongDocumentError'));
  });

  it('raises HIERARCHY_REQUEST_ERR when the new node is an ancestor', () => {
    const { r, a } = tree();
    a.appendChild((a.ownerDocument as Document).createElement('inner'));
    expect(() => a.replaceChild(r, a.firstChild as Node)).toThrow(domException('HierarchyRequestError'));
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR for a read-only parent', () => {
    const { document, reference } = withReference();
    expect(() => reference.replaceChild(document.createElement('x'), reference.firstChild as Node)).toThrow(
      domException('NoModificationAllowedError')
    );
  });
});

describe('Node.textContent (DOM Level 3)', () => {
  it('joins the text below a node, leaving out comments and processing instructions', () => {
    const document = build('<r>a<!--c--><b>b<?p d?></b><![CDATA[c]]></r>');
    expect(document.documentElement?.textContent).toBe('abc');
  });

  it('leaves out whitespace in element content', () => {
    const document = build('<!DOCTYPE r [<!ELEMENT r (b)*>]><r> <b>x y</b> </r>');
    expect(document.documentElement?.textContent).toBe('x y');
  });

  it('gives the text of entity references', () => {
    const { r } = withReference();
    expect(r.textContent).toBe('x');
  });

  it('replaces the children with one text node', () => {
    const { r } = tree();
    r.textContent = 'new';
    expect(children(r)).toEqual(['3:#text:new']);
  });

  it.each([
    ['empty', ''],
    ['null', null],
  ])('removes the children when set to %s', (_name, value) => {
    const { r } = tree();
    r.textContent = value;
    expect(r.hasChildNodes()).toBe(false);
  });

  it('sets the text of a fragment', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.textContent = 'f';
    expect(fragment.textContent).toBe('f');
  });

  it('is null for a document, and setting it has no effect', () => {
    const { document } = tree();
    document.textContent = 'x';
    expect([document.textContent, document.documentElement?.nodeName]).toEqual([null, 'r']);
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR on a read-only node', () => {
    const { reference } = withReference();
    expect(() => {
      reference.textContent = 'x';
    }).toThrow(domException('NoModificationAllowedError'));
  });
});

describe('Node.normalize (DOM Level 2)', () => {
  it('joins adjacent text nodes and removes empty ones', () => {
    const document = newDocument();
    const e = document.createElement('e');
    for (const data of ['', 'a', 'b', '', 'c']) e.appendChild(document.createTextNode(data));
    e.appendChild(document.createElement('x'));
    e.appendChild(document.createTextNode('d'));
    e.normalize();
    expect(children(e)).toEqual(['3:#text:abc', '1:x:', '3:#text:d']);
  });

  it('keeps the first text node, appending the others to it', () => {
    const document = newDocument();
    const e = document.createElement('e');
    const first = e.appendChild(document.createTextNode('a'));
    e.appendChild(document.createTextNode('b'));
    e.normalize();
    expect([e.firstChild, first.data]).toEqual([first, 'ab']);
  });

  it('normalizes descendants', () => {
    const document = build('<r><a>x</a></r>');
    const a = document.documentElement?.firstChild as Element;
    a.appendChild(document.createTextNode('y'));
    document.normalize();
    expect(children(a)).toEqual(['3:#text:xy']);
  });

  it('does not join CDATA sections to text', () => {
    const document = newDocument();
    const e = document.createElement('e');
    e.appendChild(document.createTextNode('a'));
    e.appendChild(document.createCDATASection('b'));
    e.normalize();
    expect(e.childNodes).toHaveLength(2);
  });

  it('normalizes the text children of attributes', () => {
    const document = newDocument();
    const e = document.createElement('e');
    e.setAttribute('a', 'x');
    const attr = e.getAttributeNode('a') as Attr;
    attr.appendChild(document.createTextNode('y'));
    attr.appendChild(document.createTextNode(''));
    e.normalize();
    expect([attr.childNodes.length, attr.value]).toEqual([1, 'xy']);
  });

  it('leaves an attribute whose value is still a string', () => {
    const document = build('<r a="v"/>');
    const attr = document.documentElement?.getAttributeNode('a') as Attr;
    attr.normalize();
    expect(attr.value).toBe('v');
  });

  it('NFC-normalizes text when the document configuration says normalize-characters', () => {
    const document = build('<r>e&#x301;<a>e&#x301;</a></r>');
    document.domConfig.setParameter('normalize-characters', true);
    document.normalize();
    expect(document.documentElement?.textContent).toBe('\u00E9\u00E9');
  });

  it('NFC-normalizes text once joined, and CDATA sections, when normalize-characters is on', () => {
    const document = newDocument();
    document.domConfig.setParameter('normalize-characters', true);
    const e = document.createElement('e');
    for (const data of ['e', '́', '']) e.appendChild(document.createTextNode(data));
    e.appendChild(document.createCDATASection('é'));
    e.normalize();
    expect(children(e)).toEqual(['3:#text:é', '4:#cdata-section:é']);
  });

  it('NFC-normalizes a text node normalized on its own only when asked', () => {
    const document = build('<r>e&#x301;</r>');
    const text = document.documentElement?.firstChild as Text;
    text.normalize();
    expect(text.data).toBe('e\u0301');
    document.domConfig.setParameter('normalize-characters', true);
    text.normalize();
    expect(text.data).toBe('\u00E9');
  });
});
