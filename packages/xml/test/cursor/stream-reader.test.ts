import { cursor, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, type StreamReader, type XMLError, XMLInputFactory } from '@/index.ts';
import {
  DTD_COMPLETE,
  DTD_ITEMS,
  EVENT_OFFSET,
  INCLUDED_DECLARATIONS,
  INPUT_ENCODING,
  XML_ENCODING,
} from '@/internal.ts';

const encoder = new TextEncoder();

/** Lists the event types a document produces. */
function events(xml: string | Uint8Array, options: InputOptions = {}): EventType[] {
  const r = reader(xml, options);
  const out: EventType[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) out.push(e);
  return out;
}

/** Reads to the first event of a type. */
function at(xml: string, type: EventType, options: InputOptions = {}): StreamReader {
  const r = reader(xml, options);
  while (r.next() !== type);
  return r;
}

/** Every accessor that takes an attribute index. */
function attributeAccessors(r: StreamReader): ((index: number) => unknown)[] {
  return [
    (i) => r.attributeName(i),
    (i) => r.attributeLocalName(i),
    (i) => r.attributePrefix(i),
    (i) => r.attributeNamespace(i),
    (i) => r.attributeType(i),
    (i) => r.attributeValue(i),
    (i) => r.isAttributeSpecified(i),
  ];
}

/** The errors, warnings and fatal errors a document reports to a handler that lets parsing go on. */
function reported(xml: string | Uint8Array | { bytes: Uint8Array; encoding: string }, options: InputOptions = {}) {
  const seen: string[] = [];
  const errorHandler = {
    warning: (e: XMLError) => seen.push(`warning ${e.code}`),
    error: (e: XMLError) => seen.push(`error ${e.code}`),
    fatalError: (e: XMLError) => seen.push(`fatal ${e.code}`),
  };
  try {
    const r = new XMLInputFactory({ ...options, errorHandler }).createStreamReader(xml);
    while (r.next() !== EventType.END_DOCUMENT);
  } catch {
    seen.push('thrown');
  }
  return seen;
}

