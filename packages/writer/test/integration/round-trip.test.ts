import { canonical, names } from '@test/helpers/canonical.ts';
import { written, writtenBytes } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, XMLInputFactory } from '@exemplarjs/xml';
import { BytesSink, type OutputOptions, type StreamWriter, StringSink, XMLOutputFactory } from '@/index.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** Re-reads a document's root element: its attribute values by name, and all its text. */
function reread(source: string | Uint8Array): { attributes: Record<string, string>; text: string } {
  const reader = new XMLInputFactory().createStreamReader(source);
  const attributes: Record<string, string> = {};
  let text = '';
  let depth = 0;
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.START_ELEMENT && depth++ === 0) {
      for (let i = 0; i < reader.attributeCount(); i++) attributes[reader.attributeName(i)] = reader.attributeValue(i);
    } else if (event === EventType.END_ELEMENT) depth--;
    else if (event === EventType.CHARACTERS || event === EventType.CDATA || event === EventType.SPACE)
      text += reader.text();
  }
  return { attributes, text };
}

/** Encodes text as UTF-16BE code units after a byte order mark. */
function utf16(text: string): Uint8Array {
  const units = Array.from(`\uFEFF${text}`, (c) => c.charCodeAt(0));
  return Uint8Array.from(units.flatMap((u) => [u >> 8, u & 0xff]));
}

/** Writes one root element with an attribute and text of the same value. */
function element(value: string, options: OutputOptions = {}): string {
  return written((w) => {
    w.writeStartDocument();
    w.writeStartElement('r');
    w.writeAttribute('v', value);
    w.writeCharacters(value);
    w.writeEndDocument();
  }, options);
}

/** Copies a document through the event reader and event writer. */
function copy(source: string | Uint8Array, input: InputOptions = {}, output: OutputOptions = {}): string {
  const sink = new StringSink();
  const writer = new XMLOutputFactory(output).createEventWriter(sink);
  writer.add(new XMLInputFactory(input).createEventReader(source));
  writer.flush();
  return sink.toString();
}

describe('the stream writer read back: escaping (§2.4, §3.3.3, §2.11)', () => {
  it.each(['&', '<', '>', '"', "'", '\t', '\n', '\r', '\r\n', ']]>', ']]', '&amp;', '&#13;', '<!--x-->', ' \t\n\r '])(
    'gives back %j in text and in an attribute value',
    (value) => {
      expect(reread(element(value))).toEqual({ attributes: { v: value }, text: value });
    }
  );

  it('gives back every character XML 1.0 allows in the first two planes, a sample of each block', () => {
    let value = '\t\n\r';
    for (let c = 0x20; c < 0x2_00_00; c += c < 0x1_00 ? 1 : 97) {
      if ((c < 0xd8_00 || c > 0xdf_ff) && c !== 0xff_fe && c !== 0xff_ff) value += String.fromCodePoint(c);
    }
    expect(reread(element(value))).toEqual({ attributes: { v: value }, text: value });
  });

  it('gives back C0 and C1 controls, NEL and LS in XML 1.1 (XML 1.1 §2.2, §2.11)', () => {
    const value = '\u0001\u0008\u000B\u000C\u001F\u007F\u0080\u0085\u009F\u2028 \t\n\r';
    expect(reread(element(value, { version: '1.1' }))).toEqual({ attributes: { v: value }, text: value });
  });

  it('gives back with minimal escaping only what minimal escaping keeps: line ends and attribute whitespace normalize', () => {
    const value = 'a\tb\nc\rd\r\ne & < > " ]]>';
    expect(reread(element(value, { escaping: 'minimal' }))).toEqual({
      attributes: { v: 'a b c d e & < > " ]]>' },
      text: 'a\tb\nc\nd\ne & < > " ]]>',
    });
  });

  it('gives back text the encoding lacks, written as references', () => {
    const value = 'é € 误 😀 \u0080';
    for (const encoding of ['US-ASCII', 'ISO-8859-1', 'windows-1252', 'KOI8-R', 'IBM037']) {
      const bytes = writtenBytes(
        (w) => {
          w.writeStartDocument();
          w.writeStartElement('r');
          w.writeAttribute('v', value);
          w.writeCharacters(value);
          w.writeEndDocument();
        },
        { encoding }
      );
      expect(reread(bytes), encoding).toEqual({ attributes: { v: value }, text: value });
    }
  });

  it.each(['UTF-8', 'UTF-16', 'UTF-16LE', 'UTF-16BE'])(
    'gives back everything in %s, with no references needed',
    (encoding) => {
      const value = 'é € 误 😀';
      const bytes = writtenBytes(
        (w) => {
          w.writeStartDocument();
          w.writeStartElement('r');
          w.writeCharacters(value);
          w.writeEndDocument();
        },
        { encoding }
      );
      expect(new TextDecoder(encoding.startsWith('UTF-16') ? 'utf-16be' : 'utf-8').decode(bytes)).not.toContain('&#');
      expect(reread(bytes).text).toBe(value);
    }
  );

  it('gives back a UTF-16 document longer than one output chunk, with one byte order mark', () => {
    const part = '😀x'.repeat(4000);
    const bytes = writtenBytes(
      (w) => {
        w.writeStartDocument();
        w.writeStartElement('r');
        for (let i = 0; i < 10; i++) w.writeCharacters(part);
        w.writeEndDocument();
      },
      { encoding: 'UTF-16' }
    );
    const value = part.repeat(10);
    expect([...bytes.subarray(0, 4)]).toEqual([0xfe, 0xff, 0, 0x3c]);
    expect(reread(bytes).text).toBe(value);
  });

  it('gives back text written in a web stream that takes one chunk at a time', async () => {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>(
      { write: (chunk) => void chunks.push(chunk) },
      new CountQueuingStrategy({ highWaterMark: 1 })
    );
    const w = new XMLOutputFactory().createStreamWriter(stream);
    w.writeStartElement('r');
    for (const ch of '😀é😀') {
      w.writeCharacters(ch);
      w.flush();
    }
    w.writeEndDocument();
    await w.close();
    const bytes = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
    expect(reread(bytes).text).toBe('😀é😀');
  });
});

