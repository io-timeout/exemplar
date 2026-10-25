import { type Files, MAIN, XI, eventsAsync, factory, read } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@exemplarjs/canonical';
import { DocumentBuilder, type Element, XMLSerializer } from '@exemplarjs/dom';
import { SAXParser, type SAXHandler } from '@exemplarjs/sax';
import { EventType, XMLError, type XMLEvent } from '@exemplarjs/xml';
import { createFilteredReader } from '@exemplarjs/xml/filters';

const FILES: Files = {
  'file:///doc/book.xml':
    `<!DOCTYPE book [<!ENTITY title "The Book">]><book ${XI} xmlns:m="urn:meta" xml:lang="en">` +
    '<m:title>&title;</m:title><!--chapters--><xi:include href="chapters/one.xml"/>' +
    '<xi:include href="chapters/two.xml" xpointer="element(/1/2)"/>' +
    '<xi:include href="missing.xml"><xi:fallback><m:missing/></xi:fallback></xi:include>' +
    '<xi:include href="notes.txt" parse="text"/></book>',
  'file:///doc/chapters/one.xml': `<?xml version="1.0"?><?style sheet?><chapter xml:lang="fr"><p>Un</p><xi:include ${XI} href="../shared.xml"/></chapter>`,
  'file:///doc/chapters/two.xml':
    '<chapters><chapter>skipped</chapter><chapter xmlns="urn:two"><p>Two</p></chapter></chapters>',
  'file:///doc/shared.xml': '<shared>S</shared>',
  'file:///doc/notes.txt': 'Notes & <more>',
};

const SOURCE = { text: `<doc ${XI}><xi:include href="book.xml"/></doc>`, systemId: MAIN };

/** Adds text to an outline, merged with text just before it. */
function addText(outline: string[], text: string): void {
  if (outline.at(-1)?.startsWith('"') === true) outline.push(`${(outline.pop() as string).slice(0, -1)}${text}"`);
  else outline.push(`"${text}"`);
}

/** An outline of the document an event reader gives. */
function outlineOfEvents(events: Iterable<XMLEvent>): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (event.type === EventType.START_ELEMENT) {
      const attributes = event.attributes.map((a) => `${a.namespaceURI}|${a.localName}=${a.value}`).toSorted();
      out.push(`<${event.name.namespaceURI}|${event.name.localName} ${attributes.join(' ')}>`);
    }
    if (event.type === EventType.END_ELEMENT) out.push(`</${event.name.localName}>`);
    if (event.type === EventType.CHARACTERS) addText(out, event.text);
    if (event.type === EventType.COMMENT) out.push(`<!--${event.text}-->`);
    if (event.type === EventType.PROCESSING_INSTRUCTION) out.push(`<?${event.target} ${event.data}?>`);
  }
  return out;
}

/** A SAX handler that writes the same outline. */
function outlineHandler(out: string[]): SAXHandler {
  return {
    startElement: (uri, local, _q, attributes) => {
      const list: string[] = [];
      for (let i = 0; i < attributes.length; i++) {
        if (attributes.uri(i) !== 'http://www.w3.org/2000/xmlns/')
          list.push(`${attributes.uri(i)}|${attributes.localName(i)}=${attributes.value(i)}`);
      }
      out.push(`<${uri}|${local} ${list.toSorted().join(' ')}>`);
    },
    endElement: (_uri, local) => out.push(`</${local}>`),
    characters: (text) => addText(out, text),
    comment: (text) => out.push(`<!--${text}-->`),
    processingInstruction: (target, data) => out.push(`<?${target} ${data}?>`),
  };
}