describe('events', () => {
  it('numbers its events as StAX does', () => {
    expect([EventType.START_ELEMENT, EventType.END_ELEMENT, EventType.CHARACTERS, EventType.END_DOCUMENT]).toEqual([
      1, 2, 4, 8,
    ]);
  });

  it('starts at START_DOCUMENT and ends at END_DOCUMENT', () => {
    const r = reader('<a/>');
    expect(r.eventType()).toBe(EventType.START_DOCUMENT);
    expect(r.hasNext()).toBe(true);
    expect([r.next(), r.next(), r.next()]).toEqual([1, 2, 8]);
    expect(r.hasNext()).toBe(false);
    expect(r.eventType()).toBe(EventType.END_DOCUMENT);
  });

  it('throws a plain Error, not an XMLError, when asked to read past END_DOCUMENT', () => {
    const r = reader('<a/>');
    while (r.next() !== EventType.END_DOCUMENT);
    expect(() => r.next()).toThrow('There are no more events');
    expect(() => r.next()).not.toThrow(expect.objectContaining({ code: expect.any(String) }));
  });

  it('gives an empty-element tag a start and an end event', () => {
    expect(events('<a><b/></a>')).toEqual([1, 1, 2, 2]);
  });

  it('reports comments, PIs, CDATA and the DOCTYPE', () => {
    expect(events('<!DOCTYPE a><a><!--c--><?p d?><![CDATA[x]]></a>')).toEqual([11, 1, 5, 3, 12, 2]);
  });

  it('reports comments and PIs before and after the root element', () => {
    expect(events('<!--a--><?p?><!DOCTYPE a><!--b--><a/><!--c--><?q?>')).toEqual([5, 3, 11, 5, 1, 2, 5, 3]);
  });

  it('skips whitespace outside the root unless reportPrologWhitespace is on (Woodstox P_REPORT_PROLOG_WHITESPACE)', () => {
    expect(events('\n<a/>\n')).toEqual([1, 2]);
    expect(events('\n<a/>\n', { reportPrologWhitespace: true })).toEqual([6, 1, 2, 6]);
    const r = at(' \t<a/>', EventType.SPACE, { reportPrologWhitespace: true });
    expect([r.text(), r.isWhitespace()]).toEqual([' \t', true]);
  });

  it('reports a reference to an entity whose declaration was not read as ENTITY_REFERENCE', () => {
    const r = reader('<!DOCTYPE a SYSTEM "a.dtd"><a>x&e;y</a>');
    const seen: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      seen.push(e === EventType.ENTITY_REFERENCE ? `&${r.name()};` : `${e}:${r.text()}`);
    }
    expect(seen).toEqual(['11:<!DOCTYPE a SYSTEM "a.dtd">', '1:', '4:x', '&e;', '4:y', '2:']);
  });

  it('delivers character data around predefined references as one event', () => {
    const r = reader('<a>x&amp;y&#65;z</a>');
    r.next();
    expect([r.next(), r.text()]).toEqual([EventType.CHARACTERS, 'x&yAz']);
  });

  it('refuses a DOCTYPE when disallowDoctype is on (Xerces disallow-doctype-decl)', () => {
    expect(() => parseEveryWay('<!DOCTYPE a><a/>', { disallowDoctype: true })).toThrow(
      expect.objectContaining({ code: 'DOCTYPE_DISALLOWED', line: 1, column: 1 })
    );
    expect(parseEveryWay('<a/>', { disallowDoctype: true })).toBe('<a></a>');
  });

  it('rejects a PI target with a colon only when namespace-aware (Namespaces §7)', () => {
    expect(() => events('<a><?p:q d?></a>')).toThrow(expect.objectContaining({ code: 'NS_COLON', column: 4 }));
    expect(events('<a><?p:q d?></a>', { namespaceAware: false })).toEqual([1, 3, 2]);
  });

  it('rejects CDATA outside the root element (§2.1 [1], [27])', () => {
    expect(() => events('<![CDATA[x]]><a/>')).toThrow(expect.objectContaining({ code: 'WF_CONTENT_OUTSIDE_ROOT' }));
    expect(() => events('<a/><![CDATA[x]]>')).toThrow(expect.objectContaining({ code: 'WF_CONTENT_OUTSIDE_ROOT' }));
  });

  it('rejects an attribute repeated in the last place of a start tag of any length (WFC: Unique Att Spec)', () => {
    const options = { limits: { attributesPerElement: 300 } };
    for (const count of [2, 15, 16, 17, 32, 64, 256]) {
      const attributes = Array.from({ length: count - 1 }, (_, i) => ` a${i}="1"`).join('');
      expect(() => events(`<e${attributes} a${count - 2}="2"/>`, options)).toThrow(
        expect.objectContaining({ code: 'WF_DUPLICATE_ATTRIBUTE' })
      );
      expect(events(`<e${attributes} b="2"/>`, options)).toEqual([1, 2]);
    }
  });

  it('skips the structural checks when checkWellFormedness is off', () => {
    expect(events('<a x="1" x="2"></b>', { checkWellFormedness: false })).toEqual([1, 2]);
  });

  it('close() releases nothing, as in StAX', () => {
    const r = reader('<a/>');
    while (r.next() !== EventType.END_DOCUMENT);
    expect(() => r.close()).not.toThrow();
  });

  it('close() leaves the reader as it was, so an empty-element tag still ends', () => {
    const r = reader('<a/>');
    r.next();
    r.close();
    expect([r.eventType(), r.next(), r.next()]).toEqual([
      EventType.START_ELEMENT,
      EventType.END_ELEMENT,
      EventType.END_DOCUMENT,
    ]);
  });
});

