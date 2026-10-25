import { build, children, newDocument, serialize } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { DOMError } from '@/config.ts';
import { type Document, Element } from '@/index.ts';

const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** Collects the errors normalizing reports, letting it go on. */
function collect(document: Document): DOMError[] {
  const errors: DOMError[] = [];
  document.domConfig.setParameter('error-handler', (error: DOMError) => {
    errors.push(error);
    return true;
  });
  return errors;
}

/** A document whose root is an element in no namespace, with a DOM Level 2 name. */
function documentWith(root = 'r'): Document {
  const document = newDocument();
  document.appendChild(document.createElementNS(null, root));
  return document;
}

describe('normalizeDocument: text', () => {
  it('joins adjacent text nodes and drops empty ones, as Node.normalize does', () => {
    const document = documentWith();
    const root = document.documentElement as Element;
    for (const data of ['a', '', 'b']) root.appendChild(document.createTextNode(data));
    root.appendChild(document.createElementNS(null, 'e'));
    root.appendChild(document.createTextNode(''));
    document.normalizeDocument();
    expect(children(root)).toEqual(['3:#text:ab', '1:e:']);
  });

  it('removes whitespace in element content when element-content-whitespace is off (DOM Level 3 §1.4)', () => {
    const document = build('<!DOCTYPE r [<!ELEMENT r (e)*><!ELEMENT e (#PCDATA)>]><r> <e> </e> </r>');
    document.domConfig.setParameter('element-content-whitespace', false);
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['1:e: ']);
  });

  it('keeps whitespace in element content by default', () => {
    const document = build('<!DOCTYPE r [<!ELEMENT r (e)*>]><r> <e/> </r>');
    document.normalizeDocument();
    expect((document.documentElement as Element).childNodes).toHaveLength(3);
  });

  it('NFC-normalizes text and attribute values when normalize-characters is on', () => {
    const document = build('<r a="e&#x301;">e&#x301;</r>');
    document.domConfig.setParameter('normalize-characters', true);
    document.normalizeDocument();
    const root = document.documentElement as Element;
    expect([root.textContent, root.getAttribute('a')]).toEqual(['\u00E9', '\u00E9']);
  });

  it('leaves attribute values alone when they are already normalized', () => {
    const document = build('<r a="\u00E9"/>');
    document.domConfig.setParameter('normalize-characters', true);
    const attr = (document.documentElement as Element).getAttributeNode('a');
    document.normalizeDocument();
    expect(attr?.value).toBe('\u00E9');
  });

  it('reports text that is not fully normalized when check-character-normalization is on', () => {
    const document = build('<r>e&#x301;</r>');
    const errors = collect(document);
    document.domConfig.setParameter('check-character-normalization', true);
    document.normalizeDocument();
    expect(errors.map((e) => [e.type, e.severity])).toEqual([['check-character-normalization-failure', 2]]);
    expect(errors[0]?.relatedData).toBe(document.documentElement?.firstChild);
  });

  it('reports nothing for normalized text', () => {
    const document = build('<r>\u00E9</r>');
    const errors = collect(document);
    document.domConfig.setParameter('check-character-normalization', true);
    document.normalizeDocument();
    expect(errors).toEqual([]);
  });
});

