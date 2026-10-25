import { canonical } from '@test/helpers/canonical.ts';
import { written } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import type { StreamWriter } from '@/index.ts';

const indent = { indent: '  ' };

describe('StreamWriter indentation (OutputKeys.INDENT)', () => {
  it('indents elements that hold no text', () => {
    const out = written((w) => {
      w.writeStartDocument();
      w.writeStartElement('a');
      w.writeStartElement('b');
      w.writeCharacters('text');
      w.writeEndElement();
      w.writeStartElement('c');
      w.writeEmptyElement('d');
      w.writeEndElement();
      w.writeComment('c');
      w.writeEndDocument();
    }, indent);
    expect(out).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<a>\n  <b>text</b>\n  <c>\n    <d/>\n  </c>\n  <!--c-->\n</a>'
    );
  });

  it('starts each top-level node on a line of its own, with no line before the first', () => {
    const out = written((w) => {
      w.writeComment('first');
      w.writeProcessingInstruction('p');
      w.writeDTD('<!DOCTYPE a>');
      w.writeEmptyElement('a');
      w.writeComment('last');
    }, indent);
    expect(out).toBe('<!--first-->\n<?p?>\n<!DOCTYPE a>\n<a/>\n<!--last-->');
  });

  it('puts the DOCTYPE the options ask for on a line of its own', () => {
    const out = written((w) => (w.writeStartDocument(), w.writeEmptyElement('a')), {
      ...indent,
      doctypeSystem: 'a.dtd',
    });
    expect(out).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE a SYSTEM "a.dtd">\n<a/>');
  });

  it('leaves mixed content as written, indenting nothing inside it', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeStartElement('p');
      w.writeCharacters('a ');
      w.writeStartElement('b');
      w.writeCharacters('bold');
      w.writeEndElement();
      w.writeComment('c');
      w.writeEmptyElement('br');
      w.writeCharacters(' z');
      w.writeEndElement();
      w.writeEndDocument();
    }, indent);
    expect(out).toBe('<r>\n  <p>a <b>bold</b><!--c--><br/> z</p>\n</r>');
    expect(canonical(out)).toContain('<p>a <b>bold</b><br></br> z</p>');
  });

  it('adds no whitespace inside an element holding text, its descendants included', () => {
    const write = (w: StreamWriter) => {
      w.writeStartElement('r');
      w.writeStartElement('p');
      w.writeCharacters('a ');
      w.writeStartElement('b');
      w.writeStartElement('i');
      w.writeCharacters('x');
      w.writeEndElement();
      w.writeEmptyElement('br');
      w.writeComment('c');
      w.writeEndElement();
      w.writeEndElement();
      w.writeStartElement('q');
      w.writeEmptyElement('e');
      w.writeEndDocument();
    };
    const out = written(write, indent);
    expect(out).toBe('<r>\n  <p>a <b><i>x</i><br/><!--c--></b></p>\n  <q>\n    <e/>\n  </q>\n</r>');
    const p = '<p>a <b><i>x</i><br></br></b></p>';
    expect(canonical(written(write))).toContain(p);
    expect(canonical(out)).toContain(p);
  });

  it('indents children written before the text that follows them, never next to the text', () => {
    const out = written((w) => {
      w.writeStartElement('p');
      w.writeStartElement('b');
      w.writeEmptyElement('i');
      w.writeEndElement();
      w.writeCharacters(' tail');
      w.writeEmptyElement('c');
      w.writeEndDocument();
    }, indent);
    expect(out).toBe('<p>\n  <b>\n    <i/>\n  </b> tail<c/></p>');
  });

  it('adds no whitespace after text written outside an element with the checks off', () => {
    const out = written(
      (w) => (w.writeCharacters('a'), w.writeEmptyElement('b'), w.writeComment('c'), w.writeCharacters(' \n')),
      { ...indent, checkWellFormedness: false }
    );
    expect(out).toBe('a<b/><!--c-->');
  });

  it('treats CDATA and entity references as text that makes content mixed', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeStartElement('a');
      w.writeCData('c');
      w.writeEmptyElement('x');
      w.writeEndElement();
      w.writeStartElement('b');
      w.writeEntityRef('amp');
      w.writeEmptyElement('y');
      w.writeEndDocument();
    }, indent);
    expect(out).toBe('<r>\n  <a><![CDATA[c]]><x/></a>\n  <b>&amp;<y/></b>\n</r>');
  });

  it('indents comments and PIs inside elements that hold no text', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeComment('c');
      w.writeProcessingInstruction('p', 'd');
      w.writeEndDocument();
    }, indent);
    expect(out).toBe('<r>\n  <!--c-->\n  <?p d?>\n</r>');
  });

  it('drops whitespace written outside the root element', () => {
    expect(written((w) => (w.writeCharacters('\n\n'), w.writeEmptyElement('a'), w.writeCharacters('\n')), indent)).toBe(
      '<a/>'
    );
  });

  it('indents with any string, a tab or nothing', () => {
    const write = (w: StreamWriter) => {
      w.writeStartElement('a');
      w.writeStartElement('b');
      w.writeEmptyElement('c');
      w.writeEndDocument();
    };
    expect(written(write, { indent: '\t' })).toBe('<a>\n\t<b>\n\t\t<c/>\n\t</b>\n</a>');
    expect(written(write, { indent: '' })).toBe('<a>\n<b>\n<c/>\n</b>\n</a>');
  });

  it('writes no line breaks without the option', () => {
    expect(
      written((w) => (w.writeComment('c'), w.writeStartElement('a'), w.writeEmptyElement('b'), w.writeEndDocument()))
    ).toBe('<!--c--><a><b/></a>');
  });
});
