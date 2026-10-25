import { codeOf, inRoot, written } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import { type StreamWriter, StringSink, XMLOutputFactory } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** A table row: what the write does wrong, the writes, and the code it throws. */
type Refusal = [string, (w: StreamWriter) => void, string];

describe('StreamWriter checks: names (§2.3, Namespaces §3)', () => {
  it.each<Refusal>([
    ['an element name starting with a digit', (w) => w.writeStartElement('1a'), 'WRITE_NAME'],
    ['a qualified name given as a local name', (w) => w.writeStartElement('a:b'), 'WRITE_NAME'],
    ['a local name with a space', (w) => w.writeStartElement('bad name'), 'WRITE_NAME'],
    ['an empty element name', (w) => w.writeStartElement(''), 'WRITE_NAME'],
    ['an element prefix that is not a name', (w) => w.writeStartElement('1p', 'a', 'urn:p'), 'WRITE_NAME'],
    ['an empty element name by writeEmptyElement', (w) => w.writeEmptyElement(''), 'WRITE_NAME'],
    ['an attribute name starting with a digit', inRoot((w) => w.writeAttribute('1a', 'v')), 'WRITE_NAME'],
    ['an attribute name with a colon', inRoot((w) => w.writeAttribute('a:b', 'v')), 'WRITE_NAME'],
    ['an attribute prefix that is not a name', inRoot((w) => w.writeAttribute('1p', 'urn:p', 'a', 'v')), 'WRITE_NAME'],
    ['a namespace prefix that is not a name', inRoot((w) => w.writeNamespace('1p', 'urn:p')), 'WRITE_NAME'],
    ['a namespace prefix with a colon', inRoot((w) => w.writeNamespace('a:b', 'urn:p')), 'WRITE_NAME'],
    ['an entity name with a space', inRoot((w) => w.writeEntityRef('a b')), 'WRITE_NAME'],
    ['an entity name starting with a digit', inRoot((w) => w.writeEntityRef('1')), 'WRITE_NAME'],
    ['the xml prefix bound to another URI', inRoot((w) => w.writeNamespace('xml', 'urn:x')), 'WRITE_NAME'],
    ['the XML namespace bound to another prefix', inRoot((w) => w.writeNamespace('p', XML)), 'WRITE_NAME'],
    ['the xmlns namespace bound to a prefix', inRoot((w) => w.writeNamespace('p', XMLNS)), 'WRITE_NAME'],
    ['the XML namespace as the default', inRoot((w) => w.writeDefaultNamespace(XML)), 'WRITE_NAME'],
    ['the xmlns namespace as the default', inRoot((w) => w.writeDefaultNamespace(XMLNS)), 'WRITE_NAME'],
    ['a prefix undeclared in XML 1.0 (Namespaces 1.0 §2.2)', inRoot((w) => w.writeNamespace('p', '')), 'WRITE_NAME'],
    ['an entity name with a colon (Namespaces §7)', inRoot((w) => w.writeEntityRef('a:b')), 'WRITE_NAME'],
    [
      'the xml prefix on an attribute in another namespace',
      inRoot((w) => w.writeAttribute('xml', 'urn:wrong', 'lang', 'en')),
      'WRITE_NAME',
    ],
    [
      'another prefix on an attribute in the XML namespace',
      inRoot((w) => w.writeAttribute('p', XML, 'a', 'v')),
      'WRITE_NAME',
    ],
    [
      'the xml prefix on an element in another namespace',
      (w) => w.writeStartElement('xml', 'a', 'urn:x'),
      'WRITE_NAME',
    ],
    ['an element in the XML namespace without the xml prefix', (w) => w.writeStartElement('', 'a', XML), 'WRITE_NAME'],
    ['the xmlns prefix on an element', (w) => w.writeStartElement('xmlns', 'a', XMLNS), 'WRITE_NAME'],
    ['an element in the xmlns namespace by URI', (w) => w.writeStartElement(XMLNS, 'a'), 'WRITE_NAME'],
    [
      'an element in the xmlns namespace with another prefix',
      (w) => w.writeStartElement('p', 'a', XMLNS),
      'WRITE_NAME',
    ],
  ])('refuses %s', (_title, write, code) => {
    expect(codeOf(write)).toBe(code);
  });

  it('refuses the xml prefix in another namespace in repairing mode too, rather than declare it', () => {
    expect(
      codeOf(
        inRoot((w) => w.writeAttribute('xml', 'urn:wrong', 'lang', 'en')),
        { repairNamespaces: true }
      )
    ).toBe('WRITE_NAME');
  });

  it('writes an element in the XML namespace with the xml prefix, which Namespaces §3 allows', () => {
    expect(written((w) => (w.writeStartElement(XML, 'a'), w.writeEndElement()))).toBe('<xml:a/>');
  });

  it('lets XML 1.1 undeclare a prefix (Namespaces 1.1 §5)', () => {
    expect(
      written((w) => (w.writeStartDocument('1.1'), w.writeStartElement('a'), w.writeNamespace('p', '')), {
        omitXMLDeclaration: true,
      })
    ).toBe('<a xmlns:p="">');
  });

  it('lets the xml prefix be declared to its own namespace', () => {
    expect(written(inRoot((w) => w.writeNamespace('xml', XML)))).toBe(`<r xmlns:xml="${XML}">`);
  });

  it('still checks names once it has stopped remembering new ones', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      for (let i = 0; i < 10_001; i++) w.writeEmptyElement(`name${i}`);
      expect(() => w.writeEmptyElement('1bad')).toThrow(expect.objectContaining({ code: 'WRITE_NAME' }));
      w.writeEmptyElement('name10000');
      w.writeEndDocument();
    });
    expect(out.endsWith('<name10000/><name10000/></r>')).toBe(true);
  });

  it('remembers names found to be good, for later checks', () => {
    expect(
      written(
        (w) => (w.writeStartElement('n'), w.writeEmptyElement('n'), w.writeAttribute('n', '1'), w.writeEndElement())
      )
    ).toBe('<n><n n="1"/></n>');
  });
});