describe('the stream writer read back: structure', () => {
  it('gives back empty elements as elements with no content', () => {
    const out = written((w) => {
      w.writeStartElement('r');
      w.writeEmptyElement('a');
      w.writeAttribute('x', '1');
      w.writeStartElement('b');
      w.writeEndElement();
      w.writeEndDocument();
    });
    expect(canonical(out)).toBe('<r><a x="1"></a><b></b></r>');
  });

  it('gives back CDATA holding ]]> as the same text, split across sections', () => {
    const value = 'a]]>b]]]]>c';
    const out = written((w) => (w.writeStartElement('r'), w.writeCData(value), w.writeEndDocument()), {
      checkWellFormedness: false,
    });
    expect(reread(out).text).toBe(value);
    const cdata = written((w) => (w.writeStartElement('script'), w.writeCharacters(value), w.writeEndDocument()), {
      cdataSectionElements: ['script'],
    });
    expect(reread(cdata).text).toBe(value);
  });

  it('gives back text holding ]]> written across two calls, with minimal escaping (§2.4)', () => {
    const out = written(
      (w) => {
        w.writeStartElement('r');
        w.writeCharacters('x]]');
        w.writeCharacters('>y');
        w.writeEndDocument();
      },
      { escaping: 'minimal' }
    );
    expect(reread(out).text).toBe('x]]>y');
  });

  it('gives back a DOCTYPE from the options whose identifiers hold double quotes (§2.8)', () => {
    const out = written(
      (w) => {
        w.writeStartElement('r');
        w.writeEndDocument();
      },
      { doctypePublic: '-//Q//EN', doctypeSystem: 'say "hi".dtd' }
    );
    const reader = new XMLInputFactory().createStreamReader(out);
    while (reader.next() !== EventType.DTD);
    expect(reader.doctype().systemId).toBe('say "hi".dtd');
  });

  it('gives back comments, PIs and the DOCTYPE, whose entities expand where referenced', () => {
    const out = written((w) => {
      w.writeStartDocument('1.0', 'UTF-8', true);
      w.writeComment(' before ');
      w.writeDTD('<!DOCTYPE r [<!ENTITY e "expanded">]>');
      w.writeProcessingInstruction('p', 'data');
      w.writeStartElement('r');
      w.writeEntityRef('e');
      w.writeProcessingInstruction('q');
      w.writeEndDocument();
      w.writeComment('after');
    });
    expect(canonical(out)).toBe('<?p data?><r>expanded<?q ?></r>');
    const reader = new XMLInputFactory().createStreamReader(out);
    expect(reader.next()).toBe(EventType.COMMENT);
    expect(reader.standalone()).toBe(true);
  });

  it('gives back the text of mixed content written indented', () => {
    const write = (w: StreamWriter) => {
      w.writeStartElement('r');
      w.writeStartElement('p');
      w.writeCharacters('a ');
      w.writeStartElement('b');
      w.writeStartElement('i');
      w.writeCharacters('x');
      w.writeEndDocument();
    };
    expect(reread(written(write, { indent: '  ' })).text.trim()).toBe(reread(written(write)).text);
  });

  it('gives back an indented document with the same elements and text', () => {
    const write = (w: StreamWriter) => {
      w.writeStartDocument();
      w.writeStartElement('r');
      w.writeStartElement('a');
      w.writeCharacters('text');
      w.writeEndElement();
      w.writeEmptyElement('b');
      w.writeEndDocument();
    };
    expect(names(written(write, { indent: '  ' }))).toEqual(names(written(write)));
  });
});