describe('accessors', () => {
  it('give an element name at its start and end', () => {
    const r = reader('<a><b/></a>');
    const names: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) names.push(`${e}${r.name()}`);
    expect(names).toEqual(['1a', '1b', '2b', '2a']);
  });

  it('give the local name at an end tag without asking for the qualified name first', () => {
    const r = reader('<p:a xmlns:p="u"><b></b></p:a>');
    const locals: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.END_ELEMENT) locals.push(r.localName());
    }
    expect(locals).toEqual(['b', 'a']);
    const plain = reader('<p:a></p:a>', { namespaceAware: false });
    plain.next();
    expect([plain.next(), plain.localName(), plain.prefix()]).toEqual([EventType.END_ELEMENT, 'p:a', '']);
  });

  it('give the local name at a start tag whose name was already asked for', () => {
    const r = reader('<p:a xmlns:p="u"/>');
    r.next();
    expect([r.name(), r.localName(), r.prefix()]).toEqual(['p:a', 'a', 'p']);
  });

  it('give no names, namespaces or attributes for events that are not tags', () => {
    const r = at('<a x="1"><?p d?></a>', EventType.PROCESSING_INSTRUCTION);
    expect([r.name(), r.localName(), r.prefix(), r.namespaceURI(), r.namespaceCount(), r.attributeCount()]).toEqual([
      '',
      '',
      '',
      '',
      0,
      0,
    ]);
    const start = reader('<a/>');
    expect([start.name(), start.text(), start.isWhitespace()]).toEqual(['', '', false]);
  });

  it('give attribute values by index and by name', () => {
    const r = reader('<a x="1" y="&lt;2&gt;"/>');
    r.next();
    expect([r.attributeCount(), r.attributeValue(0), r.attributeValue(1), r.attributeValue('', 'y')]).toEqual([
      2,
      '1',
      '<2>',
      '<2>',
    ]);
    expect([r.attributeType(0), r.isAttributeSpecified(0)]).toEqual(['CDATA', true]);
    expect([r.attributeValue('', 'z'), r.attributeValue('urn:x', 'x')]).toEqual([undefined, undefined]);
    r.next();
    expect(r.attributeCount()).toBe(0);
  });

  it('give attribute names, local names, prefixes and namespaces', () => {
    const r = reader('<a xmlns:p="urn:p" p:x="1" y="2"/>');
    r.next();
    const attributes = Array.from({ length: r.attributeCount() }, (_, i) => [
      r.attributeName(i),
      r.attributeLocalName(i),
      r.attributePrefix(i),
      r.attributeNamespace(i),
    ]);
    expect(attributes).toEqual([
      ['p:x', 'x', 'p', 'urn:p'],
      ['y', 'y', '', ''],
    ]);
    expect(r.attributeValue('urn:p', 'x')).toBe('1');
  });

  it('throw a RangeError for an attribute index that is not an integer below attributeCount()', () => {
    const cases: [string, InputOptions][] = [
      ['<a x="1"/>', {}],
      ['<a xmlns:p="u" x="1"/>', {}],
      ['<!DOCTYPE a [<!ATTLIST a x CDATA #IMPLIED>]><a xmlns:p="u" x="1"/>', {}],
      ['<a xmlns:p="u" x="1"/>', { namespaceAware: false }],
    ];
    for (const [xml, options] of cases) {
      const r = at(xml, EventType.START_ELEMENT, options);
      const count = r.attributeCount();
      expect(r.attributeName(count - 1)).not.toBe('');
      for (const index of [count, count + 1, 100, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32]) {
        for (const get of attributeAccessors(r)) expect(() => get(index), `${xml} at ${index}`).toThrow(RangeError);
      }
    }
  });

  it('throw a RangeError for every attribute index at events other than START_ELEMENT', () => {
    const r = reader('<a x="1"><?p d?><b y="2"/></a>');
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.START_ELEMENT) continue;
      for (const get of attributeAccessors(r)) expect(() => get(0), `at event ${e}`).toThrow(RangeError);
    }
    for (const get of attributeAccessors(reader('<a x="1"/>'))) expect(() => get(0)).toThrow(RangeError);
  });

  it('throw a RangeError for a namespace index that is not an integer below namespaceCount()', () => {
    const r = reader('<a xmlns="d" xmlns:p="u"><?p d?></a>');
    r.next();
    expect([r.namespacePrefix(1), r.namespaceURI(1)]).toEqual(['p', 'u']);
    for (const index of [2, -1, 0.5, Number.NaN]) {
      expect(() => r.namespacePrefix(index)).toThrow(RangeError);
      expect(() => r.namespaceURI(index)).toThrow(RangeError);
    }
    r.next();
    expect(() => r.namespacePrefix(0)).toThrow(RangeError);
    expect(() => r.namespaceURI(0)).toThrow(RangeError);
    expect([r.next(), r.namespacePrefix(1), r.namespaceURI(1)]).toEqual([EventType.END_ELEMENT, 'p', 'u']);
    expect(() => r.namespaceURI(2)).toThrow(RangeError);
  });

  it('give PI targets and data, the data starting after the whitespace that follows the target (§2.6)', () => {
    const r = reader('<a><?target  some data ?></a>');
    r.next();
    r.next();
    expect([r.piTarget(), r.piData()]).toEqual(['target', 'some data ']);
  });

  it('give a PI with no data an empty string', () => {
    const r = at('<a><?p?></a>', EventType.PROCESSING_INSTRUCTION);
    expect([r.piTarget(), r.piData()]).toEqual(['p', '']);
  });

  it('normalize line ends in PI data (§2.11)', () => {
    expect(at('<a><?p x\r\ny\rz?></a>', EventType.PROCESSING_INSTRUCTION).piData()).toBe('x\ny\nz');
  });

  it('tell whitespace-only character data', () => {
    const r = reader('<a> \n<b>x</b></a>');
    r.next();
    r.next();
    expect(r.isWhitespace()).toBe(true);
    r.next();
    r.next();
    expect(r.isWhitespace()).toBe(false);
  });

  it('tell whitespace-only text that came from an entity', () => {
    const r = at('<!DOCTYPE a [<!ENTITY s "  "><!ENTITY t "x">]><a>&s;&t;</a>', EventType.CHARACTERS);
    expect([r.text(), r.isWhitespace()]).toEqual(['  ', true]);
    expect([r.next(), r.isWhitespace()]).toEqual([EventType.CHARACTERS, false]);
  });

  it('give a comment text and the document type', () => {
    const r = reader('<!DOCTYPE a SYSTEM "a.dtd"><a><!-- note --></a>');
    expect(r.next()).toBe(EventType.DTD);
    expect(r.doctype()).toEqual({
      name: 'a',
      systemId: 'a.dtd',
      entities: [],
      notations: [],
      processingInstructions: [],
    });
    r.next();
    r.next();
    expect(r.text()).toBe(' note ');
  });

  it('give the DOCTYPE as written for the DTD event, with its public id and internal subset', () => {
    const xml = '<!DOCTYPE a PUBLIC "-//A//EN" "a.dtd" [<!ENTITY e "x">]><a/>';
    const r = at(xml, EventType.DTD);
    expect(r.text()).toBe('<!DOCTYPE a PUBLIC "-//A//EN" "a.dtd" [<!ENTITY e "x">]>');
    expect(r.doctype()).toMatchObject({
      name: 'a',
      publicId: '-//A//EN',
      systemId: 'a.dtd',
      internalSubset: '<!ENTITY e "x">',
    });
  });

  it('give the declarations a DTD made before a fatal error in it', () => {
    const r = reader('<!DOCTYPE a [<!ENTITY e "x"><!ELEMENT>]><a/>');
    expect(() => r.next()).toThrow(expect.objectContaining({ code: 'WF_DECLARATION' }));
    expect(r.doctype().entities.map((entity) => entity.name)).toEqual(['e']);
  });

  it('give the version, encoding and standalone of the XML declaration', () => {
    const r = reader('<?xml version="1.0" encoding="UTF-8" standalone="no"?><a/>');
    expect([r.version(), r.encoding(), r.standalone()]).toEqual(['1.0', 'UTF-8', false]);
    const none = reader('<a/>');
    expect([none.version(), none.encoding(), none.standalone()]).toEqual([undefined, undefined, undefined]);
  });

  it('give the encoding detection chose when bytes have no declaration', () => {
    const r = reader(encoder.encode('<a/>'));
    expect(r.encoding()).toBe('utf-8');
  });

  it('keep names right when a long document is read in small chunks', () => {
    const inner = Array.from({ length: 200 }, (_, i) => `<n${i}>text ${i}</n${i}>`).join('');
    const xml = `<root>${inner}</root>`;
    const bytes = encoder.encode(xml);
    const chunks = (function* () {
      for (let i = 0; i < bytes.length; i += 5) yield bytes.subarray(i, i + 5);
    })();
    let last = '';
    const r = reader(chunks);
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) if (e === EventType.END_ELEMENT) last = r.name();
    expect(last).toBe('root');
  });

  it('keep the open elements and namespaces right while chunks are dropped under deep nesting', () => {
    const depth = 60;
    const open = Array.from({ length: depth }, (_, i) => `<p${i}:e${i} xmlns:p${i}="urn:${i}">`).join('');
    const close = Array.from({ length: depth }, (_, i) => `</p${depth - 1 - i}:e${depth - 1 - i}>`).join('');
    const xml = `${open}${'x'.repeat(5000)}${close}`;
    const bytes = encoder.encode(xml);
    const chunks = (function* () {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
    })();
    const r = reader(chunks);
    const ends: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.END_ELEMENT) ends.push(`${r.namespaceURI()} ${r.name()}`);
    }
    expect(ends[0]).toBe(`urn:${depth - 1} p${depth - 1}:e${depth - 1}`);
    expect(ends.at(-1)).toBe('urn:0 p0:e0');
  });
});

