import { canonical } from '@test/helpers/canonical.ts';
import { codeOf, inRoot, written, writtenBytes } from '@test/helpers/write.ts';
import { describe, expect, it } from 'vitest';
import { QName, XMLInputFactory } from '@exemplarjs/xml';
import { BytesSink, type Sink, type StreamWriter, StringSink, WriterError, XMLOutputFactory } from '@/index.ts';

describe('StreamWriter: the document', () => {
  it('writes the guide example', () => {
    const DC = 'http://purl.org/dc/elements/1.1/';
    const out = written((w) => {
      w.writeStartDocument();
      w.writeStartElement('library');
      w.writeNamespace('dc', DC);
      w.writeStartElement('dc', 'title', DC);
      w.writeAttribute('lang', 'en');
      w.writeCharacters('Dune & Children');
      w.writeEndElement();
      w.writeEndElement();
      w.writeEndDocument();
    });
    expect(out).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><library xmlns:dc="${DC}"><dc:title lang="en">Dune &amp; Children</dc:title></library>`
    );
  });

  it.each<[string, (w: StreamWriter) => void, string]>([
    ['no arguments', (w) => w.writeStartDocument(), '<?xml version="1.0" encoding="UTF-8"?>'],
    ['a version', (w) => w.writeStartDocument('1.1'), '<?xml version="1.1" encoding="UTF-8"?>'],
    [
      'a version and an encoding',
      (w) => w.writeStartDocument('1.0', 'ISO-8859-1'),
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
    ],
    [
      'standalone true',
      (w) => w.writeStartDocument('1.0', 'UTF-8', true),
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    ],
    [
      'standalone false',
      (w) => w.writeStartDocument('1.0', 'UTF-8', false),
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    ],
  ])('writes the XML declaration for %s', (_title, write, declaration) => {
    expect(written(write)).toBe(declaration);
  });

  it('takes the version from the factory and the encoding from the writer by default', () => {
    expect(written((w) => w.writeStartDocument(), { version: '1.1', encoding: 'ISO-8859-1' })).toBe(
      '<?xml version="1.1" encoding="ISO-8859-1"?>'
    );
  });

  it('takes any version 1.x, as XML 1.0 §2.8 [26] allows', () => {
    expect(written((w) => w.writeStartDocument('1.7'))).toBe('<?xml version="1.7" encoding="UTF-8"?>');
  });

  it.each(['2.0', '1', '1.', 'x', '1.0 '])('refuses the version %j, checks on or off', (version) => {
    expect(codeOf((w) => w.writeStartDocument(version))).toBe('WRITE_STATE');
    expect(codeOf((w) => w.writeStartDocument(version), { checkWellFormedness: false })).toBe('WRITE_STATE');
  });

  it('writes no declaration with omitXMLDeclaration, but still takes the version for escaping', () => {
    const out = written(
      (w) => {
        w.writeStartDocument('1.1');
        w.writeStartElement('a');
        w.writeCharacters('\u0001');
        w.writeEndDocument();
      },
      { omitXMLDeclaration: true }
    );
    expect(out).toBe('<a>&#1;</a>');
  });

  it('escapes for the factory version without a declaration', () => {
    expect(
      written(
        inRoot((w) => w.writeCharacters('\u0085')),
        { version: '1.1' }
      )
    ).toBe('<r>&#133;');
  });

  it('closes every open element at the end of the document', () => {
    const out = written((w) => {
      w.writeStartElement('a');
      w.writeStartElement('b');
      w.writeStartElement('c');
      w.writeCharacters('x');
      w.writeEndDocument();
    });
    expect(out).toBe('<a><b><c>x</c></b></a>');
  });

  it('ends a document whose root element is an empty element, as StAX does', () => {
    expect(written((w) => (w.writeEmptyElement('a'), w.writeAttribute('x', '1'), w.writeEndDocument()))).toBe(
      '<a x="1"/>'
    );
  });

  it('ends a document whose root element has children of its own empty elements', () => {
    expect(
      written((w) => {
        w.writeStartElement('r');
        w.writeEmptyElement('e');
        w.writeEndDocument();
      })
    ).toBe('<r><e/></r>');
  });

  it('writes what comes after the root element', () => {
    const out = written((w) => {
      w.writeEmptyElement('a');
      w.writeCharacters('\n');
      w.writeComment('after');
      w.writeProcessingInstruction('p', 'd');
      w.writeEndDocument();
    });
    expect(out).toBe('<a/>\n<!--after--><?p d?>');
  });

  it('writes whitespace before the root element', () => {
    expect(written((w) => (w.writeCharacters(' \t\r\n'), w.writeEmptyElement('a')))).toBe(' \t\r\n<a/>');
  });
});

describe('StreamWriter: the DOCTYPE', () => {
  it('writes a DOCTYPE as given', () => {
    const dtd = '<!DOCTYPE a [<!ENTITY e "x">]>';
    expect(written((w) => (w.writeDTD(dtd), w.writeEmptyElement('a')))).toBe(`${dtd}<a/>`);
  });

  it('writes the DOCTYPE the factory options ask for before the root, with a public id or without', () => {
    expect(written((w) => w.writeEmptyElement('html'), { doctypeSystem: 'x.dtd' })).toBe(
      '<!DOCTYPE html SYSTEM "x.dtd"><html/>'
    );
    expect(
      written((w) => w.writeEmptyElement('p', 'html', 'urn:x'), {
        doctypeSystem: 'x.dtd',
        doctypePublic: '-//X',
        checkWellFormedness: false,
      })
    ).toBe('<!DOCTYPE p:html PUBLIC "-//X" "x.dtd"><p:html/>');
  });

  it('writes no DOCTYPE from the options with only a public id, or when one was written', () => {
    expect(written((w) => w.writeEmptyElement('a'), { doctypePublic: '-//X' })).toBe('<a/>');
    expect(written((w) => (w.writeDTD('<!DOCTYPE a>'), w.writeEmptyElement('a')), { doctypeSystem: 'x.dtd' })).toBe(
      '<!DOCTYPE a><a/>'
    );
  });

  it('writes the DOCTYPE after the XML declaration and comments', () => {
    const out = written((w) => {
      w.writeStartDocument();
      w.writeComment('c');
      w.writeDTD('<!DOCTYPE a>');
      w.writeEmptyElement('a');
    });
    expect(out).toBe('<?xml version="1.0" encoding="UTF-8"?><!--c--><!DOCTYPE a><a/>');
  });
});

describe('StreamWriter: elements', () => {
  it('writes an element that ends straight after its start tag as an empty-element tag', () => {
    expect(written((w) => (w.writeStartElement('a'), w.writeEndElement()))).toBe('<a/>');
  });

  it('writes an end tag once empty text has closed the start tag', () => {
    expect(written((w) => (w.writeStartElement('a'), w.writeCharacters(''), w.writeEndElement()))).toBe('<a></a>');
  });

  it('takes a QName for an element or an attribute, as the event API names them', () => {
    const DC = 'http://purl.org/dc/elements/1.1/';
    const out = written((w) => {
      w.writeStartElement('library');
      w.writeNamespace('dc', DC);
      w.writeStartElement(new QName(DC, 'title', 'dc'));
      w.writeAttribute(new QName(DC, 'lang', 'dc'), 'en');
      w.writeAttribute(new QName('', 'id'), 't1');
      w.writeEmptyElement(new QName(DC, 'creator', 'dc'));
      w.writeEndElement();
      w.writeEndElement();
    });
    expect(out).toBe(`<library xmlns:dc="${DC}"><dc:title dc:lang="en" id="t1"><dc:creator/></dc:title></library>`);
  });

  it('writes the same from a QName as from its parts', () => {
    const name = new QName('urn:x', 'a', 'x');
    const parts = written(
      (w) => (
        w.writeStartElement('x', 'a', 'urn:x'),
        w.writeNamespace('x', 'urn:x'),
        w.writeAttribute('x', 'urn:x', 'b', '1'),
        w.writeEndElement()
      )
    );
    const qnames = written(
      (w) => (
        w.writeStartElement(name),
        w.writeNamespace('x', 'urn:x'),
        w.writeAttribute(new QName('urn:x', 'b', 'x'), '1'),
        w.writeEndElement()
      )
    );
    expect(qnames).toBe(parts);
  });

  it('writes empty elements, which take attributes until the next write', () => {
    const out = written((w) => {
      w.writeStartElement('a');
      w.writeEmptyElement('b');
      w.writeAttribute('x', '1');
      w.writeStartElement('c');
      w.writeEndElement();
      w.writeEmptyElement('d');
      w.writeCharacters('t');
      w.writeEndElement();
    });
    expect(out).toBe('<a><b x="1"/><c/><d/>t</a>');
  });

  it('closes the enclosing element when writeEndElement follows an empty element, as StAX does', () => {
    const out = written((w) => {
      w.writeStartElement('a');
      w.writeStartElement('b');
      w.writeEmptyElement('c');
      w.writeEndElement();
      w.writeCharacters('t');
      w.writeEndElement();
    });
    expect(out).toBe('<a><b><c/></b>t</a>');
  });

  it('writes names outside ASCII and beyond the BMP', () => {
    expect(
      written((w) => (w.writeStartElement('тест'), w.writeAttribute('a\u{10000}', '1'), w.writeEndElement()))
    ).toBe('<тест a\u{10000}="1"/>');
  });

  it('writes elements as text sections around children', () => {
    const out = written((w) => {
      w.writeStartElement('p');
      w.writeCharacters('a ');
      w.writeStartElement('b');
      w.writeCharacters('bold');
      w.writeEndElement();
      w.writeCharacters(' c');
      w.writeEndElement();
    });
    expect(out).toBe('<p>a <b>bold</b> c</p>');
  });
});

describe('StreamWriter: attributes', () => {
  it('writes attributes in the order given', () => {
    const out = written(
      inRoot((w) => (w.writeAttribute('z', '1'), w.writeAttribute('a', '2'), w.writeAttribute('m', '3')))
    );
    expect(out).toBe('<r z="1" a="2" m="3">');
  });

  it('writes an empty value', () => {
    expect(written(inRoot((w) => w.writeAttribute('a', '')))).toBe('<r a="">');
  });

  it('writes the xml prefix with no declaration (Namespaces §3)', () => {
    const XML = 'http://www.w3.org/XML/1998/namespace';
    expect(written(inRoot((w) => w.writeAttribute('xml', XML, 'lang', 'en')))).toBe('<r xml:lang="en">');
    expect(written(inRoot((w) => w.writeAttribute(XML, 'space', 'preserve')))).toBe('<r xml:space="preserve">');
  });

  it('writes names that are Object.prototype members as ordinary names', () => {
    const out = written(inRoot((w) => (w.writeAttribute('__proto__', '1'), w.writeAttribute('constructor', '2'))));
    expect(out).toBe('<r __proto__="1" constructor="2">');
  });
});

describe('StreamWriter: character data', () => {
  it('escapes so that re-reading gives back exactly what was written', () => {
    const value = 'tab\there\nline\rcr & < > " \'';
    const text = 'cr\r\nand ]]> & <';
    const out = written((w) => {
      w.writeStartElement('a');
      w.writeAttribute('v', value);
      w.writeCharacters(text);
      w.writeEndElement();
      w.writeEndDocument();
    });
    const reader = new XMLInputFactory().createStreamReader(out);
    reader.next();
    expect(reader.attributeValue(0)).toBe(value);
    reader.next();
    expect(reader.text()).toBe(text);
  });

  it('escapes only what XML requires in minimal mode', () => {
    const out = written(
      (w) => {
        w.writeStartElement('a');
        w.writeAttribute('v', 'x\ty"');
        w.writeCharacters('> ]]> \r');
        w.writeEndElement();
      },
      { escaping: 'minimal' }
    );
    expect(out).toBe('<a v="x\ty&quot;">> ]]&gt; \r</a>');
  });

  it('writes XML 1.1 restricted characters, NEL and LS as references', () => {
    const out = written((w) => {
      w.writeStartDocument('1.1');
      w.writeStartElement('a');
      w.writeCharacters('\u0001\u0085\u2028');
      w.writeEndDocument();
    });
    expect(out).toBe('<?xml version="1.1" encoding="UTF-8"?><a>&#1;&#133;&#8232;</a>');
  });

  it('writes text as CDATA sections in the elements the options name, by qualified name', () => {
    const out = written(
      (w) => {
        w.writeStartElement('html');
        w.writeNamespace('s', 'urn:s');
        w.writeStartElement('script');
        w.writeCharacters('a < b ]]> c');
        w.writeEndElement();
        w.writeStartElement('s', 'script', 'urn:s');
        w.writeCharacters('x<y');
        w.writeEndElement();
        w.writeStartElement('p');
        w.writeCharacters('a < b');
        w.writeEndDocument();
      },
      { cdataSectionElements: ['script'] }
    );
    expect(out).toBe(
      '<html xmlns:s="urn:s"><script><![CDATA[a < b ]]]]><![CDATA[> c]]></script><s:script>x&lt;y</s:script><p>a &lt; b</p></html>'
    );
  });

  it('writes CDATA sections', () => {
    expect(written(inRoot((w) => w.writeCData('a < b & c')))).toBe('<r><![CDATA[a < b & c]]>');
    expect(written(inRoot((w) => w.writeCData('')))).toBe('<r><![CDATA[]]>');
  });

  it('writes references to the predefined entities with no DOCTYPE (§4.6)', () => {
    const out = written(
      inRoot((w) => {
        for (const name of ['amp', 'lt', 'gt', 'apos', 'quot']) w.writeEntityRef(name);
      })
    );
    expect(out).toBe('<r>&amp;&lt;&gt;&apos;&quot;');
  });

  it('writes a reference to any entity once a DOCTYPE is written', () => {
    const out = written((w) => {
      w.writeDTD('<!DOCTYPE r [<!ENTITY e "x">]>');
      w.writeStartElement('r');
      w.writeEntityRef('amp');
      w.writeEntityRef('e');
      w.writeEndDocument();
    });
    expect(out).toBe('<!DOCTYPE r [<!ENTITY e "x">]><r>&amp;&e;</r>');
    expect(canonical(out)).toBe('<r>&amp;x</r>');
  });
});

describe('StreamWriter: comments and PIs', () => {
  it('writes comments, a leading dash included (§2.5 [15])', () => {
    expect(written(inRoot((w) => (w.writeComment(' c '), w.writeComment('-a'), w.writeComment(''))))).toBe(
      '<r><!-- c --><!---a--><!---->'
    );
  });

  it('writes a PI with data, with empty data and without data', () => {
    expect(
      written(
        inRoot(
          (w) => (
            w.writeProcessingInstruction('p', 'a b'),
            w.writeProcessingInstruction('q', ''),
            w.writeProcessingInstruction('s')
          )
        )
      )
    ).toBe('<r><?p a b?><?q?><?s?>');
  });

  it('writes a PI whose target only starts with xml', () => {
    expect(written((w) => w.writeProcessingInstruction('xml-stylesheet', 'href="s.css"'))).toBe(
      '<?xml-stylesheet href="s.css"?>'
    );
  });
});

describe('StreamWriter: output', () => {
  it('hands nothing to the sink until it is flushed', () => {
    const sink = new StringSink();
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeStartElement('a');
    w.writeCharacters('t');
    expect(sink.toString()).toBe('');
    w.flush();
    expect(sink.toString()).toBe('<a>t');
  });

  it('closes an open start tag when flushed, ready for content', () => {
    const sink = new StringSink();
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeStartElement('a');
    w.flush();
    w.writeCharacters('t');
    w.writeEndElement();
    w.flush();
    expect(sink.toString()).toBe('<a>t</a>');
  });

  it('hands output to the sink in chunks of about 64 K characters', () => {
    const chunks: string[] = [];
    const sink: Sink = { write: (chunk) => void chunks.push(chunk) };
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeStartElement('a');
    for (let i = 0; i < 300; i++) w.writeCharacters('x'.repeat(1000));
    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => chunk.length >= 65_536)).toBe(true);
    w.writeEndDocument();
    expect(chunks.join('')).toBe(`<a>${'x'.repeat(300_000)}</a>`);
  });

  it('resolves drain() at once for a sink that never fills', async () => {
    const w = new XMLOutputFactory().createStreamWriter(new StringSink());
    w.writeStartElement('a');
    await expect(w.drain()).resolves.toBeUndefined();
    const bytes = new XMLOutputFactory().createStreamWriter(new BytesSink());
    await expect(bytes.drain()).resolves.toBeUndefined();
  });

  it('keeps a slow stream from falling behind when drain() is awaited between writes', async () => {
    let delivered = 0;
    let mostQueued = 0;
    let handed = 0;
    const stream = new WritableStream<Uint8Array>(
      {
        write: async (chunk) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          delivered += chunk.length;
        },
      },
      { highWaterMark: 2 }
    );
    const w = new XMLOutputFactory().createStreamWriter(stream, { encoding: 'utf-8' });
    const record = '<item>text for the item</item>'.length;
    w.writeStartElement('root');
    for (let i = 0; i < 20_000; i++) {
      w.writeStartElement('item');
      w.writeCharacters('text for the item');
      w.writeEndElement();
      if (i % 100 === 0) {
        await w.drain();
        handed = Math.max(handed, delivered);
        mostQueued = Math.max(mostQueued, i * record - delivered);
      }
    }
    w.writeEndDocument();
    await w.close();
    expect(delivered).toBe(20_000 * record + '<root></root>'.length);
    expect(handed).toBeGreaterThan(0);
    // Without drain() all 600 K bytes would wait in the stream's queue; with it, no more than a few chunks.
    expect(mostQueued).toBeLessThan(3 * 65_536);
  });

  it('flushes nothing when nothing was written', () => {
    const chunks: string[] = [];
    const w = new XMLOutputFactory().createStreamWriter({ write: (chunk) => void chunks.push(chunk) });
    w.flush();
    expect(chunks).toEqual([]);
  });

  it('closes the sink on close, after flushing', async () => {
    const events: string[] = [];
    const sink: Sink = {
      write: (chunk) => void events.push(chunk),
      close: () => void events.push('closed'),
    };
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeStartElement('a');
    await w.close();
    expect(events).toEqual(['<a>', 'closed']);
  });

  it('leaves open elements open on close, as StAX does; writeEndDocument is what ends them', async () => {
    const sink = new StringSink();
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeStartElement('a');
    w.writeStartElement('b');
    await w.close();
    expect(sink.toString()).toBe('<a><b>');
  });

  it('closes a sink without a close method', async () => {
    const sink = new StringSink();
    const w = new XMLOutputFactory().createStreamWriter(sink);
    w.writeEmptyElement('a');
    await expect(w.close()).resolves.toBeUndefined();
    expect(sink.toString()).toBe('<a/>');
  });

  it('closes a byte sink, waiting for a stream to take everything', async () => {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({ write: (chunk) => void chunks.push(chunk) });
    const w = new XMLOutputFactory().createStreamWriter(stream);
    w.writeStartElement('a');
    w.writeEndDocument();
    await w.close();
    expect(new TextDecoder().decode(chunks[0])).toBe('<a/>');
  });

  it('closes a byte sink that has a close method', async () => {
    let closed = false;
    const w = new XMLOutputFactory().createStreamWriter({ writeBytes: () => {}, close: () => void (closed = true) });
    await w.close();
    expect(closed).toBe(true);
  });
});

describe('StreamWriter: encodings', () => {
  it('encodes bytes, writing what the encoding lacks as references', () => {
    const sink = new BytesSink();
    const w = new XMLOutputFactory({ encoding: 'ISO-8859-1' }).createStreamWriter(sink);
    w.writeStartDocument();
    w.writeStartElement('a');
    w.writeAttribute('v', 'é€');
    w.writeCharacters('é€');
    w.writeCData('x€y');
    w.writeEndDocument();
    expect(new TextDecoder('latin1').decode(sink.toBytes())).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?><a v="é&#8364;">é&#8364;<![CDATA[x]]>&#8364;<![CDATA[y]]></a>'
    );
  });

  it('writes CDATA the encoding lacks wholly or at its ends as references, with no empty sections', () => {
    const out = written(
      inRoot((w) => (w.writeCData('€'), w.writeCData('€a€'))),
      { encoding: 'US-ASCII' }
    );
    expect(out).toBe('<r>&#8364;&#8364;<![CDATA[a]]>&#8364;');
  });

  it('writes what the encoding lacks as references with a text sink too', () => {
    expect(
      written(
        inRoot((w) => w.writeCharacters('é😀')),
        { encoding: 'US-ASCII' }
      )
    ).toBe('<r>&#233;&#128512;');
  });

  it('rejects markup the encoding cannot hold when it is written, naming the character', () => {
    const latin1 = new XMLOutputFactory({ encoding: 'ISO-8859-1' });
    const caught = (write: () => unknown): unknown => {
      try {
        write();
      } catch (error) {
        return error;
      }
      return undefined;
    };
    const inElement = (write: (w: ReturnType<typeof latin1.createStreamWriter>) => void) => () => {
      const w = latin1.createStreamWriter(new BytesSink());
      w.writeStartElement('a');
      write(w);
    };
    const lacks = (what: string) => ({
      code: 'WRITE_ENCODING',
      message: `U+10000 cannot be written in ${what} in this encoding`,
    });
    expect(caught(inElement((w) => w.writeStartElement('b\u{10000}')))).toMatchObject(lacks('an element name'));
    expect(caught(inElement((w) => w.writeAttribute('b\u{10000}', 'v')))).toMatchObject(lacks('an attribute name'));
    expect(caught(inElement((w) => w.writeNamespace('p\u{10000}', 'urn:p')))).toMatchObject(lacks('an attribute name'));
    const reference = latin1.createStreamWriter(new BytesSink());
    reference.writeDTD('<!DOCTYPE a>');
    reference.writeStartElement('a');
    expect(caught(() => reference.writeEntityRef('e\u{10000}'))).toMatchObject(lacks('an entity reference'));
    expect(caught(inElement((w) => w.writeComment('\u{10000}')))).toMatchObject(lacks('a comment'));
    expect(caught(inElement((w) => w.writeProcessingInstruction('p', '\u{10000}')))).toMatchObject(
      lacks('a processing instruction')
    );
    const doctype = latin1.createStreamWriter(new BytesSink());
    expect(caught(() => doctype.writeDTD('<!DOCTYPE a\u{10000}>'))).toMatchObject(lacks('the DOCTYPE'));
  });

  it('rejects a name the encoding lacks even with the checks off', () => {
    expect(codeOf((w) => w.writeStartElement('é'), { encoding: 'US-ASCII', checkWellFormedness: false })).toBe(
      'WRITE_ENCODING'
    );
  });

  it('writes every single-byte encoding the reader decodes, EBCDIC included', () => {
    for (const encoding of ['windows-1252', 'ISO-8859-7', 'KOI8-R', 'IBM037', 'IBM1047']) {
      const bytes = writtenBytes(
        (w) => {
          w.writeStartDocument();
          w.writeStartElement('a');
          w.writeCharacters('x € Ω Ж [ ]');
          w.writeEndDocument();
        },
        { encoding }
      );
      expect(canonical(bytes), encoding).toBe('<a>x € Ω Ж [ ]</a>');
    }
  });

  it('starts UTF-16 output with a byte order mark, once', () => {
    const sink = new BytesSink();
    const w = new XMLOutputFactory().createStreamWriter(sink, { encoding: 'UTF-16' });
    w.writeStartElement('a');
    w.flush();
    w.writeEndDocument();
    expect(Array.from(sink.toBytes())).toEqual([
      0xfe, 0xff, 0, 0x3c, 0, 0x61, 0, 0x3e, 0, 0x3c, 0, 0x2f, 0, 0x61, 0, 0x3e,
    ]);
  });

  it('writes no byte order mark for UTF-16 in a stated byte order', () => {
    expect([...writtenBytes((w) => w.writeEmptyElement('a'), { encoding: 'UTF-16BE' })]).toEqual([
      0, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e,
    ]);
  });

  it('writes nothing, not even a byte order mark, when nothing was written', () => {
    expect(writtenBytes(() => {}, { encoding: 'UTF-16' })).toEqual(new Uint8Array(0));
  });

  it.each([
    ['UTF-8', 'UTF-16'],
    ['UTF-8', 'ISO-8859-1'],
    ['ISO-8859-1', 'UTF-8'],
    ['UTF-16', 'UTF-16BE'],
  ])('refuses to declare a %s byte sink as %s, checks on or off', (encoding, declared) => {
    for (const checkWellFormedness of [true, false]) {
      expect(() =>
        writtenBytes((w) => w.writeStartDocument('1.0', declared), { encoding, checkWellFormedness })
      ).toThrow(expect.objectContaining({ code: 'WRITE_ENCODING' }));
    }
  });

  it('declares a byte sink by any name for its encoding, as given', () => {
    const bytes = writtenBytes(
      (w) => (
        w.writeStartDocument('1.0', 'latin1'),
        w.writeStartElement('a'),
        w.writeCharacters('é'),
        w.writeEndDocument()
      ),
      { encoding: 'ISO-8859-1' }
    );
    expect(new TextDecoder('latin1').decode(bytes)).toBe('<?xml version="1.0" encoding="latin1"?><a>é</a>');
    expect(canonical(bytes)).toBe('<a>é</a>');
    expect(new TextDecoder().decode(writtenBytes((w) => w.writeStartDocument('1.0', 'Utf-8')))).toBe(
      '<?xml version="1.0" encoding="Utf-8"?>'
    );
  });

  it('declares any encoding for a text sink, which has none of its own', () => {
    expect(written((w) => w.writeStartDocument('1.0', 'Shift_JIS'))).toBe('<?xml version="1.0" encoding="Shift_JIS"?>');
  });

  it('checks no encoding when the factory omits the declaration', () => {
    expect(writtenBytes((w) => w.writeStartDocument('1.0', 'UTF-16'), { omitXMLDeclaration: true })).toEqual(
      new Uint8Array(0)
    );
  });

  it('throws the WriterError of a character the encoder meets with the checks off', () => {
    expect(() =>
      writtenBytes(
        inRoot((w) => w.writeCharacters('\u{10000}'.slice(0, 1))),
        { encoding: 'ISO-8859-1', checkWellFormedness: false }
      )
    ).toThrow(WriterError);
  });
});
