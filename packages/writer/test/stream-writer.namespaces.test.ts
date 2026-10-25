import { names } from '@test/helpers/canonical.ts';
import { codeOf, written } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import { type StreamWriter, StringSink, XMLOutputFactory } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const repairing = { repairNamespaces: true };

/** A fresh writer to a string, for checking what it reports between writes. */
function writer(options = {}): StreamWriter {
  return new XMLOutputFactory(options).createStreamWriter(new StringSink());
}

describe('StreamWriter namespaces, as the caller declares them', () => {
  it('finds the prefix declared on an ancestor for an element or attribute given by URI', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeNamespace('p', 'urn:p');
      w.writeStartElement('urn:p', 'c');
      w.writeAttribute('urn:p', 'x', '1');
      w.writeAttribute('', 'urn:p', 'y', '2');
      w.writeEndDocument();
    });
    expect(out).toBe('<r xmlns:p="urn:p"><p:c p:x="1" p:y="2"/></r>');
  });

  it('declares a prefix on the element that uses it, before or after its attributes', () => {
    expect(
      written(
        (w) => (
          w.writeStartElement('p', 'a', 'urn:p'),
          w.writeAttribute('x', '1'),
          w.writeNamespace('p', 'urn:p'),
          w.writeEndElement()
        )
      )
    ).toBe('<p:a x="1" xmlns:p="urn:p"/>');
  });

  it('ends a binding with the element that declares it', () => {
    const w = writer();
    w.writeStartElement('r');
    w.writeStartElement('a');
    w.writeNamespace('p', 'urn:p');
    expect(w.getNamespaceURI('p')).toBe('urn:p');
    w.writeEndElement();
    expect(w.getNamespaceURI('p')).toBeUndefined();
    expect(w.getPrefix('urn:p')).toBeUndefined();
    expect(() => w.writeStartElement('urn:p', 'b')).toThrow(expect.objectContaining({ code: 'WRITE_UNBOUND_PREFIX' }));
  });

  it('restores a shadowed binding when the inner element ends', () => {
    const out = written((w) => {
      w.writeStartElement('p', 'a', 'urn:1');
      w.writeNamespace('p', 'urn:1');
      w.writeStartElement('p', 'b', 'urn:2');
      w.writeNamespace('p', 'urn:2');
      w.writeEndElement();
      w.writeStartElement('urn:1', 'c');
      w.writeEndDocument();
    });
    expect(out).toBe('<p:a xmlns:p="urn:1"><p:b xmlns:p="urn:2"/><p:c/></p:a>');
  });

  it('writes an element given by the default namespace URI without a prefix', () => {
    expect(
      written(
        (w) => (
          w.writeStartElement('', 'a', 'urn:d'),
          w.writeDefaultNamespace('urn:d'),
          w.writeStartElement('urn:d', 'b'),
          w.writeEndDocument()
        )
      )
    ).toBe('<a xmlns="urn:d"><b/></a>');
  });

  it('keeps an element given by local name in the default namespace in scope', () => {
    const out = written((w) => {
      w.writeStartElement('', 'a', 'urn:d');
      w.writeNamespace('', 'urn:d');
      w.writeStartElement('b');
      w.writeEndDocument();
    });
    expect(out).toBe('<a xmlns="urn:d"><b/></a>');
    expect(names(out)).toEqual(['{urn:d}a', '{urn:d}b', '/{urn:d}b', '/{urn:d}a']);
  });

  it("takes the prefix xmlns as the default namespace in writeNamespace, as StAX's does", () => {
    expect(
      written((w) => (w.writeStartElement('', 'a', 'urn:d'), w.writeNamespace('xmlns', 'urn:d'), w.writeEndElement()))
    ).toBe('<a xmlns="urn:d"/>');
  });

  it('undeclares the default namespace for a child in no namespace', () => {
    const out = written((w) => {
      w.writeStartElement('', 'a', 'urn:d');
      w.writeDefaultNamespace('urn:d');
      w.writeStartElement('', 'b', '');
      w.writeDefaultNamespace('');
      w.writeEndDocument();
    });
    expect(out).toBe('<a xmlns="urn:d"><b xmlns=""/></a>');
  });

  it('knows the xml and xmlns prefixes from the start (Namespaces §3)', () => {
    const w = writer();
    expect(w.getNamespaceURI('xml')).toBe(XML);
    expect(w.getNamespaceURI('xmlns')).toBe(XMLNS);
    expect(w.getPrefix(XML)).toBe('xml');
    expect(w.getPrefix(XMLNS)).toBe('xmlns');
    expect(w.getNamespaceURI('')).toBeUndefined();
    expect(w.getPrefix('urn:none')).toBeUndefined();
  });

  it('binds a prefix for lookups with setPrefix, without declaring it, as StAX does', () => {
    const out = written((w) => {
      w.setPrefix('p', 'urn:p');
      expect(w.getPrefix('urn:p')).toBe('p');
      expect(w.getNamespaceURI('p')).toBe('urn:p');
      w.writeStartElement('urn:p', 'a');
      w.writeNamespace('p', 'urn:p');
      w.writeEndElement();
    });
    expect(out).toBe('<p:a xmlns:p="urn:p"/>');
  });

  it('binds the default namespace for lookups with setDefaultNamespace', () => {
    const out = written((w) => {
      w.setDefaultNamespace('urn:d');
      expect(w.getNamespaceURI('')).toBe('urn:d');
      w.writeStartElement('urn:d', 'a');
      w.writeDefaultNamespace('urn:d');
      w.writeEndElement();
    });
    expect(out).toBe('<a xmlns="urn:d"/>');
  });

  it('forgets a prefix set inside an element when the element ends', () => {
    const w = writer();
    w.writeStartElement('r');
    w.writeStartElement('a');
    w.setPrefix('p', 'urn:p');
    w.writeEndElement();
    expect(w.getNamespaceURI('p')).toBeUndefined();
  });

  it('gives no prefix for a URI whose prefix an inner element has rebound', () => {
    const w = writer();
    w.writeStartElement('r');
    w.writeNamespace('p', 'urn:1');
    w.writeStartElement('c');
    w.writeNamespace('p', 'urn:2');
    expect(w.getPrefix('urn:1')).toBeUndefined();
    expect(w.getPrefix('urn:2')).toBe('p');
  });

  it('gives the innermost of several prefixes for one URI', () => {
    const w = writer();
    w.writeStartElement('r');
    w.writeNamespace('p', 'urn:x');
    w.writeNamespace('q', 'urn:x');
    expect(w.getPrefix('urn:x')).toBe('q');
  });

  it('writes the xml prefix for the XML namespace without declaring it', () => {
    expect(written((w) => (w.writeStartElement('r'), w.writeAttribute(XML, 'lang', 'en'), w.writeEndElement()))).toBe(
      '<r xml:lang="en"/>'
    );
  });

  it('puts an element written by local name in the default namespace its own declarations give, as the JDK does', () => {
    const ATOM = 'http://www.w3.org/2005/Atom';
    const out = written((w) => {
      w.writeStartElement('feed');
      w.writeDefaultNamespace(ATOM);
      w.writeEmptyElement('entry');
      w.writeDefaultNamespace('urn:e');
      w.writeEndDocument();
    });
    expect(out).toBe(`<feed xmlns="${ATOM}"><entry xmlns="urn:e"/></feed>`);
    expect(names(out)).toEqual([`{${ATOM}}feed`, '{urn:e}entry', '/{urn:e}entry', `/{${ATOM}}feed`]);
  });

  it('refuses an attribute by URI whose only binding is the default namespace', () => {
    expect(
      codeOf(
        (w) => (
          w.writeStartElement('', 'r', 'urn:d'),
          w.writeDefaultNamespace('urn:d'),
          w.writeAttribute('urn:d', 'x', '1')
        )
      )
    ).toBe('WRITE_UNBOUND_PREFIX');
  });
});