describe('copyStrings', () => {
  it('returns equal strings from every accessor', () => {
    const long = 'a long attribute value';
    const xml = `<p:element-name xmlns:p="urn:a-long-namespace-name" p:attribute-name="${long}">${long}<?target-name ${long}?></p:element-name>`;
    const plain = reader(xml);
    const copying = reader(xml, { copyStrings: true });
    /** Every string the accessors give for each event. */
    const read = (r: StreamReader) => {
      const out: string[] = [];
      for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
        out.push(r.name(), r.localName(), r.prefix(), r.namespaceURI(), r.text());
        if (e === EventType.START_ELEMENT) {
          out.push(
            r.namespacePrefix(0),
            r.namespaceURI(0),
            r.attributeName(0),
            r.attributeLocalName(0),
            r.attributePrefix(0),
            r.attributeNamespace(0),
            r.attributeValue(0)
          );
        }
        if (e === EventType.PROCESSING_INSTRUCTION) out.push(r.piTarget(), r.piData());
      }
      return out;
    };
    expect(read(copying)).toEqual(read(plain));
  });
});

describe('nextTag and elementText (StAX)', () => {
  it('skips whitespace, comments and PIs to the next tag', () => {
    const r = reader('<a>\n <!--c--> <?p?>\n<b/></a>');
    expect([r.nextTag(), r.name()]).toEqual([EventType.START_ELEMENT, 'a']);
    expect([r.nextTag(), r.name()]).toEqual([EventType.START_ELEMENT, 'b']);
    expect([r.nextTag(), r.nextTag()]).toEqual([EventType.END_ELEMENT, EventType.END_ELEMENT]);
  });

  it('skips whitespace reported as SPACE', () => {
    const r = reader(' <a/>', { reportPrologWhitespace: true });
    expect([r.nextTag(), r.name()]).toEqual([EventType.START_ELEMENT, 'a']);
  });

  it('fails on character data that is not whitespace', () => {
    const r = reader('<a>x<b/></a>');
    r.nextTag();
    expect(() => r.nextTag()).toThrow('Expected a start or end tag');
  });

  it('fails at the end of the document', () => {
    const r = reader('<a/>');
    r.nextTag();
    r.nextTag();
    expect(() => r.nextTag()).toThrow('Expected a start or end tag');
  });

  it('reads a text-only element to its end tag', () => {
    const r = reader('<a>x&amp;<![CDATA[y]]><!--c--><?p?>z</a>');
    r.next();
    expect(r.elementText()).toBe('x&yz');
    expect(r.eventType()).toBe(EventType.END_ELEMENT);
  });

  it('reads an empty element as the empty string', () => {
    const r = reader('<a/>');
    r.next();
    expect(r.elementText()).toBe('');
  });

  it('refuses an element with a child', () => {
    const r = reader('<a>x<b/></a>');
    r.next();
    expect(() => r.elementText()).toThrow('elementText() found a child element');
  });

  it('needs a START_ELEMENT', () => {
    expect(() => reader('<a/>').elementText()).toThrow('elementText() needs a START_ELEMENT');
  });
});