describe('XInclude through every API', () => {
  const expected = [
    '<|doc >',
    '<|book http://www.w3.org/XML/1998/namespace|base=book.xml http://www.w3.org/XML/1998/namespace|lang=en>',
    '<urn:meta|title >',
    '"The Book"',
    '</title>',
    '<!--chapters-->',
    '<?style sheet?>',
    '<|chapter http://www.w3.org/XML/1998/namespace|base=chapters/one.xml http://www.w3.org/XML/1998/namespace|lang=fr>',
    '<|p >',
    '"Un"',
    '</p>',
    '<|shared http://www.w3.org/XML/1998/namespace|base=../shared.xml http://www.w3.org/XML/1998/namespace|lang=>',
    '"S"',
    '</shared>',
    '</chapter>',
    '<urn:two|chapter http://www.w3.org/XML/1998/namespace|base=chapters/two.xml http://www.w3.org/XML/1998/namespace|lang=>',
    '<urn:two|p >',
    '"Two"',
    '</p>',
    '</chapter>',
    '<urn:meta|missing >',
    '</missing>',
    '"Notes & <more>"',
    '</book>',
    '</doc>',
  ];

  it('gives the cursor the included documents, nested, with fallbacks and text', () => {
    const reader = factory(FILES).createStreamReader(SOURCE);
    expect(outlineOfEvents(factory(FILES).createEventReader(reader))).toEqual(expected);
  });

  it('gives event objects the same document', () => {
    expect(outlineOfEvents(factory(FILES).createEventReader(SOURCE))).toEqual(expected);
  });

  it('gives asynchronous event readers the same document, after resolvers that answer with promises', async () => {
    const events: XMLEvent[] = [];
    for await (const event of factory(FILES, { async: true }).createAsyncEventReader(SOURCE)) events.push(event);
    expect(outlineOfEvents(events)).toEqual(expected);
  });

  it('gives SAX the same document, synchronously and asynchronously', async () => {
    const sync: string[] = [];
    new SAXParser(factory(FILES)).parse(SOURCE, outlineHandler(sync));
    expect(sync).toEqual(expected);
    const async: string[] = [];
    await new SAXParser(factory(FILES, { async: true })).parseAsync(SOURCE, outlineHandler(async));
    expect(async).toEqual(expected);
  });

  it('builds the same DOM tree, without the xi: elements, synchronously and asynchronously', async () => {
    const doc = new DocumentBuilder(factory(FILES)).parse(SOURCE);
    const later = await new DocumentBuilder(factory(FILES, { async: true })).parseAsync(SOURCE);
    const c14n = canonicalize(doc, { method: 'exc-c14n', comments: true });
    expect(canonicalize(later, { method: 'exc-c14n', comments: true })).toBe(c14n);
    expect(c14n).toBe(canonicalize(factory(FILES).createStreamReader(SOURCE), { method: 'exc-c14n', comments: true }));
    expect(doc.getElementsByTagNameNS('http://www.w3.org/2001/XInclude', '*')).toHaveLength(0);
    const shared = doc.getElementsByTagName('shared').item(0) as Element;
    expect([shared.baseURI, shared.textContent]).toEqual(['file:///doc/shared.xml', 'S']);
  });

  it('serializes an included element with the namespaces it needs', () => {
    const doc = new DocumentBuilder(factory(FILES, { settings: { fixupBaseURIs: false, fixupLanguage: false } })).parse(
      {
        text: `<r xmlns="urn:r" ${XI}><xi:include href="chapters/two.xml" xpointer="element(/1/2)"/><xi:include href="shared.xml"/></r>`,
        systemId: MAIN,
      }
    );
    expect(new XMLSerializer().serializeToString(doc)).toBe(
      `<r xmlns="urn:r" ${XI}><chapter xmlns="urn:two"><p>Two</p></chapter><shared xmlns="">S</shared></r>`
    );
  });

  it('gives the location in the included document an event comes from', () => {
    const where: string[] = [];
    for (const event of factory(FILES).createEventReader(SOURCE)) {
      if (event.type === EventType.START_ELEMENT)
        where.push(`${event.name.localName} ${event.location.systemId} ${event.location.line}`);
    }
    expect(where.slice(0, 4)).toEqual([
      `doc ${MAIN} 1`,
      'book file:///doc/book.xml 1',
      'title file:///doc/book.xml 1',
      'chapter file:///doc/chapters/one.xml 1',
    ]);
    const reader = factory(FILES).createStreamReader(SOURCE);
    while (reader.next() !== EventType.START_ELEMENT || reader.localName() !== 'shared');
    expect(reader.location()).toEqual(
      expect.objectContaining({ systemId: 'file:///doc/shared.xml', line: 1, column: 1 })
    );
  });

  it('tells SAX of the entities included documents expand', () => {
    const entities: string[] = [];
    new SAXParser(factory(FILES)).parse(SOURCE, {
      startEntity: (name) => entities.push(name),
      endEntity: (name) => entities.push(`/${name}`),
    });
    expect(entities).toEqual(['title', '/title']);
  });

  it('gives the DOM document type the unparsed entities and notations included content names, by index too', () => {
    const files: Files = {
      'file:///doc/pic.xml':
        '<!DOCTYPE pic [<!NOTATION png SYSTEM "image/png"><!ENTITY logo SYSTEM "logo.png" NDATA png>' +
        '<!ATTLIST pic src ENTITY #REQUIRED>]><pic src="logo"/>',
    };
    const doctype = new DocumentBuilder(factory(files)).parse({
      text: `<doc ${XI}><xi:include href="pic.xml"/></doc>`,
      systemId: MAIN,
    }).doctype;
    expect([doctype?.entities.length, doctype?.entities[0]?.nodeName, doctype?.entities.item(0)?.nodeName]).toEqual([
      1,
      'logo',
      'logo',
    ]);
    expect([doctype?.notations.length, doctype?.notations[0]?.nodeName]).toEqual([1, 'png']);
  });

  it('keeps entity references the DOM is told to keep in included documents', () => {
    const doc = new DocumentBuilder(factory(FILES, { options: { replaceEntityReferences: false } })).parse(SOURCE);
    const title = doc.getElementsByTagNameNS('urn:meta', 'title').item(0) as Element;
    expect([title.firstChild?.nodeName, title.textContent]).toEqual(['title', 'The Book']);
  });

  it('shows a stream filter the event it is deciding on', () => {
    const reader = factory(FILES).createStreamReader(SOURCE);
    const filtered = createFilteredReader(
      reader,
      (r) => r.eventType() !== EventType.COMMENT && r.eventType() !== EventType.CHARACTERS
    );
    const names: string[] = [];
    for (let e = filtered.next(); e !== EventType.END_DOCUMENT; e = filtered.next()) {
      expect([EventType.COMMENT, EventType.CHARACTERS]).not.toContain(e);
      if (e === EventType.START_ELEMENT) names.push(filtered.localName());
    }
    expect(names).toEqual(['doc', 'book', 'title', 'chapter', 'p', 'shared', 'chapter', 'p', 'missing']);
  });

  it('fails every API with the same error', async () => {
    const files = { ...FILES, 'file:///doc/shared.xml': '<shared>' };
    const codes: string[] = [];
    const record = (error: unknown) => codes.push(error instanceof XMLError ? error.code : String(error));
    try {
      read(files, SOURCE.text);
    } catch (error) {
      record(error);
    }
    try {
      new DocumentBuilder(factory(files)).parse(SOURCE);
    } catch (error) {
      record(error);
    }
    try {
      new SAXParser(factory(files)).parse(SOURCE, {});
    } catch (error) {
      record(error);
    }
    await eventsAsync(factory(files, { async: true }).createAsyncStreamReader(SOURCE)).catch(record);
    expect(codes).toEqual(Array.from({ length: 4 }, () => 'WF_UNCLOSED_ELEMENT'));
  });

  it('reports a fatal XInclude error to the SAX error handler', () => {
    const fatal: string[] = [];
    expect(() =>
      new SAXParser(factory(FILES)).parse(
        { text: `<r ${XI}><xi:include href="none.xml"/></r>`, systemId: MAIN },
        { fatalError: (e) => fatal.push(e.code) }
      )
    ).toThrow(XMLError);
    expect(fatal).toEqual(['XINCLUDE_RESOURCE']);
  });
});
