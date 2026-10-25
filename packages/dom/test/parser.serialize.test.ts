import { build, newDocument, serialize } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { DOMParser, type Element } from '@/index.ts';

/** Parses a string without namespaces, as DOM Level 1 nodes. */
function parseUnaware(text: string): Element {
  const parser = new DOMParser(new XMLInputFactory({ namespaceAware: false }));
  return parser.parseFromString(text, 'application/xml').documentElement as Element;
}

describe('XMLSerializer: text outside an element (DOM Parsing §3.2.1.5)', () => {
  it('escapes a text node', () => {
    expect(serialize(newDocument().createTextNode('a&b<c>'))).toBe('a&amp;b&lt;c&gt;');
  });

  it('escapes the text of a fragment around its elements', () => {
    const document = newDocument();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('a&b'));
    fragment.appendChild(document.createElement('e'));
    fragment.appendChild(document.createTextNode('<c'));
    expect(serialize(fragment)).toBe('a&amp;b<e/>&lt;c');
  });

  it('escapes the value of an attribute node', () => {
    const attr = newDocument().createAttribute('a');
    attr.value = 'x&y<z';
    expect(serialize(attr)).toBe('x&amp;y&lt;z');
  });

  it('gives text that reads back the same inside an element', () => {
    const text = 'a&b<c>]]>';
    const out = serialize(newDocument().createTextNode(text));
    expect(build(`<r>${out}</r>`).documentElement?.textContent).toBe(text);
  });
});

describe('XMLSerializer: DOM Level 1 names, written as named', () => {
  it.each([
    ['an attribute prefix nothing declares', '<r xsi:type="t"/>'],
    ['an element name starting with a colon', '<r><:b/></r>'],
    ['an attribute name with two colons', '<r a:b:c="B"/>'],
    ['a declared prefix', '<p:r xmlns:p="urn:p" p:x="1"><p:c/></p:r>'],
  ])('writes a document read without namespaces holding %s', (_title, xml) => {
    expect(serialize(parseUnaware(xml))).toBe(xml);
  });

  it('writes an attribute set by name with a prefix', () => {
    const document = newDocument();
    const e = document.createElementNS('urn:a', 'e');
    e.setAttribute('p:x', '1');
    expect(serialize(e)).toBe('<e xmlns="urn:a" p:x="1"/>');
  });
});
