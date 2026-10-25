import { canonical } from '@test/helpers/canonical.ts';
import { codeOf, written } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import { XMLError } from '@exemplarjs/xml';
import type { StreamWriter } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** The error code reading a document raises, or `none`. */
function readerCode(xml: string): string {
  try {
    canonical(xml);
  } catch (error) {
    if (error instanceof XMLError) return error.code;
    throw error;
  }
  return 'none';
}

/** A table row: what is refused, the writes, the writer's code, and the reader's code for the output written unchecked. */
type Refusal = [string, (w: StreamWriter) => void, string, string];

/** Writes inside a root element, ending the document. */
function inside(write: (w: StreamWriter) => void): (w: StreamWriter) => void {
  return (w) => {
    w.writeStartElement('r');
    write(w);
    w.writeEndDocument();
  };
}

describe('the writer refuses what the reader would reject', () => {
  it.each<Refusal>([
    ['an element name that is not a name (§2.3)', (w) => w.writeEmptyElement('1a'), 'WRITE_NAME', 'WF_NAME'],
    ['an attribute name that is not a name', inside((w) => w.writeAttribute('a b', '1')), 'WRITE_NAME', 'WF_ATTRIBUTE'],
    ['-- in a comment (§2.5)', inside((w) => w.writeComment('a--b')), 'WRITE_COMMENT', 'WF_COMMENT'],
    ['a comment ending with -', inside((w) => w.writeComment('a-')), 'WRITE_COMMENT', 'WF_COMMENT'],
    [
      'the PI target xml (§2.6)',
      inside((w) => w.writeProcessingInstruction('xml', 'x')),
      'WRITE_PI',
      'WF_XML_DECLARATION_MISPLACED',
    ],
    ['a PI target that is not a name', inside((w) => w.writeProcessingInstruction('1p')), 'WRITE_PI', 'WF_PI'],
    [
      'a character XML 1.0 does not allow in text (§2.2)',
      inside((w) => w.writeCharacters('\u0001')),
      'WRITE_CHARACTER',
      'WF_INVALID_CHARACTER',
    ],
    [
      'a character XML does not allow in an attribute value',
      inside((w) => w.writeAttribute('a', '\uFFFE')),
      'WRITE_CHARACTER',
      'WF_INVALID_CHARACTER',
    ],
    [
      'a character XML does not allow in a comment',
      inside((w) => w.writeComment('\u0000')),
      'WRITE_CHARACTER',
      'WF_INVALID_CHARACTER',
    ],
    [
      'a character XML does not allow in a CDATA section',
      inside((w) => w.writeCData('\u0002')),
      'WRITE_CHARACTER',
      'WF_INVALID_CHARACTER',
    ],
    [
      'a restricted character written in an XML 1.1 PI',
      (w) => (
        w.writeStartDocument('1.1'),
        w.writeStartElement('r'),
        w.writeProcessingInstruction('p', '\u0080'),
        w.writeEndDocument()
      ),
      'WRITE_CHARACTER',
      'WF_INVALID_CHARACTER',
    ],
    [
      'a second root element (§2.1)',
      (w) => (w.writeEmptyElement('a'), w.writeEmptyElement('b')),
      'WRITE_STATE',
      'WF_SECOND_ROOT',
    ],
    [
      'text before the root element',
      (w) => (w.writeCharacters('text'), w.writeEmptyElement('a')),
      'WRITE_STATE',
      'WF_CONTENT_OUTSIDE_ROOT',
    ],
    [
      'a CDATA section after the root element',
      (w) => (w.writeEmptyElement('a'), w.writeCharacters(''), w.writeCData('x')),
      'WRITE_STATE',
      'WF_CONTENT_OUTSIDE_ROOT',
    ],
    [
      'an entity reference before the root element',
      (w) => (w.writeEntityRef('amp'), w.writeEmptyElement('a')),
      'WRITE_STATE',
      'WF_CONTENT_OUTSIDE_ROOT',
    ],
    [
      'a DOCTYPE after the root element (§2.8)',
      (w) => (w.writeStartElement('a'), w.writeEndElement(), w.writeDTD('<!DOCTYPE a>')),
      'WRITE_STATE',
      'WF_DOCTYPE_MISPLACED',
    ],
    [
      'a second DOCTYPE',
      (w) => (w.writeDTD('<!DOCTYPE a>'), w.writeDTD('<!DOCTYPE a>'), w.writeEmptyElement('a')),
      'WRITE_STATE',
      'WF_DOCTYPE_MISPLACED',
    ],
    [
      'an XML declaration after a comment',
      (w) => (w.writeComment('c'), w.writeStartDocument(), w.writeEmptyElement('a')),
      'WRITE_STATE',
      'WF_XML_DECLARATION_MISPLACED',
    ],
    [
      'an XML declaration after whitespace (§2.8)',
      (w) => (w.writeCharacters(' '), w.writeStartDocument(), w.writeEmptyElement('a')),
      'WRITE_STATE',
      'WF_XML_DECLARATION_MISPLACED',
    ],
    [
      'a reference to an entity with no DOCTYPE (WFC: Entity Declared)',
      inside((w) => w.writeEntityRef('e')),
      'WRITE_STATE',
      'WF_UNDECLARED_ENTITY',
    ],
    [
      'an entity name with a colon (Namespaces §7)',
      (w) => (
        w.writeDTD('<!DOCTYPE r [<!ENTITY a:b "x">]>'),
        w.writeStartElement('r'),
        w.writeEntityRef('a:b'),
        w.writeEndDocument()
      ),
      'WRITE_NAME',
      'NS_COLON',
    ],
    [
      'the xmlns prefix on an element (Namespaces §3)',
      (w) => w.writeEmptyElement('xmlns', 'a', XMLNS),
      'WRITE_NAME',
      'NS_RESERVED',
    ],
    [
      'an element in the XML namespace without its prefix',
      (w) => (w.writeEmptyElement('', 'a', XML), w.writeDefaultNamespace(XML)),
      'WRITE_NAME',
      'NS_RESERVED',
    ],
    [
      'another prefix on an attribute in the XML namespace',
      inside((w) => w.writeAttribute('p', XML, 'a', '1')),
      'WRITE_NAME',
      'NS_UNBOUND_PREFIX',
    ],
    [
      'the XML namespace bound to a prefix through writeAttribute',
      inside((w) => w.writeAttribute(XMLNS, 'p', XML)),
      'WRITE_NAME',
      'NS_RESERVED',
    ],
    [
      'a document with no root element',
      (w) => (w.writeComment('c'), w.writeEndDocument()),
      'WRITE_STATE',
      'WF_EMPTY_DOCUMENT',
    ],
    [
      'an attribute written twice (WFC: Unique Att Spec)',
      inside((w) => (w.writeAttribute('a', '1'), w.writeAttribute('a', '2'))),
      'WRITE_DUPLICATE_ATTRIBUTE',
      'WF_DUPLICATE_ATTRIBUTE',
    ],
    [
      'two attributes of one expanded name (NSC: Attributes Unique)',
      inside((w) => {
        w.writeNamespace('p', 'u');
        w.writeNamespace('q', 'u');
        w.writeAttribute('p', 'u', 'a', '1');
        w.writeAttribute('q', 'u', 'a', '2');
      }),
      'WRITE_DUPLICATE_ATTRIBUTE',
      'NS_DUPLICATE_ATTRIBUTE',
    ],
    [
      'an element prefix never declared (NSC: Prefix Declared)',
      (w) => (w.writeStartElement('p', 'a', 'urn:p'), w.writeEndDocument()),
      'WRITE_UNBOUND_PREFIX',
      'NS_UNBOUND_PREFIX',
    ],
    [
      'an attribute prefix never declared',
      inside((w) => w.writeAttribute('p', 'urn:p', 'a', '1')),
      'WRITE_UNBOUND_PREFIX',
      'NS_UNBOUND_PREFIX',
    ],
    [
      'the xml prefix bound to another URI (Namespaces §3)',
      inside((w) => w.writeNamespace('xml', 'urn:x')),
      'WRITE_NAME',
      'NS_RESERVED',
    ],
    [
      'the XML namespace bound to another prefix',
      inside((w) => w.writeNamespace('p', XML)),
      'WRITE_NAME',
      'NS_RESERVED',
    ],
    ['the xmlns namespace as the default', inside((w) => w.writeDefaultNamespace(XMLNS)), 'WRITE_NAME', 'NS_RESERVED'],
    [
      'a prefix undeclared in XML 1.0 (Namespaces 1.0 §2.2)',
      inside((w) => w.writeNamespace('p', '')),
      'WRITE_NAME',
      'NS_UNDECLARED_PREFIX',
    ],
  ])('refuses %s', (_title, write, writerCode, reader) => {
    expect(codeOf(write)).toBe(writerCode);
    expect(readerCode(written(write, { checkWellFormedness: false }))).toBe(reader);
  });

  it('refuses ?> in PI data, which would end the PI early and change the document', () => {
    const write = inside((w) => w.writeProcessingInstruction('p', 'a?>b'));
    expect(codeOf(write)).toBe('WRITE_PI');
    expect(canonical(written(write, { checkWellFormedness: false }))).toBe('<r><?p a?>b?&gt;</r>');
  });

  it('refuses ]]> in a CDATA section when checking, and splits it when not, so the text survives', () => {
    const write = inside((w) => w.writeCData('x]]>y'));
    expect(codeOf(write)).toBe('WRITE_CDATA');
    expect(canonical(written(write, { checkWellFormedness: false }))).toBe('<r>x]]&gt;y</r>');
  });

  it('refuses markup the output encoding cannot hold, whether checking or not', () => {
    for (const checkWellFormedness of [true, false]) {
      expect(codeOf((w) => w.writeEmptyElement('é'), { encoding: 'US-ASCII', checkWellFormedness })).toBe(
        'WRITE_ENCODING'
      );
      expect(
        codeOf(
          inside((w) => w.writeComment('€')),
          { encoding: 'ISO-8859-1', checkWellFormedness }
        )
      ).toBe('WRITE_ENCODING');
    }
  });

  it('refuses one prefix declared for two URIs on one element, whether checking or not', () => {
    for (const checkWellFormedness of [true, false]) {
      expect(
        codeOf(
          inside((w) => (w.writeNamespace('p', 'u1'), w.writeNamespace('p', 'u2'))),
          { checkWellFormedness }
        )
      ).toBe('WRITE_DUPLICATE_ATTRIBUTE');
    }
  });

  it('leaves the document well-formed up to a refused write, and writing can go on', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeCharacters('kept');
      expect(() => w.writeComment('a--b')).toThrow(expect.objectContaining({ code: 'WRITE_COMMENT' }));
      w.writeEndDocument();
    });
    expect(out).toBe('<r>kept</r>');
    expect(canonical(out)).toBe('<r>kept</r>');
  });
});