describe('the stream writer read back: namespaces (Namespaces in XML)', () => {
  it('gives back the namespaces the caller declares', () => {
    const out = written((w) => {
      w.writeStartElement('', 'r', 'urn:d');
      w.writeDefaultNamespace('urn:d');
      w.writeNamespace('p', 'urn:p');
      w.writeAttribute('p', 'urn:p', 'a', '1');
      w.writeAttribute(XML, 'lang', 'en');
      w.writeStartElement('urn:p', 'c');
      w.writeStartElement('', 'n', '');
      w.writeDefaultNamespace('');
      w.writeEndDocument();
    });
    expect(names(out)).toEqual([
      '{urn:d}r',
      `@{${XML}}lang=en`,
      '@{urn:p}a=1',
      '{urn:p}c',
      'n',
      '/n',
      '/{urn:p}c',
      '/{urn:d}r',
    ]);
  });

  it('gives back the namespaces repairing mode declares', () => {
    const out = written(
      (w) => {
        w.writeStartElement('urn:d', 'r');
        w.writeAttribute('urn:x', 'a', '1');
        w.writeAttribute('urn:d', 'b', '2');
        w.writeStartElement('p', 'c', 'urn:p');
        w.writeAttribute('q', 'urn:other', 'z', '3');
        w.writeStartElement('', 'n', '');
        w.writeEndDocument();
      },
      { repairNamespaces: true }
    );
    expect(names(out)).toEqual([
      '{urn:d}r',
      '@{urn:d}b=2',
      '@{urn:x}a=1',
      '{urn:p}c',
      '@{urn:other}z=3',
      'n',
      '/n',
      '/{urn:p}c',
      '/{urn:d}r',
    ]);
  });

  it('gives back namespaces declared through writeAttribute, in either mode', () => {
    for (const repairNamespaces of [false, true]) {
      const out = written(
        (w) => {
          w.writeStartElement('feed');
          w.writeAttribute('xmlns', 'urn:atom');
          w.writeAttribute(XMLNS, 'p', 'urn:p');
          w.writeAttribute('p', 'urn:p', 'a', '1');
          w.writeStartElement('entry');
          w.writeEndDocument();
        },
        { repairNamespaces }
      );
      expect(names(out)).toEqual([
        '{urn:atom}feed',
        '@{urn:p}a=1',
        '{urn:atom}entry',
        '/{urn:atom}entry',
        '/{urn:atom}feed',
      ]);
    }
  });

  it('gives back an XML 1.1 undeclared prefix (Namespaces 1.1)', () => {
    const out = written((w) => {
      w.writeStartDocument('1.1');
      w.writeStartElement('p', 'r', 'urn:p');
      w.writeNamespace('p', 'urn:p');
      w.writeStartElement('c');
      w.writeNamespace('p', '');
      w.writeEndDocument();
    });
    expect(names(out)).toEqual(['{urn:p}r', 'c', '/c', '/{urn:p}r']);
  });
});