describe('StreamWriter checks: characters (§2.2)', () => {
  it.each<Refusal>([
    ['U+0000 in text', inRoot((w) => w.writeCharacters('a\u0000')), 'WRITE_CHARACTER'],
    ['U+0001 in an attribute value', inRoot((w) => w.writeAttribute('a', '\u0001')), 'WRITE_CHARACTER'],
    ['a lone surrogate in text', inRoot((w) => w.writeCharacters('\uD800')), 'WRITE_CHARACTER'],
    ['U+FFFF in a namespace URI', inRoot((w) => w.writeNamespace('p', '\uFFFF')), 'WRITE_CHARACTER'],
    ['U+0001 in a comment', (w) => w.writeComment('\u0001'), 'WRITE_CHARACTER'],
    ['U+0001 in a PI', (w) => w.writeProcessingInstruction('p', '\u0001'), 'WRITE_CHARACTER'],
    ['U+0001 in a CDATA section', inRoot((w) => w.writeCData('\u0001')), 'WRITE_CHARACTER'],
    [
      'U+FFFE in a CDATA section that is not checked otherwise',
      inRoot((w) => w.writeCData('\uFFFE')),
      'WRITE_CHARACTER',
    ],
    [
      'a restricted character in an XML 1.1 CDATA section, which cannot hold a reference',
      (w) => (w.writeStartDocument('1.1'), w.writeStartElement('a'), w.writeCData('\u0001')),
      'WRITE_CHARACTER',
    ],
    [
      'a restricted character in an XML 1.1 comment',
      (w) => (w.writeStartDocument('1.1'), w.writeComment('\u007F')),
      'WRITE_CHARACTER',
    ],
  ])('refuses %s', (_title, write, code) => {
    expect(codeOf(write)).toBe(code);
  });
});

describe('StreamWriter checks: comments, PIs and CDATA (§2.5–§2.7)', () => {
  it.each<Refusal>([
    ['-- in a comment', (w) => w.writeComment('a--b'), 'WRITE_COMMENT'],
    ['a comment ending with -', (w) => w.writeComment('a-'), 'WRITE_COMMENT'],
    ['a comment of one -', (w) => w.writeComment('-'), 'WRITE_COMMENT'],
    ['the PI target xml', (w) => w.writeProcessingInstruction('xml', 'x'), 'WRITE_PI'],
    ['the PI target xml in any case', (w) => w.writeProcessingInstruction('XmL'), 'WRITE_PI'],
    ['a PI target with a colon (Namespaces §7)', (w) => w.writeProcessingInstruction('a:b'), 'WRITE_PI'],
    ['a PI target starting with a digit', (w) => w.writeProcessingInstruction('1a'), 'WRITE_PI'],
    ['an empty PI target', (w) => w.writeProcessingInstruction(''), 'WRITE_PI'],
    ['?> in PI data', (w) => w.writeProcessingInstruction('p', 'a?>b'), 'WRITE_PI'],
    [']]> in a CDATA section', inRoot((w) => w.writeCData('x]]>y')), 'WRITE_CDATA'],
  ])('refuses %s', (_title, write, code) => {
    expect(codeOf(write)).toBe(code);
  });
});