describe('StreamWriter namespaces in repairing mode (IS_REPAIRING_NAMESPACES)', () => {
  it('declares what it needs', () => {
    const out = written((w) => {
      w.writeStartElement('urn:a', 'root');
      w.writeAttribute('urn:b', 'x', '1');
      w.writeStartElement('p', 'child', 'urn:c');
      w.writeStartElement('', 'plain', '');
      w.writeEndDocument();
    }, repairing);
    expect(out).toBe(
      '<root xmlns="urn:a" xmlns:ns1="urn:b" ns1:x="1"><p:child xmlns:p="urn:c"><plain xmlns=""/></p:child></root>'
    );
    expect(names(out)).toEqual([
      '{urn:a}root',
      '@{urn:b}x=1',
      '{urn:c}child',
      'plain',
      '/plain',
      '/{urn:c}child',
      '/{urn:a}root',
    ]);
  });

  it('declares nothing a binding in scope already gives', () => {
    const out = written((w) => {
      w.writeStartElement('p', 'a', 'urn:p');
      w.writeStartElement('p', 'b', 'urn:p');
      w.writeAttribute('p', 'urn:p', 'x', '1');
      w.writeStartElement('urn:p', 'c');
      w.writeEndDocument();
    }, repairing);
    expect(out).toBe('<p:a xmlns:p="urn:p"><p:b p:x="1"><p:c/></p:b></p:a>');
  });

  it('writes no xmlns="" for an element in no namespace when no default is in scope', () => {
    expect(written((w) => (w.writeStartElement('a'), w.writeStartElement('b'), w.writeEndDocument()), repairing)).toBe(
      '<a><b/></a>'
    );
  });

  it('declares an attribute prefix on the element whose attribute needs it', () => {
    expect(
      written(
        (w) => (w.writeStartElement('a'), w.writeAttribute('q', 'urn:q', 'x', '1'), w.writeEndElement()),
        repairing
      )
    ).toBe('<a xmlns:q="urn:q" q:x="1"/>');
  });

  it('generates prefixes for attributes given by URI, skipping ones in use', () => {
    const out = written((w) => {
      w.writeStartElement('a');
      w.writeNamespace('ns1', 'urn:taken');
      w.writeAttribute('urn:x', 'b', '1');
      w.writeAttribute('', 'urn:y', 'c', '2');
      w.writeAttribute('urn:x', 'd', '3');
      w.writeEndElement();
    }, repairing);
    expect(out).toBe('<a xmlns:ns1="urn:taken" xmlns:ns2="urn:x" ns2:b="1" xmlns:ns3="urn:y" ns3:c="2" ns2:d="3"/>');
  });

  it('gives an attribute in the default namespace a prefix, as unprefixed attributes have none', () => {
    expect(
      written(
        (w) => (w.writeStartElement('urn:x', 'a'), w.writeAttribute('urn:x', 'b', '1'), w.writeEndElement()),
        repairing
      )
    ).toBe('<a xmlns="urn:x" xmlns:ns1="urn:x" ns1:b="1"/>');
  });

  it('redeclares a prefix a child uses for another URI', () => {
    const out = written((w) => {
      w.writeStartElement('p', 'a', 'urn:1');
      w.writeStartElement('b');
      w.writeAttribute('p', 'urn:2', 'x', '1');
      w.writeEndDocument();
    }, repairing);
    expect(out).toBe('<p:a xmlns:p="urn:1"><b xmlns:p="urn:2" p:x="1"/></p:a>');
  });

  it('refuses a prefix the element already binds to another URI', () => {
    expect(
      codeOf((w) => (w.writeStartElement('p', 'a', 'urn:1'), w.writeAttribute('p', 'urn:2', 'x', '1')), repairing)
    ).toBe('WRITE_UNBOUND_PREFIX');
  });

  it('uses a prefix set with setPrefix, declaring it', () => {
    const out = written((w) => {
      w.setPrefix('p', 'urn:p');
      w.writeStartElement('urn:p', 'a');
      w.writeAttribute('urn:p', 'x', '1');
      w.writeEndDocument();
    }, repairing);
    expect(out).toBe('<p:a xmlns:p="urn:p" p:x="1"/>');
  });

  it('writes declarations the caller gives as well', () => {
    expect(
      written(
        (w) => (
          w.writeStartElement('a'),
          w.writeNamespace('p', 'urn:p'),
          w.writeEmptyElement('urn:p', 'b'),
          w.writeEndDocument()
        ),
        repairing
      )
    ).toBe('<a xmlns:p="urn:p"><p:b/></a>');
  });

  it('keeps counting generated prefixes across elements', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeEmptyElement('a');
      w.writeAttribute('urn:x', 'b', '1');
      w.writeEmptyElement('a');
      w.writeAttribute('urn:y', 'b', '1');
      w.writeEndDocument();
    }, repairing);
    expect(out).toBe('<r><a xmlns:ns1="urn:x" ns1:b="1"/><a xmlns:ns2="urn:y" ns2:b="1"/></r>');
  });

  it('leaves an element written by local name in the default namespace in scope, naming none itself', () => {
    const out = written((w) => {
      w.writeStartElement('urn:a', 'r');
      w.writeStartElement('c');
      w.writeStartElement('feed');
      w.writeDefaultNamespace('urn:atom');
      w.writeEndDocument();
    }, repairing);
    expect(out).toBe('<r xmlns="urn:a"><c><feed xmlns="urn:atom"/></c></r>');
    expect(names(out)).toEqual(['{urn:a}r', '{urn:a}c', '{urn:atom}feed', '/{urn:atom}feed', '/{urn:a}c', '/{urn:a}r']);
  });

  it('declares what an empty element needs', () => {
    expect(written((w) => w.writeEmptyElement('q', 'e', 'urn:q'), repairing)).toBe('<q:e xmlns:q="urn:q"/>');
  });
});