describe('error handling (§1.2, SAX ErrorHandler)', () => {
  it('tells the error handler of a fatal error before throwing it', () => {
    expect(reported('<a></b>')).toEqual(['fatal WF_END_TAG_MISMATCH', 'thrown']);
  });

  it('tells the error handler of a fatal error in the XML declaration, found by the constructor', () => {
    expect(reported('<?xml version="2.0"?><a/>')).toEqual(['fatal WF_XML_DECLARATION', 'thrown']);
  });

  it('lets a handler that returns from error() go on parsing', () => {
    expect(reported('<!DOCTYPE a [%p;]><a/>')).toEqual(['error VC_ENTITY_DECLARED']);
  });

  it('reports a UTF-16 document declared as UTF-16 without a byte-order mark as an error (§4.3.3)', () => {
    const text = '<?xml version="1.0" encoding="UTF-16"?><a/>';
    const bytes = new Uint8Array(Array.from({ length: text.length }, (_, i) => [text.charCodeAt(i), 0]).flat());
    expect(reported(bytes)).toEqual(['error ENCODING_UTF16_WITHOUT_BOM']);
  });

  it('warns when an encoding given from outside overrides the declared one (RFC 7303 §3.2)', () => {
    const bytes = encoder.encode('<?xml version="1.0" encoding="UTF-8"?><a/>');
    expect(reported({ bytes, encoding: 'ISO-8859-1' })).toEqual(['warning ENCODING_CONFLICT']);
  });

  it('reports an unsupported encoding at the start of the document', () => {
    const bytes = encoder.encode('<?xml version="1.0" encoding="x-unknown"?><a/>');
    expect(() => reader(bytes)).toThrow(expect.objectContaining({ code: 'ENCODING_UNSUPPORTED', line: 1, column: 1 }));
  });

  it('reports bytes that are not legal in their encoding where they are', () => {
    const bytes = new Uint8Array([...encoder.encode('<a>\nx'), 0xc0, ...encoder.encode('</a>')]);
    expect(() => events(bytes)).toThrow(
      expect.objectContaining({ code: 'ENCODING_INVALID_BYTES', line: 2, column: 2 })
    );
  });

  it('rejects a document whose declared encoding contradicts its byte-order mark (§4.3.3)', () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'),
    ]);
    expect(reported(bytes)).toEqual(['fatal ENCODING_MISMATCH', 'thrown']);
  });

  it.each([
    ['an end tag that does not match', '<r/></r>', 'r', '', ''],
    ['the end of the input', '<r><a/>', 'a', '', ''],
    ['a second root element', '<r/><s/>', 'r', '', ''],
    ['an end tag after an element that declared its prefix', '<r><p:a xmlns:p="urn:p"/></x>', 'a', 'p', 'urn:p'],
    ['an end tag after an element in the default namespace', '<r xmlns="urn:d"><a/></x>', 'a', '', 'urn:d'],
  ])('stays at the end tag it reported last when %s fails the next call (StAX)', (_case, xml, local, prefix, uri) => {
    const r = reader(xml);
    expect(() => {
      for (;;) r.next();
    }).toThrow(expect.objectContaining({ code: expect.stringMatching(/^WF_/) }));
    expect([r.eventType(), r.localName(), r.name(), r.prefix(), r.namespaceURI()]).toEqual([
      EventType.END_ELEMENT,
      local,
      prefix === '' ? local : `${prefix}:${local}`,
      prefix,
      uri,
    ]);
  });

  it('is at the element of a start tag that fails after an end tag, as the JDK is', () => {
    const r = reader('<r><a/><b x="1" x="2"/></r>');
    expect(() => {
      for (;;) r.next();
    }).toThrow(expect.objectContaining({ code: expect.stringMatching(/^WF_/) }));
    expect([r.eventType(), r.localName()]).toEqual([EventType.END_ELEMENT, 'b']);
  });

  it('passes on errors that are not XML errors, such as a resolver that throws', () => {
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: {
        resolveEntity: () => {
          throw new RangeError('boom');
        },
      },
    };
    expect(() => events('<!DOCTYPE a SYSTEM "a.dtd"><a/>', options)).toThrow(RangeError);
  });
});