describe('the event writer read back: copies give the same canonical form', () => {
  it.each([
    [
      'an XML declaration and prolog',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!--c--><?p d?><r/><!--e-->',
    ],
    [
      'a DOCTYPE with declarations',
      '<!DOCTYPE r [<!ELEMENT r ANY><!ATTLIST r a CDATA "d"><!ENTITY e "x&#38;#60;y">]><r>&e;</r>',
    ],
    [
      'attribute defaults and normalization',
      '<!DOCTYPE r [<!ATTLIST r t NMTOKENS #IMPLIED>]><r t=" a  b " u="x&#9;y&#10;z"/>',
    ],
    [
      'entities nested, in attributes and content',
      `<!DOCTYPE A [<!ENTITY at "1"><!ENTITY t "2.&at;"><!ENTITY el '<B x="&at;.3"/>'>]><A x="&at;.2">&t;&el;</A>`,
    ],
    [
      'namespaces and their scopes',
      '<r xmlns="urn:d" xmlns:p="urn:p"><p:a p:x="1" y="2"><b xmlns=""/><p:c xmlns:p="urn:q"/></p:a></r>',
    ],
    ['CDATA, comments and PIs in content', '<r>a<![CDATA[<b> & ]]]]><![CDATA[>]]>c<!-- x --><?p d?></r>'],
    ['whitespace and line ends', '<r>\n  <a>\r\n x\r</a>\t</r>'],
    [
      'character references to every special character',
      '<r a="&#9;&#10;&#13;&quot;&lt;&amp;">&#13;&#9;&lt;&gt;&amp;</r>',
    ],
    ['characters beyond the BMP', '<r a="😀">误😀</r>'],
    ['an XML 1.1 document with controls and line ends', '<?xml version="1.1"?><r a="&#x1;">&#x7F;\u0085x\u2028</r>'],
    ['the xml prefix', '<r xml:lang="en" xml:space="preserve"/>'],
  ])('copies %s', (_title, xml) => {
    expect(canonical(copy(xml))).toBe(canonical(xml));
  });

  it.each([
    ['UTF-16', utf16('<r>é€</r>')],
    ['ISO-8859-1', Uint8Array.from('<?xml version="1.0" encoding="ISO-8859-1"?><r>é</r>', (c) => c.charCodeAt(0))],
  ])('copies a document read from %s bytes', (_encoding, bytes) => {
    expect(canonical(copy(bytes))).toBe(canonical(bytes));
  });

  it.each(['ISO-8859-1', 'UTF-16LE', 'US-ASCII'])('copies a document into %s bytes', (encoding) => {
    const xml = '<r a="é€">误 😀</r>';
    const sink = new BytesSink();
    const writer = new XMLOutputFactory().createEventWriter(sink, { encoding });
    writer.add(new XMLInputFactory().createEventReader(xml));
    expect(canonical(sink.toBytes())).toBe(canonical(xml));
  });

  it('copies a document in its normal form byte for byte', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<?pi data?>\n<!DOCTYPE r [<!ENTITY e "x">]>\n<!--c-->\n<r xmlns="urn:d" xmlns:p="urn:p" p:a="1"><p:e/><![CDATA[c]]>text<e/></r>\n<?end?>';
    expect(copy(xml, { reportPrologWhitespace: true })).toBe(xml);
  });

  it('copies a document read in chunks asynchronously', async () => {
    const xml = '<!DOCTYPE r [<!ENTITY e "E">]><r xmlns:p="urn:p"><p:a>&e;</p:a><![CDATA[x]]></r>';
    const bytes = new TextEncoder().encode(xml);
    const stream = async function* () {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
    };
    const sink = new StringSink();
    await new XMLOutputFactory()
      .createEventWriter(sink)
      .addAsync(new XMLInputFactory().createAsyncEventReader(stream()));
    expect(canonical(sink.toString())).toBe(canonical(xml));
  });

  it('copies coalesced text and unreplaced entity references', () => {
    const xml = '<!DOCTYPE r [<!ENTITY e "E">]><r>a<![CDATA[b]]>&e;</r>';
    expect(canonical(copy(xml, { coalescing: true }))).toBe('<r>abE</r>');
    expect(canonical(copy(xml, { replaceEntityReferences: false }))).toBe('<r>abE</r>');
  });
});