describe('StreamWriter namespace declarations written as attributes', () => {
  it.each<[string, (w: StreamWriter) => void]>([
    ['by local name', (w) => w.writeAttribute('xmlns', 'urn:d')],
    ['by the xmlns namespace and local name', (w) => w.writeAttribute(XMLNS, 'xmlns', 'urn:d')],
    ['by no prefix, no namespace and local name', (w) => w.writeAttribute('', '', 'xmlns', 'urn:d')],
    ['by no prefix, the xmlns namespace and local name', (w) => w.writeAttribute('', XMLNS, 'xmlns', 'urn:d')],
  ])('takes the default namespace declared %s as writeDefaultNamespace', (_title, writeDeclaration) => {
    const out = written((w) => {
      w.writeStartElement('', 'a', 'urn:d');
      writeDeclaration(w);
      w.writeStartElement('urn:d', 'b');
      w.writeEndDocument();
    });
    expect(out).toBe('<a xmlns="urn:d"><b/></a>');
  });

  it.each<[string, (w: StreamWriter) => void]>([
    ['by the xmlns namespace and the prefix as local name', (w) => w.writeAttribute(XMLNS, 'p', 'urn:p')],
    ['by the xmlns prefix and namespace', (w) => w.writeAttribute('xmlns', XMLNS, 'p', 'urn:p')],
    ['by the xmlns prefix alone', (w) => w.writeAttribute('xmlns', '', 'p', 'urn:p')],
    ['by no prefix and the xmlns namespace', (w) => w.writeAttribute('', XMLNS, 'p', 'urn:p')],
  ])('takes a prefix declared %s as writeNamespace', (_title, writeDeclaration) => {
    const out = written((w) => {
      w.writeStartElement('r');
      writeDeclaration(w);
      w.writeStartElement('urn:p', 'c');
      w.writeAttribute('urn:p', 'x', '1');
      w.writeEndDocument();
    });
    expect(out).toBe('<r xmlns:p="urn:p"><p:c p:x="1"/></r>');
  });

  it('writes a declaration once whether given as a declaration or an attribute', () => {
    expect(
      written(
        (w) => (
          w.writeStartElement('r'),
          w.writeNamespace('p', 'u'),
          w.writeAttribute(XMLNS, 'p', 'u'),
          w.writeEndElement()
        )
      )
    ).toBe('<r xmlns:p="u"/>');
  });

  it('refuses a declaration as an attribute that contradicts one on the element, checks on or off', () => {
    for (const checkWellFormedness of [true, false]) {
      expect(
        codeOf(
          (w) => (w.writeStartElement('r'), w.writeNamespace('p', 'u1'), w.writeAttribute('xmlns', XMLNS, 'p', 'u2')),
          { checkWellFormedness }
        )
      ).toBe('WRITE_DUPLICATE_ATTRIBUTE');
    }
  });

  it('checks a declaration written as an attribute as a declaration', () => {
    expect(codeOf((w) => (w.writeStartElement('r'), w.writeAttribute(XMLNS, 'p', XML)))).toBe('WRITE_NAME');
    expect(codeOf((w) => (w.writeStartElement('r'), w.writeAttribute(XMLNS, 'xml', 'urn:x')))).toBe('WRITE_NAME');
  });

  it.each<[string, (w: StreamWriter) => void]>([
    ['declaring the xmlns prefix', (w) => w.writeAttribute('xmlns', XMLNS, 'xmlns', 'urn:x')],
    ['with the xmlns prefix in another namespace', (w) => w.writeAttribute('xmlns', 'urn:x', 'p', 'u')],
    ['in the xmlns namespace with another prefix', (w) => w.writeAttribute('q', XMLNS, 'p', 'u')],
  ])('refuses an attribute %s (Namespaces §3)', (_title, write) => {
    expect(codeOf((w) => (w.writeStartElement('r'), write(w)))).toBe('WRITE_NAME');
  });

  it('writes an attribute named xmlns in another namespace as an ordinary attribute', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeNamespace('p', 'urn:p');
      w.writeAttribute('p', 'urn:p', 'xmlns', '1');
      w.writeEndElement();
    });
    expect(out).toBe('<r xmlns:p="urn:p" p:xmlns="1"/>');
  });

  it('lets repairing mode use a prefix declared as an attribute', () => {
    const out = written((w) => {
      w.writeStartElement('urn:a', 'r');
      w.writeAttribute('xmlns', 'urn:a');
      w.writeAttribute(XMLNS, 'p', 'urn:p');
      w.writeAttribute('urn:p', 'x', '1');
      w.writeEndElement();
    }, repairing);
    expect(out).toBe('<r xmlns="urn:a" xmlns:p="urn:p" p:x="1"/>');
  });
});

