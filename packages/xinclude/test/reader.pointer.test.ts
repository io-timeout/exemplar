import { type Files, MAIN, XI, factory, failure, included, read } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import type { InputOptions, ResolveRequest, ResolvedSource } from '@exemplarjs/xml';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';
import { xincludeProcessor } from '@/index.ts';

const FILES: Files = {
  'file:///doc/part.xml':
    '<!--c--><part><p xml:id="a">A</p><p>B<q xml:id="q">Q</q></p><p xml:id="z">Z</p></part><!--d-->',
  'file:///doc/twice.xml': '<t><u xml:id="a">first</u><u xml:id="a">second</u></t>',
  'file:///doc/dtd.xml':
    '<!DOCTYPE d [<!ATTLIST e key ID #IMPLIED>]><d><e key="one">1</e><e key="two">2<f/><f>F</f></e></d>',
  'file:///doc/external.xml': '<!DOCTYPE d SYSTEM "ids.dtd"><d><e key="k">K</e></d>',
  'file:///doc/ids.dtd': '<!ATTLIST e key ID #IMPLIED>',
  'file:///doc/nested.xml': `<n ${XI}><xi:include href="part.xml" xpointer="q"/><m xml:id="m"/></n>`,
};

/** The document read from MAIN, without the fix-ups, so that only what is selected shows. */
function plain(main: string, files: Files = FILES, options: InputOptions = {}): string {
  return read(files, main, { settings: { fixupBaseURIs: false, fixupLanguage: false }, options });
}

describe('XPointer element() scheme (XPointer element() §3)', () => {
  it.each([
    ['element(/1)', '<part><p xml:id="a">A</p><p>B<q xml:id="q">Q</q></p><p xml:id="z">Z</p></part>'],
    ['element(/1/2)', '<p>B<q xml:id="q">Q</q></p>'],
    ['element(/1/2/1)', '<q xml:id="q">Q</q>'],
    ['element(q)', '<q xml:id="q">Q</q>'],
    ['element(a/1)', ''],
  ])('selects by child sequence and ID with %s', (pointer, selected) => {
    const main = `<r ${XI}><xi:include href="part.xml" xpointer="${pointer}"><xi:fallback/></xi:include></r>`;
    expect(plain(main)).toBe(`<r ${XI}>${selected}</r>`);
  });

  it('passes over the comments and PIs outside the selected element', () => {
    expect(plain(`<r ${XI}><xi:include href="part.xml" xpointer="element(/1/1)"/></r>`)).toBe(
      `<r ${XI}><p xml:id="a">A</p></r>`
    );
  });
});

describe('shorthand pointers (XPointer Framework §3.2)', () => {
  it('selects the element whose xml:id matches', () => {
    expect(plain(`<r ${XI}><xi:include href="part.xml" xpointer="a"/></r>`)).toBe(`<r ${XI}><p xml:id="a">A</p></r>`);
  });

  it('selects the first element in document order when an ID is used twice', () => {
    const options = { errorHandler: { error: () => undefined } };
    expect(plain(`<r ${XI}><xi:include href="twice.xml" xpointer="a"/></r>`, FILES, options)).toBe(
      `<r ${XI}><u xml:id="a">first</u></r>`
    );
  });

  it('selects by an attribute the internal subset declares an ID', () => {
    expect(plain(`<r ${XI}><xi:include href="dtd.xml" xpointer="two"/></r>`)).toBe(
      `<r ${XI}><e key="two">2<f></f><f>F</f></e></r>`
    );
    expect(plain(`<r ${XI}><xi:include href="dtd.xml" xpointer="element(two/2)"/></r>`)).toBe(`<r ${XI}><f>F</f></r>`);
  });

  it('selects by an attribute the external subset declares an ID, once the DTD is read', () => {
    const main = `<r ${XI}><xi:include href="external.xml" xpointer="k"><xi:fallback>none</xi:fallback></xi:include></r>`;
    expect(plain(main, FILES, { accessExternalDTD: 'all' })).toBe(`<r ${XI}><e key="k">K</e></r>`);
    // Without access, the DTD is refused and reported, and without the ID the pointer finds nothing.
    const refused: string[] = [];
    expect(plain(main, FILES, { errorHandler: { error: (e) => void refused.push(e.code) } })).toBe(`<r ${XI}>none</r>`);
    expect(refused).toEqual(['ACCESS_REFUSED']);
  });

  it('selects from an included document after its own inclusions are processed (§4.2)', () => {
    expect(plain(`<r ${XI}><xi:include href="nested.xml" xpointer="q"/></r>`)).toBe(`<r ${XI}><q xml:id="q">Q</q></r>`);
    expect(plain(`<r ${XI}><xi:include href="nested.xml" xpointer="element(/1/2)"/></r>`)).toBe(
      `<r ${XI}><m xml:id="m"></m></r>`
    );
  });
});