describe('normalizeDocument: well-formed', () => {
  it('reports a character XML 1.0 does not allow in text (DOM Level 3 §1.4 well-formed)', () => {
    const document = documentWith();
    const errors = collect(document);
    document.documentElement?.appendChild(document.createTextNode('a\u0001b'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });

  it('allows the restricted characters of XML 1.1 in a 1.1 document (XML 1.1 §2.2)', () => {
    const document = documentWith();
    document.xmlVersion = '1.1';
    const errors = collect(document);
    document.documentElement?.appendChild(document.createTextNode('a\u0001b'));
    document.normalizeDocument();
    expect(errors).toEqual([]);
  });

  it('reports NUL even in XML 1.1', () => {
    const document = documentWith();
    document.xmlVersion = '1.1';
    const errors = collect(document);
    document.documentElement?.appendChild(document.createTextNode('\u0000'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });

  it('reports an element or attribute name that is not an XML name', () => {
    const document = newDocument();
    const errors = collect(document);
    const root = new Element(document, '1bad', null, '1bad');
    document.appendChild(root);
    root.setAttributeNodeNS(document.createAttributeNS(null, 'ok'));
    (root.getAttributeNode('ok') as { _name: string })._name = '2bad';
    document.normalizeDocument();
    expect(errors.map((e) => [e.type, e.relatedData === root])).toEqual([
      ['wf-invalid-character-in-node-name', true],
      ['wf-invalid-character-in-node-name', false],
    ]);
  });

  it('reports a character XML does not allow in an attribute value', () => {
    const document = documentWith();
    const errors = collect(document);
    document.documentElement?.setAttributeNS(null, 'a', '\uFFFF');
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });

  it('reports a comment that holds -- or ends with - (§2.5)', () => {
    const document = documentWith();
    const errors = collect(document);
    const root = document.documentElement as Element;
    root.appendChild(document.createComment('a--b'));
    root.appendChild(document.createComment('ends-'));
    root.appendChild(document.createComment('fine'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character', 'wf-invalid-character']);
  });

  it('reports a bad character in a comment', () => {
    const document = documentWith();
    const errors = collect(document);
    document.documentElement?.appendChild(document.createComment('\u0002'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });

  it('reports a bad character in processing instruction data', () => {
    const document = documentWith();
    const errors = collect(document);
    document.appendChild(document.createProcessingInstruction('pi', '\u0003'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });

  it('checks nothing when well-formed is off', () => {
    const document = documentWith();
    const errors = collect(document);
    document.domConfig.setParameter('well-formed', false);
    document.documentElement?.appendChild(document.createTextNode('\u0001'));
    document.documentElement?.appendChild(document.createComment('--'));
    document.normalizeDocument();
    expect(errors).toEqual([]);
  });
});

describe('normalizeDocument: the error handler', () => {
  it('goes on past errors with the default handler', () => {
    const document = documentWith();
    const root = document.documentElement as Element;
    root.appendChild(document.createComment('--'));
    root.appendChild(document.createTextNode('a'));
    root.appendChild(document.createTextNode('b'));
    document.normalizeDocument();
    expect(children(root)).toEqual(['8:#comment:--', '3:#text:ab']);
  });

  it('stops when the handler returns false (DOM Level 3 DOMErrorHandler)', () => {
    const document = documentWith();
    const root = document.documentElement as Element;
    root.appendChild(document.createComment('--'));
    root.appendChild(document.createComment('again--'));
    const seen: string[] = [];
    document.domConfig.setParameter('error-handler', {
      handleError: (error: DOMError) => {
        seen.push(error.relatedData === root.firstChild ? 'first' : 'second');
        return false;
      },
    });
    document.normalizeDocument();
    expect(seen).toEqual(['first']);
  });

  it('goes on when no handler is set', () => {
    const document = documentWith();
    document.domConfig.setParameter('error-handler', null);
    document.documentElement?.appendChild(document.createComment('--'));
    expect(() => document.normalizeDocument()).not.toThrow();
  });

  it('lets an exception from the handler through', () => {
    const document = documentWith();
    document.domConfig.setParameter('error-handler', () => {
      throw new RangeError('handler');
    });
    document.documentElement?.appendChild(document.createComment('--'));
    expect(() => document.normalizeDocument()).toThrow(RangeError);
  });

  it('locates each error at its node', () => {
    const document = documentWith();
    const errors = collect(document);
    const comment = document.createComment('--');
    document.documentElement?.appendChild(comment);
    document.normalizeDocument();
    expect(errors[0]?.location.relatedNode).toBe(comment);
    expect(errors[0]?.severity).toBe(DOMError.SEVERITY_ERROR);
  });
});

describe('normalizeDocument: comments and CDATA', () => {
  it('removes comments when comments is off (DOM Level 3 §1.4 comments)', () => {
    const document = build('<!--a--><r>x<!--b-->y</r>');
    document.domConfig.setParameter('comments', false);
    document.normalizeDocument();
    expect(serialize(document)).toBe('<r>xy</r>');
  });

  it('turns CDATA sections into text joined to its neighbours when cdata-sections is off', () => {
    const document = build('<r>a<![CDATA[<b>]]>c</r>');
    document.domConfig.setParameter('cdata-sections', false);
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['3:#text:a<b>c']);
  });

  it('keeps CDATA sections by default', () => {
    const document = build('<r><![CDATA[x]]></r>');
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['4:#cdata-section:x']);
  });

  it('splits a CDATA section holding ]]> and warns (split-cdata-sections)', () => {
    const document = documentWith();
    const errors = collect(document);
    document.documentElement?.appendChild(document.createCDATASection('a]]>b]]>c'));
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual([
      '4:#cdata-section:a]]',
      '4:#cdata-section:>b]]',
      '4:#cdata-section:>c',
    ]);
    expect(errors.map((e) => [e.type, e.severity])).toEqual([['cdata-sections-splitted', DOMError.SEVERITY_WARNING]]);
  });

  it('splits a CDATA section with one ]]> in two', () => {
    const document = documentWith();
    document.documentElement?.appendChild(document.createCDATASection(']]>'));
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['4:#cdata-section:]]', '4:#cdata-section:>']);
  });

  it('reports a CDATA section holding ]]> as an error when split-cdata-sections is off', () => {
    const document = documentWith();
    const errors = collect(document);
    document.domConfig.setParameter('split-cdata-sections', false);
    document.documentElement?.appendChild(document.createCDATASection('a]]>b'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
    expect(document.documentElement?.childNodes.length).toBe(1);
  });

  it('checks the characters of a CDATA section', () => {
    const document = documentWith();
    const errors = collect(document);
    document.documentElement?.appendChild(document.createCDATASection('\u0001'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });
});

describe('normalizeDocument: entity references', () => {
  const DTD = '<!DOCTYPE r [<!ENTITY e "x<b>y</b>"><!ENTITY o "&e;!"><!ENTITY ext SYSTEM "none.xml">]>';

  it('keeps entity references when entities is on', () => {
    const document = build(`${DTD}<r>&e;</r>`, { replaceEntityReferences: false });
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['5:e:xy']);
  });

  it('puts a writable copy of the expansion in place of a reference when entities is off (DOM Level 3 §1.4)', () => {
    const document = build(`${DTD}<r>a&e;c</r>`, { replaceEntityReferences: false });
    document.domConfig.setParameter('entities', false);
    document.normalizeDocument();
    const root = document.documentElement as Element;
    expect(children(root)).toEqual(['3:#text:ax', '1:b:y', '3:#text:c']);
    const b = root.childNodes.item(1) as Element;
    b.setAttribute('k', 'v');
    expect(b.getAttribute('k')).toBe('v');
  });

  it('expands references nested in an expansion', () => {
    const document = build(`${DTD}<r>&o;</r>`, { replaceEntityReferences: false });
    document.domConfig.setParameter('entities', false);
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['3:#text:x', '1:b:y', '3:#text:!']);
  });

  it('normalizes the nodes after a replaced reference once', () => {
    const document = build(`${DTD}<r>&e;<!--c--></r>`, { replaceEntityReferences: false });
    document.documentElement?.appendChild(document.createComment('a--b'));
    const errors = collect(document);
    document.domConfig.setParameter('entities', false);
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual([
      '3:#text:x',
      '1:b:y',
      '8:#comment:c',
      '8:#comment:a--b',
    ]);
    expect(errors.map((e) => e.type)).toEqual(['wf-invalid-character']);
  });

  it('removes a comment after a replaced reference when comments is off', () => {
    const document = build(`${DTD}<r>&e;<!--c--></r>`, { replaceEntityReferences: false });
    document.domConfig.setParameter('entities', false);
    document.domConfig.setParameter('comments', false);
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['3:#text:x', '1:b:y']);
  });

  it('keeps a reference to an entity that was not read', () => {
    const document = build(`${DTD}<r>&ext;</r>`, { replaceEntityReferences: false, supportExternalEntities: false });
    document.domConfig.setParameter('entities', false);
    document.normalizeDocument();
    expect(children(document.documentElement as Element)).toEqual(['5:ext:']);
  });
});

describe('normalizeDocument: namespace declarations', () => {
  it('removes namespace declarations when namespace-declarations is off (DOM Level 3 §1.4)', () => {
    const document = build('<r xmlns="urn:a" xmlns:p="urn:p" a="1"/>');
    document.domConfig.setParameter('namespace-declarations', false);
    document.normalizeDocument();
    const root = document.documentElement as Element;
    expect([...root.attributes].map((a) => a.nodeName)).toEqual(['a']);
  });
});

describe('normalizeDocument: namespace fix-up (DOM Level 3 Appendix B.1)', () => {
  it('declares the namespace of an element whose prefix is not bound', () => {
    const document = newDocument();
    document.appendChild(document.createElementNS('urn:a', 'p:r'));
    document.normalizeDocument();
    expect(document.documentElement?.getAttributeNS(XMLNS, 'p')).toBe('urn:a');
  });

  it('declares the default namespace of an unprefixed element', () => {
    const document = newDocument();
    document.appendChild(document.createElementNS('urn:a', 'r'));
    document.normalizeDocument();
    expect(document.documentElement?.getAttributeNS(XMLNS, 'xmlns')).toBe('urn:a');
  });

  it('declares nothing for an element whose namespace is in scope', () => {
    const document = build('<p:r xmlns:p="urn:a"><p:c/></p:r>');
    document.normalizeDocument();
    const c = document.documentElement?.firstChild as Element;
    expect(c.hasAttributes()).toBe(false);
  });

  it('undeclares the default namespace for an element in no namespace below one in a default namespace', () => {
    const document = build('<r xmlns="urn:a"/>');
    const root = document.documentElement as Element;
    root.appendChild(document.createElementNS(null, 'c'));
    document.normalizeDocument();
    expect((root.firstChild as Element).getAttributeNS(XMLNS, 'xmlns')).toBe('');
    expect(serialize(document)).toBe('<r xmlns="urn:a"><c xmlns=""/></r>');
  });

  it('declares nothing for an element in no namespace where no default namespace is in scope', () => {
    const document = documentWith();
    document.normalizeDocument();
    expect(document.documentElement?.hasAttributes()).toBe(false);
  });

  it('reports a DOM Level 1 element, which has no local name', () => {
    const document = newDocument();
    const errors = collect(document);
    document.appendChild(document.createElement('r'));
    document.normalizeDocument();
    expect(errors.map((e) => e.type)).toEqual(['NullLocalElementName']);
  });

  it('reports a DOM Level 1 attribute, and accepts one in no namespace with a local name', () => {
    const document = documentWith();
    const errors = collect(document);
    const root = document.documentElement as Element;
    root.setAttribute('level1', 'v');
    root.setAttributeNS(null, 'level2', 'v');
    document.normalizeDocument();
    expect(errors.map((e) => [e.type, (e.relatedData as { nodeName: string }).nodeName])).toEqual([
      ['NullLocalAttrName', 'level1'],
    ]);
  });

  it('leaves an attribute whose prefix is bound to its namespace', () => {
    const document = build('<r xmlns:p="urn:p"/>');
    const root = document.documentElement as Element;
    root.setAttributeNS('urn:p', 'p:a', 'v');
    document.normalizeDocument();
    expect([...root.attributes].map((a) => a.nodeName)).toEqual(['xmlns:p', 'p:a']);
  });

  it('renames an attribute to a prefix bound to its namespace', () => {
    const document = build('<r xmlns:q="urn:p"/>');
    const root = document.documentElement as Element;
    root.setAttributeNS('urn:p', 'p:a', 'v');
    document.normalizeDocument();
    expect(root.getAttributeNodeNS('urn:p', 'a')?.nodeName).toBe('q:a');
  });

  it('does not use a prefix that an inner declaration has rebound', () => {
    const document = build('<r xmlns:q="urn:p"><c xmlns:q="urn:other"/></r>');
    const c = document.documentElement?.firstChild as Element;
    c.setAttributeNS('urn:p', 'p:a', 'v');
    document.normalizeDocument();
    expect(c.getAttributeNodeNS('urn:p', 'a')?.nodeName).toBe('p:a');
    expect(c.getAttributeNS(XMLNS, 'p')).toBe('urn:p');
  });

  it('declares an attribute prefix that nothing binds', () => {
    const document = documentWith();
    const root = document.documentElement as Element;
    root.setAttributeNS('urn:p', 'p:a', 'v');
    document.normalizeDocument();
    expect(root.getAttributeNS(XMLNS, 'p')).toBe('urn:p');
  });

  it('generates a prefix NS1, NS2… when an attribute has none', () => {
    const document = documentWith();
    const root = document.documentElement as Element;
    root.setAttributeNS('urn:p', 'a', 'v');
    root.setAttributeNS('urn:q', 'b', 'v');
    document.normalizeDocument();
    expect([root.getAttributeNodeNS('urn:p', 'a')?.nodeName, root.getAttributeNodeNS('urn:q', 'b')?.nodeName]).toEqual([
      'NS1:a',
      'NS2:b',
    ]);
    expect([root.getAttributeNS(XMLNS, 'NS1'), root.getAttributeNS(XMLNS, 'NS2')]).toEqual(['urn:p', 'urn:q']);
  });

  it('generates a prefix when the attribute prefix is bound to another namespace', () => {
    const document = build('<r xmlns:p="urn:other" xmlns:NS1="urn:taken"/>');
    const root = document.documentElement as Element;
    root.setAttributeNS('urn:p', 'p:a', 'v');
    document.normalizeDocument();
    expect(root.getAttributeNodeNS('urn:p', 'a')?.nodeName).toBe('NS2:a');
  });

  it('passes over declarations of the xml and xmlns prefixes', () => {
    const document = build('<r xmlns:xml="http://www.w3.org/XML/1998/namespace"/>');
    const root = document.documentElement as Element;
    root.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'en');
    document.normalizeDocument();
    expect([...root.attributes].map((a) => a.nodeName)).toEqual(['xmlns:xml', 'xml:lang']);
  });

  it('binds an undeclared default namespace from xmlns=""', () => {
    const document = build('<r xmlns="urn:a"><c xmlns=""/></r>');
    const c = document.documentElement?.firstChild as Element;
    c.appendChild(document.createElementNS(null, 'g'));
    document.normalizeDocument();
    expect((c.firstChild as Element).hasAttributes()).toBe(false);
  });

  it('ends a declaration with the element that makes it', () => {
    const document = documentWith();
    const root = document.documentElement as Element;
    const [a, b] = [document.createElementNS('urn:x', 'x:a'), document.createElementNS('urn:x', 'x:b')];
    root.appendChild(a);
    root.appendChild(b);
    document.normalizeDocument();
    expect([a.getAttributeNS(XMLNS, 'x'), b.getAttributeNS(XMLNS, 'x')]).toEqual(['urn:x', 'urn:x']);
  });

  it('fixes nothing when namespaces is off', () => {
    const document = newDocument();
    document.appendChild(document.createElementNS('urn:a', 'p:r'));
    document.domConfig.setParameter('namespaces', false);
    document.normalizeDocument();
    expect(document.documentElement?.hasAttributes()).toBe(false);
  });
});

describe('normalizeDocument: the document', () => {
  it('normalizes the children of a document with no element', () => {
    const document = newDocument();
    document.appendChild(document.createComment('only'));
    document.normalizeDocument();
    expect(children(document)).toEqual(['8:#comment:only']);
  });

  it('keeps the document type', () => {
    const document = build('<!DOCTYPE r><r/>');
    document.normalizeDocument();
    expect(document.doctype?.name).toBe('r');
  });

  it('leaves a text node in place when it is the only child', () => {
    const document = documentWith();
    const text = document.createTextNode('t');
    document.documentElement?.appendChild(text);
    document.normalizeDocument();
    expect(document.documentElement?.firstChild).toBe(text);
    expect(text.data).toBe('t');
  });
});