describe('StreamWriter that is not namespace-aware (namespaceAware: false)', () => {
  const unaware = { namespaceAware: false };

  it('writes names as given, colons and all, with no namespace bookkeeping', () => {
    const out = written((w) => {
      w.writeStartElement('p:a');
      w.writeAttribute('xmlns:p', 'u');
      w.writeAttribute('q:x', '1');
      w.writeAttribute(':y', '2');
      w.writeStartElement('q', 'b', 'urn:ignored');
      w.writeAttribute('r', 'urn:ignored', 'z', '3');
      w.writeEmptyElement('urn:ignored', 'c:d');
      w.writeNamespace('s', 'urn:s');
      w.writeDefaultNamespace('urn:d');
      w.writeEndDocument();
    }, unaware);
    expect(out).toBe('<p:a xmlns:p="u" q:x="1" :y="2"><q:b r:z="3"><c:d xmlns:s="urn:s" xmlns="urn:d"/></q:b></p:a>');
  });

  it('writes PI targets and entity names with colons', () => {
    const out = written((w) => {
      w.writeDTD('<!DOCTYPE r [<!ENTITY a:b "x">]>');
      w.writeStartElement('r');
      w.writeProcessingInstruction('a:b', 'd');
      w.writeEntityRef('a:b');
      w.writeEndDocument();
    }, unaware);
    expect(out).toBe('<!DOCTYPE r [<!ENTITY a:b "x">]><r><?a:b d?>&a:b;</r>');
  });

  it.each<[string, (w: StreamWriter) => void, string]>([
    ['an element name that is not a name', (w) => w.writeStartElement('1a'), 'WRITE_NAME'],
    [
      'an attribute name that is not a name',
      (w) => (w.writeStartElement('a'), w.writeAttribute('a b', '1')),
      'WRITE_NAME',
    ],
    ['a PI target that is not a name', (w) => w.writeProcessingInstruction('1p'), 'WRITE_PI'],
    [
      'an attribute written twice by its whole name',
      (w) => (w.writeStartElement('a'), w.writeAttribute('p', 'u1', 'x', '1'), w.writeAttribute('p:x', '2')),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
    [
      'a declaration written twice, being an attribute',
      (w) => (w.writeStartElement('a'), w.writeNamespace('p', 'u'), w.writeAttribute('xmlns:p', 'u')),
      'WRITE_DUPLICATE_ATTRIBUTE',
    ],
  ])('still refuses %s', (_title, write, code) => {
    expect(codeOf(write, unaware)).toBe(code);
  });

  it('writes an attribute name that is not a name, twice, as given with the checks off', () => {
    const out = written((w) => (w.writeStartElement('a'), w.writeAttribute('1:x', '1'), w.writeAttribute('1:x', '2')), {
      ...unaware,
      checkWellFormedness: false,
    });
    expect(out).toBe('<a 1:x="1" 1:x="2">');
  });

  it('declares nothing in repairing mode, as it keeps no namespaces', () => {
    expect(
      written((w) => (w.writeStartElement('p', 'a', 'urn:p'), w.writeEndElement()), { ...unaware, ...repairing })
    ).toBe('<p:a/>');
  });

  it('is namespace-aware by default, refusing a colon in a local name', () => {
    expect(codeOf((w) => w.writeStartElement('p:a'))).toBe('WRITE_NAME');
  });
});
