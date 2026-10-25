import { build, domException, newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import type { CharacterData, Text } from '@/index.ts';

/** A text node `hello` in an element. */
function hello(): Text {
  const document = newDocument();
  const e = document.createElement('e');
  return e.appendChild(document.createTextNode('hello'));
}

/** Text inside an entity reference, which is read-only. */
function readOnlyText(): Text {
  const document = build('<!DOCTYPE r [<!ENTITY t "ro">]><r>&t;</r>', { replaceEntityReferences: false });
  return document.documentElement?.firstChild?.firstChild as Text;
}

describe('CharacterData (DOM Level 1)', () => {
  it('gives its data, nodeValue, textContent and length', () => {
    const text = hello();
    expect([text.data, text.nodeValue, text.textContent, text.length]).toEqual(['hello', 'hello', 'hello', 5]);
  });

  it('sets its data through data, nodeValue and textContent', () => {
    const text = hello();
    text.data = 'a';
    expect(text.data).toBe('a');
    text.nodeValue = 'b';
    expect(text.data).toBe('b');
    text.textContent = 'c';
    expect(text.data).toBe('c');
  });

  it('reads null set as nodeValue or textContent as empty', () => {
    const text = hello();
    text.nodeValue = null;
    expect(text.data).toBe('');
    text.data = 'x';
    text.textContent = null;
    expect(text.data).toBe('');
  });

  it('converts data to a string', () => {
    const text = hello();
    text.data = 42 as unknown as string;
    expect(text.data).toBe('42');
  });

  it('gives a substring with substringData', () => {
    const text = hello();
    expect([text.substringData(1, 3), text.substringData(2, 100), text.substringData(5, 1)]).toEqual([
      'ell',
      'llo',
      '',
    ]);
  });

  it.each([
    ['a negative offset', -1, 1],
    ['an offset past the end', 6, 1],
    ['a negative count', 0, -1],
  ])('raises INDEX_SIZE_ERR from substringData for %s', (_name, offset, count) => {
    expect(() => hello().substringData(offset, count)).toThrow(domException('IndexSizeError'));
  });

  it('appends data with appendData', () => {
    const text = hello();
    text.appendData(' world');
    expect(text.data).toBe('hello world');
  });

  it('inserts data with insertData, at the start, middle and end', () => {
    const text = hello();
    text.insertData(0, '<');
    text.insertData(3, '-');
    text.insertData(text.length, '>');
    expect(text.data).toBe('<he-llo>');
  });

  it('raises INDEX_SIZE_ERR from insertData past the end', () => {
    expect(() => hello().insertData(6, 'x')).toThrow(domException('IndexSizeError'));
  });

  it('deletes data with deleteData, to the end when the count runs past it', () => {
    const text = hello();
    text.deleteData(1, 2);
    expect(text.data).toBe('hlo');
    text.deleteData(1, 100);
    expect(text.data).toBe('h');
  });

  it('raises INDEX_SIZE_ERR from deleteData for a negative count', () => {
    expect(() => hello().deleteData(0, -1)).toThrow(domException('IndexSizeError'));
  });

  it('replaces data with replaceData', () => {
    const text = hello();
    text.replaceData(1, 3, 'ipp');
    expect(text.data).toBe('hippo');
    text.replaceData(0, 100, 'x');
    expect(text.data).toBe('x');
  });

  it('raises INDEX_SIZE_ERR from replaceData for an offset outside the data', () => {
    expect(() => hello().replaceData(-1, 1, 'x')).toThrow(domException('IndexSizeError'));
  });

  it.each([
    ['data', (t: CharacterData) => (t.data = 'x')],
    ['nodeValue', (t: CharacterData) => (t.nodeValue = 'x')],
    ['textContent', (t: CharacterData) => (t.textContent = 'x')],
    ['appendData', (t: CharacterData) => t.appendData('x')],
    ['insertData', (t: CharacterData) => t.insertData(0, 'x')],
    ['deleteData', (t: CharacterData) => t.deleteData(0, 1)],
    ['replaceData', (t: CharacterData) => t.replaceData(0, 1, 'x')],
  ])('raises NO_MODIFICATION_ALLOWED_ERR from %s on read-only text', (_name, change) => {
    const text = readOnlyText();
    expect(() => change(text)).toThrow(domException('NoModificationAllowedError'));
    expect(text.data).toBe('ro');
  });

  it('raises NO_MODIFICATION_ALLOWED_ERR before INDEX_SIZE_ERR', () => {
    expect(() => readOnlyText().replaceData(-1, 0, 'x')).toThrow(domException('NoModificationAllowedError'));
  });

  it('counts UTF-16 code units, as DOM strings do', () => {
    const text = newDocument().createTextNode('\u{1F600}a');
    expect([text.length, text.substringData(2, 1)]).toEqual([3, 'a']);
  });
});
