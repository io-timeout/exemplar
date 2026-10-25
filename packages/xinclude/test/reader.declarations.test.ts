import { type Files, MAIN, XI, factory, failure } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import { DocumentBuilder } from '@exemplarjs/dom';
import { SAXParser } from '@exemplarjs/sax';
import { type DtdItem, EventType } from '@exemplarjs/xml';
import { INCLUDED_DECLARATIONS } from '@exemplarjs/xml/internal';

const PIC =
  '<!DOCTYPE pic [<!NOTATION gif SYSTEM "image/gif"><!ENTITY logo SYSTEM "logo.gif" NDATA gif>' +
  '<!ATTLIST pic src ENTITY #IMPLIED>]><pic src="logo"/>';

const FILES: Files = {
  'file:///doc/pic.xml': PIC,
  'file:///doc/same.xml': PIC,
  'file:///doc/other-system.xml': PIC.replace('logo.gif', 'other.gif'),
  'file:///doc/other-public.xml': PIC.replace('SYSTEM "logo.gif"', 'PUBLIC "-//X//Logo//EN" "logo.gif"'),
  'file:///doc/other-notation.xml':
    '<!DOCTYPE pic [<!NOTATION gif SYSTEM "image/gif"><!NOTATION png SYSTEM "image/png">' +
    '<!ENTITY logo SYSTEM "logo.gif" NDATA png><!ATTLIST pic src ENTITY #IMPLIED>]><pic src="logo"/>',
  'file:///doc/gallery.xml':
    '<!DOCTYPE g [<!NOTATION gif SYSTEM "image/gif"><!NOTATION png PUBLIC "-//X//PNG//EN">' +
    '<!ENTITY a SYSTEM "a.gif" NDATA gif><!ENTITY b SYSTEM "b.png" NDATA png>' +
    '<!ATTLIST g all ENTITIES #IMPLIED kind NOTATION (gif|png) #IMPLIED>]><g all="a b" kind="png"/>',
  'file:///doc/notation.xml':
    '<!DOCTYPE n [<!NOTATION png SYSTEM "other/png"><!ATTLIST n kind NOTATION (png) #IMPLIED>]><n kind="png"/>',
  'file:///doc/no-notation.xml': '<!DOCTYPE n [<!ATTLIST n kind NOTATION (png) #IMPLIED>]><n kind="png"/>',
  'file:///doc/undeclared.xml': '<!DOCTYPE u [<!ATTLIST u src ENTITY #IMPLIED>]><u src="nothing"/>',
  'file:///doc/outer.xml': `<o ${XI}><xi:include href="pic.xml"/></o>`,
  'file:///doc/a/pic.xml': PIC,
  'file:///doc/b/pic.xml': PIC,
  'file:///doc/a-logo.xml': PIC.replace('"logo.gif"', '"a/logo.gif"').replace('"image/gif"', '"a/image/gif"'),
  'file:///doc/a/n.xml':
    '<!DOCTYPE n [<!NOTATION v SYSTEM "viewer"><!ATTLIST n kind NOTATION (v) #IMPLIED>]><n kind="v"/>',
  'file:///doc/b/n.xml':
    '<!DOCTYPE n [<!NOTATION v SYSTEM "viewer"><!ATTLIST n kind NOTATION (v) #IMPLIED>]><n kind="v"/>',
};

/** The declarations a reader has brought in from included content, once the document is read. */
function brought(main: string): string[] {
  const reader = factory(FILES).createStreamReader({ text: main, systemId: MAIN });
  while (reader.next() !== EventType.END_DOCUMENT);
  return reader[INCLUDED_DECLARATIONS]().map((item: DtdItem) => {
    if (item.kind === 'entity') return `entity ${item.declaration.name} ${item.declaration.notation}`;
    if (item.kind === 'notation') return `notation ${item.declaration.name}`;
    return item.kind;
  });
}