describe('checkNormalization (XML 1.1 §2.13, DOM check-character-normalization)', () => {
  const xml = '<?xml version="1.1"?><a>e\u0301<b>\u0301x</b>e\u0301</a>';

  it('warns once that an XML 1.1 document is not fully normalized', () => {
    expect(reported(xml, { checkNormalization: true })).toEqual(['warning NOT_FULLY_NORMALIZED']);
  });

  it('warns of text that starts with a combining character', () => {
    expect(reported('<?xml version="1.1"?><a>\u0301</a>', { checkNormalization: true })).toEqual([
      'warning NOT_FULLY_NORMALIZED',
    ]);
  });

  it("checks the text after a reference that is not replaced, not the entity's replacement text", () => {
    const doc = '<?xml version="1.1"?><!DOCTYPE a [<!ENTITY e "x">]><a>&e;\u0301b</a>';
    expect(reported(doc, { checkNormalization: true, replaceEntityReferences: false })).toEqual([
      'warning NOT_FULLY_NORMALIZED',
    ]);
  });

  it('says nothing when off, for normalized text, or for XML 1.0', () => {
    expect(reported(xml)).toEqual([]);
    expect(reported('<?xml version="1.1"?><a>é</a>', { checkNormalization: true })).toEqual([]);
    expect(reported('<a>e\u0301</a>', { checkNormalization: true })).toEqual([]);
  });
});

