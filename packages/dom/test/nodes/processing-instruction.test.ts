import { build, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { ProcessingInstruction } from '@/index.ts';

describe('ProcessingInstruction', () => {
  it('gives its target as nodeName and its data as nodeValue and textContent (DOM Level 1)', () => {
    const pi = newDocument().createProcessingInstruction('target', 'some data');
    expect([pi.nodeType, pi.nodeName, pi.target, pi.data, pi.nodeValue, pi.textContent]).toEqual([
      7,
      'target',
      'target',
      'some data',
      'some data',
      'some data',
    ]);
  });

  it('sets its data through data, nodeValue and textContent, null as empty', () => {
    const pi = newDocument().createProcessingInstruction('t', 'd');
    pi.data = 'a';
    expect(pi.data).toBe('a');
    pi.nodeValue = 'b';
    expect(pi.data).toBe('b');
    pi.textContent = 'c';
    expect(pi.data).toBe('c');
    pi.nodeValue = null;
    expect(pi.data).toBe('');
    pi.textContent = null;
    expect(pi.data).toBe('');
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR when its data is set inside an entity reference', () => {
    const document = build('<!DOCTYPE r [<!ENTITY p "<?t d?>">]><r>&p;</r>', { replaceEntityReferences: false });
    const pi = document.documentElement?.firstChild?.firstChild as ProcessingInstruction;
    expect(() => {
      pi.data = 'x';
    }).toThrow(domException('NoModificationAllowedError'));
  });

  it('takes its base URI from its parent, or else its document (XML Base §4.3)', () => {
    const document = build({ systemId: 'http://example.com/dir/doc.xml', text: '<?a?><r xml:base="sub/"><?b?></r>' });
    expect((document.firstChild as ProcessingInstruction).baseURI).toBe('http://example.com/dir/doc.xml');
    expect(document.documentElement?.firstChild?.baseURI).toBe('http://example.com/dir/sub/');
  });

  it('has no base URI with no parent or document', () => {
    expect(new ProcessingInstruction(null, 't', '').baseURI).toBeNull();
  });

  it('clones with its target and data', () => {
    const clone = newDocument().createProcessingInstruction('t', 'd').cloneNode() as ProcessingInstruction;
    expect([clone.target, clone.data]).toEqual(['t', 'd']);
  });
});