describe('unparsed entities (XInclude §4.5.1) and notations (§4.5.2)', () => {
  it('brings in the unparsed entity an ENTITY attribute names, with its notation', () => {
    expect(brought(`<r ${XI}><xi:include href="pic.xml"/></r>`)).toEqual(['entity logo gif', 'notation gif']);
  });

  it('brings in every entity an ENTITIES attribute names, and the notation a NOTATION attribute names', () => {
    expect(brought(`<r ${XI}><xi:include href="gallery.xml"/></r>`)).toEqual([
      'entity a gif',
      'notation gif',
      'entity b png',
      'notation png',
    ]);
  });

  it('merges a declaration included twice into one', () => {
    expect(brought(`<r ${XI}><xi:include href="pic.xml"/><xi:include href="same.xml"/></r>`)).toEqual([
      'entity logo gif',
      'notation gif',
    ]);
  });

  it('brings in nothing the including document already declares the same way', () => {
    const main = `<!DOCTYPE r [<!NOTATION gif SYSTEM "image/gif"><!ENTITY logo SYSTEM "logo.gif" NDATA gif>]><r ${XI}><xi:include href="pic.xml"/></r>`;
    expect(brought(main)).toEqual([]);
  });

  it('brings in the declarations of nested inclusions', () => {
    expect(brought(`<r ${XI}><xi:include href="outer.xml"/></r>`)).toEqual(['entity logo gif', 'notation gif']);
  });

  it('brings in nothing for a name the included document does not declare', () => {
    expect(brought(`<r ${XI}><xi:include href="undeclared.xml"/></r>`)).toEqual([]);
    expect(brought(`<r ${XI}><xi:include href="no-notation.xml"/></r>`)).toEqual([]);
  });

  it('brings in nothing for elements a pointer passes over', () => {
    const files = {
      ...FILES,
      'file:///doc/wrap.xml': PIC.replace('<pic src="logo"/>', '<pic><x/><pic src="logo"/></pic>'),
    };
    const reader = factory(files).createStreamReader({
      text: `<r ${XI}><xi:include href="wrap.xml" xpointer="element(/1/1)"/></r>`,
      systemId: MAIN,
    });
    while (reader.next() !== EventType.END_DOCUMENT);
    expect(reader[INCLUDED_DECLARATIONS]()).toEqual([]);
  });

  it.each([
    ['a different system identifier', 'other-system.xml'],
    ['a different public identifier', 'other-public.xml'],
    ['a different notation', 'other-notation.xml'],
  ])('fails with XINCLUDE_DECLARATION on an unparsed entity declared with %s', (_what, href) => {
    expect(failure(FILES, `<r ${XI}><xi:include href="pic.xml"/><xi:include href="${href}"/></r>`)).toBe(
      'XINCLUDE_DECLARATION'
    );
  });

  it('fails with XINCLUDE_DECLARATION on declarations written alike whose system identifiers resolve apart', () => {
    expect(failure(FILES, `<r ${XI}><xi:include href="a/pic.xml"/><xi:include href="b/pic.xml"/></r>`)).toBe(
      'XINCLUDE_DECLARATION'
    );
    expect(failure(FILES, `<r ${XI}><xi:include href="a/n.xml"/><xi:include href="b/n.xml"/></r>`)).toBe(
      'XINCLUDE_DECLARATION'
    );
  });

  it('merges declarations written apart whose system identifiers resolve alike', () => {
    expect(brought(`<r ${XI}><xi:include href="a/pic.xml"/><xi:include href="a-logo.xml"/></r>`)).toEqual([
      'entity logo gif',
      'notation gif',
    ]);
    expect(brought(`<r ${XI}><xi:include href="a/n.xml"/><xi:include href="a/n.xml"/></r>`)).toEqual(['notation v']);
  });

  it('brings in nothing for its own declarations in a document with no base URI to resolve them against', () => {
    const main = PIC.replace(
      '<pic src="logo"/>',
      `<r ${XI}><pic src="logo" xml:id="p"/><xi:include xpointer="p"/></r>`
    );
    const reader = factory(FILES).createStreamReader(main);
    let pics = 0;
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next())
      if (e === EventType.START_ELEMENT && reader.localName() === 'pic') pics++;
    expect([pics, reader[INCLUDED_DECLARATIONS]()]).toEqual([2, []]);
  });

  it('fails with XINCLUDE_DECLARATION on a notation declared differently', () => {
    expect(failure(FILES, `<r ${XI}><xi:include href="gallery.xml"/><xi:include href="notation.xml"/></r>`)).toBe(
      'XINCLUDE_DECLARATION'
    );
    const main = `<!DOCTYPE r [<!NOTATION gif SYSTEM "other/gif">]><r ${XI}><xi:include href="pic.xml"/></r>`;
    expect(failure(FILES, main)).toBe('XINCLUDE_DECLARATION');
  });

  it('adds them to the DOM’s document type', () => {
    const doc = new DocumentBuilder(factory(FILES)).parse({
      text: `<r ${XI}><xi:include href="pic.xml"/></r>`,
      systemId: MAIN,
    });
    expect([doc.doctype?.entities.item(0)?.nodeName, doc.doctype?.notations.item(0)?.nodeName]).toEqual([
      'logo',
      'gif',
    ]);
  });

  it('reports them to SAX before the start tag that names them', () => {
    const seen: string[] = [];
    new SAXParser(factory(FILES)).parse(
      { text: `<r ${XI}><xi:include href="pic.xml"/></r>`, systemId: MAIN },
      {
        startElement: (_uri, local) => seen.push(local),
        unparsedEntityDecl: (name, _publicId, systemId, notation) => seen.push(`${name} ${systemId} ${notation}`),
        notationDecl: (name) => seen.push(name),
      }
    );
    expect(seen).toEqual(['r', 'logo file:///doc/logo.gif gif', 'gif', 'pic']);
  });
});