describe('internal hooks', () => {
  it('give the document offset of the current event', () => {
    const r = cursor('<a>\n<b/></a>');
    const offsets: number[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) offsets.push(r[EVENT_OFFSET]);
    expect(offsets).toEqual([0, 3, 4, 4, 8]);
  });

  it('give the encoding detection chose and the one the declaration names', () => {
    const bytes = cursor(encoder.encode('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'));
    expect([bytes[INPUT_ENCODING], bytes[XML_ENCODING]]).toEqual(['iso-8859-1', 'ISO-8859-1']);
    const text = cursor('<a/>');
    expect([text[INPUT_ENCODING], text[XML_ENCODING]]).toEqual([undefined, undefined]);
  });

  it('say whether every declaration the DTD refers to was read', () => {
    const dtdComplete = (xml: string): boolean => {
      const r = cursor(xml);
      while (r.next() !== EventType.DTD);
      return r[DTD_COMPLETE];
    };
    expect(dtdComplete('<!DOCTYPE a [<!ENTITY e "x">]><a/>')).toBe(true);
    expect(dtdComplete('<!DOCTYPE a SYSTEM "a.dtd"><a/>')).toBe(false);
    expect(cursor('<a/>')[DTD_COMPLETE]).toBe(true);
  });

  it('give what the DTD held, in order, for SAX', () => {
    const r = at('<!DOCTYPE a [<!--c--><?p d?><!ELEMENT a ANY>]><a/>', EventType.DTD);
    expect(r[DTD_ITEMS]().map((item) => item.kind)).toEqual(['comment', 'pi', 'element']);
    expect(reader('<a/>')[DTD_ITEMS]()).toEqual([]);
  });

  it('give no included declarations, which only XInclude adds', () => {
    expect(reader('<a/>')[INCLUDED_DECLARATIONS]()).toEqual([]);
  });
});