describe('StreamWriter checks: document structure (§2.1, §2.8)', () => {
  it.each<Refusal>([
    ['an XML declaration after an element', (w) => (w.writeEmptyElement('a'), w.writeStartDocument()), 'WRITE_STATE'],
    ['an XML declaration after a comment', (w) => (w.writeComment('c'), w.writeStartDocument()), 'WRITE_STATE'],
    [
      'an XML declaration after a PI',
      (w) => (w.writeProcessingInstruction('p'), w.writeStartDocument()),
      'WRITE_STATE',
    ],
    [
      'an XML declaration after the DOCTYPE',
      (w) => (w.writeDTD('<!DOCTYPE a>'), w.writeStartDocument()),
      'WRITE_STATE',
    ],
    ['a second XML declaration', (w) => (w.writeStartDocument(), w.writeStartDocument()), 'WRITE_STATE'],
    ['an XML declaration after whitespace', (w) => (w.writeCharacters(' '), w.writeStartDocument()), 'WRITE_STATE'],
    [
      'a second root element',
      (w) => (w.writeStartElement('a'), w.writeEndElement(), w.writeStartElement('b')),
      'WRITE_STATE',
    ],
    [
      'a second root element after an empty one',
      (w) => (w.writeEmptyElement('a'), w.writeEmptyElement('b')),
      'WRITE_STATE',
    ],
    ['text before the root element', (w) => w.writeCharacters('text'), 'WRITE_STATE'],
    ['text after the root element', (w) => (w.writeEmptyElement('a'), w.writeCharacters(' x')), 'WRITE_STATE'],
    ['a reference to whitespace outside the root, which is text', (w) => w.writeEntityRef('nbsp'), 'WRITE_STATE'],
    [
      'a reference to an entity with no DOCTYPE to declare it (WFC: Entity Declared)',
      inRoot((w) => w.writeEntityRef('e')),
      'WRITE_STATE',
    ],
    ['a CDATA section before the root element', (w) => w.writeCData('x'), 'WRITE_STATE'],
    ['a DOCTYPE after the root element', (w) => (w.writeEmptyElement('a'), w.writeDTD('<!DOCTYPE a>')), 'WRITE_STATE'],
    ['a second DOCTYPE', (w) => (w.writeDTD('<!DOCTYPE a>'), w.writeDTD('<!DOCTYPE a>')), 'WRITE_STATE'],
    ['an attribute with no start tag', (w) => w.writeAttribute('x', '1'), 'WRITE_STATE'],
    ['an attribute after content', inRoot((w) => (w.writeCharacters('t'), w.writeAttribute('x', '1'))), 'WRITE_STATE'],
    [
      'an attribute after a child',
      inRoot((w) => (w.writeEmptyElement('c'), w.writeComment('c'), w.writeAttribute('x', '1'))),
      'WRITE_STATE',
    ],
    ['a namespace declaration with no start tag', (w) => w.writeNamespace('p', 'urn:p'), 'WRITE_STATE'],
    [
      'a default namespace declaration after content',
      inRoot((w) => (w.writeCharacters('t'), w.writeDefaultNamespace('urn:d'))),
      'WRITE_STATE',
    ],
    ['an end tag with no element open', (w) => w.writeEndElement(), 'WRITE_STATE'],
    [
      'one end tag too many',
      (w) => (w.writeStartElement('a'), w.writeEndElement(), w.writeEndElement()),
      'WRITE_STATE',
    ],
    [
      'a document with no root element',
      (w) => (w.writeStartDocument(), w.writeComment('c'), w.writeEndDocument()),
      'WRITE_STATE',
    ],
  ])('refuses %s', (_title, write, code) => {
    expect(codeOf(write)).toBe(code);
  });
});