describe('pointers with several parts (XPointer Framework §3.3)', () => {
  it('selects with the first part that identifies an element', () => {
    expect(plain(`<r ${XI}><xi:include href="part.xml" xpointer="element(q) element(/1/1)"/></r>`)).toBe(
      `<r ${XI}><q xml:id="q">Q</q></r>`
    );
  });

  it('skips parts in schemes it does not support, and element() parts that are not well-formed', () => {
    const main = `<r ${XI}><xi:include href="part.xml" xpointer="xpointer(//p) element(/0) element(/1/2/1)"/></r>`;
    expect(plain(main)).toBe(`<r ${XI}><q xml:id="q">Q</q></r>`);
  });

  it('reads the document again for a later part that identified an element before an earlier part failed', () => {
    const asked: string[] = [];
    const files: Files = { 'file:///doc/part.xml': FILES['file:///doc/part.xml'] as string };
    const f = new XMLInputFactory({
      xinclude: xincludeProcessor({ fixupBaseURIs: false }),
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: ({ systemId, baseURI }: ResolveRequest): ResolvedSource | undefined => {
          const uri = new URL(systemId ?? '', baseURI).href;
          asked.push(uri);
          const text = files[uri];
          return typeof text === 'string' ? { text, systemId: uri } : undefined;
        },
      },
    });
    const main = `<r ${XI}><xi:include href="part.xml" xpointer="element(missing) element(/1/2/1) element(/1/1)"/></r>`;
    const reader = f.createStreamReader({ text: main, systemId: MAIN });
    let out = '';
    while (reader.next() !== EventType.END_DOCUMENT)
      if (reader.eventType() === EventType.START_ELEMENT) out += `<${reader.localName()}>`;
    expect(out).toBe('<r><q>');
    expect(asked).toEqual(['file:///doc/part.xml', 'file:///doc/part.xml']);
  });

  it.each([
    ['identifies nothing', 'element(/1/9)'],
    ['names an ID no element has', 'nowhere'],
    ['has only parts in unsupported schemes', 'xpointer(//p)'],
    ['is not well-formed', 'element(/1'],
    ['is a shorthand pointer that is not an NCName', 'a:b'],
  ])(
    'treats a pointer that %s as a resource error, which a fallback replaces, else XINCLUDE_POINTER (§4.4)',
    (_what, pointer) => {
      const main = `<r ${XI}><xi:include href="part.xml" xpointer="${pointer}"><xi:fallback>F</xi:fallback></xi:include></r>`;
      expect(plain(main)).toBe(`<r ${XI}>F</r>`);
      expect(failure(FILES, `<r ${XI}><xi:include href="part.xml" xpointer="${pointer}"/></r>`)).toBe(
        'XINCLUDE_POINTER'
      );
    }
  );
});