describe('StreamWriter checks: attributes and prefixes (§3.1, Namespaces §5)', () => {
  it.each<Refusal>([
    [
      'an attribute written twice (WFC: Unique Att Spec)',
      inRoot((w) => (w.writeAttribute('x', '1'), w.writeAttribute('x', '2'))),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
    [
      'an attribute written twice among many',
      inRoot((w) => {
        for (let i = 0; i < 20; i++) w.writeAttribute(`a${i}`, '1');
        w.writeAttribute('a19', '2');
      }),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
    [
      'two prefixes for one URI on one local name (NSC: Attributes Unique)',
      inRoot((w) => {
        w.writeNamespace('p', 'u');
        w.writeNamespace('q', 'u');
        w.writeAttribute('p', 'u', 'id', '1');
        w.writeAttribute('q', 'u', 'id', '2');
      }),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
    [
      'one prefix declared for two URIs on one element',
      inRoot((w) => (w.writeNamespace('p', 'u1'), w.writeNamespace('p', 'u2'))),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
    [
      'the default namespace declared twice differently',
      inRoot((w) => (w.writeDefaultNamespace('u1'), w.writeDefaultNamespace('u2'))),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
    [
      'an element prefix that is never declared (NSC: Prefix Declared)',
      (w) => (w.writeStartElement('p', 'a', 'urn:p'), w.writeEndElement()),
      'WRITE_UNBOUND_PREFIX',
    ],
    ['an element in a namespace that has no prefix', (w) => w.writeStartElement('urn:p', 'a'), 'WRITE_UNBOUND_PREFIX'],
    [
      'an element given a namespace the default does not have',
      (w) => (w.writeStartElement('', 'a', 'urn:x'), w.writeEndElement()),
      'WRITE_UNBOUND_PREFIX',
    ],
    [
      'a default namespace declared on an element written in no namespace',
      (w) => (w.writeStartElement('', 'r', ''), w.writeDefaultNamespace('urn:d'), w.writeEndElement()),
      'WRITE_UNBOUND_PREFIX',
    ],
    [
      'an attribute prefix that is never declared',
      inRoot((w) => (w.writeAttribute('p', 'urn:p', 'x', '1'), w.writeEndElement())),
      'WRITE_UNBOUND_PREFIX',
    ],
    [
      'an attribute in a namespace that has no prefix',
      inRoot((w) => w.writeAttribute('urn:p', 'x', '1')),
      'WRITE_UNBOUND_PREFIX',
    ],
    [
      'an attribute in the default namespace only, which unprefixed attributes cannot take',
      inRoot((w) => (w.writeDefaultNamespace('urn:d'), w.writeAttribute('urn:d', 'x', '1'))),
      'WRITE_UNBOUND_PREFIX',
    ],
    [
      'a prefix bound with setPrefix but never declared',
      (w) => (w.setPrefix('p', 'urn:p'), w.writeStartElement('urn:p', 'a'), w.writeEndElement()),
      'WRITE_UNBOUND_PREFIX',
    ],
    [
      'an element prefix declared for another URI',
      (w) => (w.writeStartElement('p', 'a', 'urn:p'), w.writeNamespace('p', 'urn:other'), w.writeEndElement()),
      'WRITE_UNBOUND_PREFIX',
    ],
  ])('refuses %s', (_title, write, code) => {
    expect(codeOf(write)).toBe(code);
  });

  it('accepts the same declaration twice on one element, writing it once', () => {
    expect(written(inRoot((w) => (w.writeNamespace('p', 'u'), w.writeNamespace('p', 'u'))))).toBe('<r xmlns:p="u">');
  });

  it('accepts an attribute name again on another element', () => {
    expect(
      written(inRoot((w) => (w.writeAttribute('x', '1'), w.writeEmptyElement('c'), w.writeAttribute('x', '2'))))
    ).toBe('<r x="1"><c x="2"/>');
  });

  it('accepts one local name in two namespaces on one element', () => {
    const out = written(
      inRoot((w) => {
        w.writeNamespace('p', 'u1');
        w.writeNamespace('q', 'u2');
        w.writeAttribute('id', '0');
        w.writeAttribute('p', 'u1', 'id', '1');
        w.writeAttribute('q', 'u2', 'id', '2');
      })
    );
    expect(out).toBe('<r xmlns:p="u1" xmlns:q="u2" id="0" p:id="1" q:id="2">');
  });
});

describe('StreamWriter after a failed end tag', () => {
  it('keeps the element open when closing its start tag fails, so its stacks stay in step', () => {
    const w = new XMLOutputFactory().createStreamWriter(new StringSink());
    w.writeStartElement('p', 'a', 'urn:p');
    expect(() => w.writeEndElement()).toThrow('The prefix p is not bound to urn:p');
    expect(() => w.writeEndElement()).not.toThrow();
    expect(() => w.writeEndElement()).toThrow('No element is open');
  });
});

describe('StreamWriter with the checks off', () => {
  const off = { checkWellFormedness: false };

  it.each<[string, (w: StreamWriter) => void, string]>([
    ['a bad element name', (w) => w.writeEmptyElement('1a'), '<1a/>'],
    [
      'a bad attribute name, written twice',
      inRoot((w) => (w.writeAttribute('1a', 'v'), w.writeAttribute('1a', 'v'))),
      '<r 1a="v" 1a="v">',
    ],
    ['a comment with --', (w) => w.writeComment('a--b-'), '<!--a--b--->'],
    ['a PI target xml with ?> in its data', (w) => w.writeProcessingInstruction('xml', 'a?>'), '<?xml a?>?>'],
    [
      'CDATA holding ]]>, split into two sections',
      inRoot((w) => w.writeCData('x]]>y')),
      '<r><![CDATA[x]]]]><![CDATA[>y]]>',
    ],
    ['CDATA outside the root', (w) => w.writeCData('x'), '<![CDATA[x]]>'],
    ['text outside the root', (w) => w.writeCharacters('text'), 'text'],
    ['text outside the root, escaped as it is in content', (w) => w.writeCharacters('a&b<c\r'), 'a&amp;b&lt;c&#13;'],
    ['an entity name with a colon and no DOCTYPE', inRoot((w) => w.writeEntityRef('a:b')), '<r>&a:b;'],
    [
      'a DOCTYPE after an empty element, closing its tag first',
      (w) => (w.writeEmptyElement('a'), w.writeDTD('<!DOCTYPE a>')),
      '<a/><!DOCTYPE a>',
    ],
    [
      'a DOCTYPE inside an element, closing its start tag first',
      (w) => (w.writeStartElement('a'), w.writeDTD('<!DOCTYPE a>')),
      '<a><!DOCTYPE a>',
    ],
    [
      'an XML declaration after an empty element, closing its tag first',
      (w) => (w.writeEmptyElement('a'), w.writeStartDocument()),
      '<a/><?xml version="1.0" encoding="UTF-8"?>',
    ],
    ['an entity reference outside the root, by a bad name', (w) => w.writeEntityRef('a b'), '&a b;'],
    ['two roots', (w) => (w.writeEmptyElement('a'), w.writeEmptyElement('b')), '<a/><b/>'],
    [
      'a DOCTYPE after the root',
      (w) => (w.writeStartElement('a'), w.writeEndElement(), w.writeDTD('<!DOCTYPE a>')),
      '<a/><!DOCTYPE a>',
    ],
    ['an unbound prefix', (w) => (w.writeStartElement('p', 'a', 'urn:p'), w.writeEndElement()), '<p:a/>'],
    [
      'an attribute with the xmlns prefix in another namespace',
      inRoot((w) => w.writeAttribute('xmlns', 'urn:x', 'p', 'u')),
      '<r xmlns:p="u">',
    ],
    [
      'an attribute in the xmlns namespace with another prefix',
      inRoot((w) => w.writeAttribute('q', XMLNS, 'p', 'u')),
      '<r q:p="u">',
    ],
    [
      'a bad namespace prefix and reserved URIs',
      inRoot((w) => (w.writeNamespace('1p', XML), w.writeDefaultNamespace(XMLNS))),
      `<r xmlns:1p="${XML}" xmlns="${XMLNS}">`,
    ],
    ['a character XML does not allow', inRoot((w) => w.writeCharacters('\u0001')), '<r>\u0001'],
    ['a document with no root', (w) => w.writeEndDocument(), ''],
    [
      'a second XML declaration',
      (w) => (w.writeStartDocument(), w.writeStartDocument()),
      '<?xml version="1.0" encoding="UTF-8"?><?xml version="1.0" encoding="UTF-8"?>',
    ],
  ])('writes %s as given', (_title, write, output) => {
    expect(written(write, off)).toBe(output);
  });

  it('still refuses an end tag with no element open, which it could not write', () => {
    expect(codeOf((w) => w.writeEndElement(), off)).toBe('WRITE_STATE');
  });

  it('still refuses an attribute with no start tag to go in', () => {
    expect(codeOf((w) => (w.writeEmptyElement('a'), w.writeCharacters(''), w.writeAttribute('x', '1')), off)).toBe(
      'WRITE_STATE'
    );
  });

  it('still refuses a prefix in repairing mode that the element already binds to another URI', () => {
    expect(
      codeOf(
        inRoot((w) => (w.writeNamespace('p', 'urn:1'), w.writeAttribute('p', 'urn:2', 'x', '1'))),
        { ...off, repairNamespaces: true }
      )
    ).toBe('WRITE_UNBOUND_PREFIX');
  });
});