describe('intra-document references (XInclude §4.2)', () => {
  it('selects from the including document for an empty or missing href', () => {
    expect(plain(`<r ${XI}><s xml:id="s">S</s><xi:include xpointer="s"/></r>`)).toBe(
      `<r ${XI}><s xml:id="s">S</s><s xml:id="s">S</s></r>`
    );
    expect(plain(`<r ${XI}><xi:include href="" xpointer="s"/><s xml:id="s">S</s></r>`)).toBe(
      `<r ${XI}><s xml:id="s">S</s><s xml:id="s">S</s></r>`
    );
  });

  it('processes the inclusions in what it selects (§4.2)', () => {
    const main = `<r ${XI}><s xml:id="s"><xi:include href="part.xml" xpointer="q"/></s><xi:include xpointer="s"/></r>`;
    expect(plain(main)).toBe(`<r ${XI}><s xml:id="s"><q xml:id="q">Q</q></s><s xml:id="s"><q xml:id="q">Q</q></s></r>`);
  });

  it('selects by an ID the including document’s DTD declares', () => {
    const main = `<!DOCTYPE r [<!ATTLIST s key ID #IMPLIED>]><r ${XI}><s key="k">S</s><xi:include xpointer="k"/></r>`;
    expect(plain(main)).toBe(`<r ${XI}><s key="k">S</s><s key="k">S</s></r>`);
  });

  it('selects by child sequence, with later parts read again as for other documents', () => {
    const main = `<r ${XI}><s>S</s><t>T</t><xi:include xpointer="element(nowhere) element(/1/2)"/></r>`;
    expect(plain(main)).toBe(`<r ${XI}><s>S</s><t>T</t><t>T</t></r>`);
  });

  it('treats a pointer into the document that identifies nothing as a resource error, else XINCLUDE_POINTER', () => {
    expect(plain(`<r ${XI}><xi:include xpointer="nowhere"><xi:fallback>F</xi:fallback></xi:include></r>`)).toBe(
      `<r ${XI}>F</r>`
    );
    expect(failure(FILES, `<r ${XI}><xi:include xpointer="element(/2)"/></r>`)).toBe('XINCLUDE_POINTER');
  });

  it('reads the document again from bytes it was given', () => {
    const main = `<r ${XI}><s xml:id="s">é</s><xi:include xpointer="s"/></r>`;
    const reader = factory(FILES).createStreamReader({ bytes: new TextEncoder().encode(main), systemId: MAIN });
    let text = '';
    while (reader.next() !== EventType.END_DOCUMENT)
      if (reader.eventType() === EventType.CHARACTERS) text += reader.text();
    expect(text).toBe('éé');
    const bare = factory(FILES).createStreamReader(new TextEncoder().encode(main));
    let again = '';
    while (bare.next() !== EventType.END_DOCUMENT) if (bare.eventType() === EventType.CHARACTERS) again += bare.text();
    expect(again).toBe('éé');
  });

  it('reads the document again from a string it was given', () => {
    const reader = factory(FILES).createStreamReader(`<r ${XI}><s xml:id="s">S</s><xi:include xpointer="s"/></r>`);
    let text = '';
    while (reader.next() !== EventType.END_DOCUMENT)
      if (reader.eventType() === EventType.CHARACTERS) text += reader.text();
    expect(text).toBe('SS');
  });

  it('reads the document again through the resolvers by its URI, when it was given as chunks', () => {
    const main = `<r ${XI}><s xml:id="s">S</s><xi:include xpointer="s"/></r>`;
    const files = { [MAIN]: main.replace('>S<', '>from resolver<') };
    const chunks = [new TextEncoder().encode(main)];
    const reader = factory(files).createStreamReader({ chunks, systemId: MAIN });
    let text = '';
    while (reader.next() !== EventType.END_DOCUMENT)
      if (reader.eventType() === EventType.CHARACTERS) text += reader.text();
    expect(text).toBe('Sfrom resolver');
  });

  it('treats a document it cannot read again, with no URI, as a resource error', () => {
    const main = `<r ${XI}><s xml:id="s">S</s><xi:include xpointer="s"><xi:fallback>F</xi:fallback></xi:include></r>`;
    const reader = factory(FILES).createStreamReader([new TextEncoder().encode(main)]);
    let text = '';
    while (reader.next() !== EventType.END_DOCUMENT)
      if (reader.eventType() === EventType.CHARACTERS) text += reader.text();
    expect(text).toBe('SF');
  });

  it('keeps the base URI of the selected element’s place, so its fix-ups are against it', () => {
    const main = `<r ${XI}><s xml:base="sub/" xml:lang="de"><t xml:id="t"/></s><xi:include xpointer="t"/></r>`;
    expect(included({}, main)).toBe(
      '<r><s xml:base="sub/" xml:lang="de"><t xml:id="t"></t></s><t xml:base="sub/" xml:id="t" xml:lang="de"></t></r>'
    );
  });
});
