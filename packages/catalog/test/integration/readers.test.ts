import { type Files, ROOT, catalog, file } from '@test/helpers/catalog.ts';
import { describe, expect, it } from 'vitest';
import { DocumentBuilder } from '@exemplarjs/dom';
import { xincludeProcessor } from '@exemplarjs/xinclude';
import { ErrorCode, EventType, ResolutionError, XMLError, XMLInputFactory } from '@exemplarjs/xml';

const CATALOG: Files = {
  [ROOT]: file(
    '<public publicId="-//EX//DTD Doc//EN" uri="doc.dtd"/>' +
      '<system systemId="http://example.com/ent.xml" uri="ent.xml"/><uri name="http://example.com/part.xml" uri="part.xml"/>' +
      '<rewriteURI uriStartString="http://example.com/text/" rewritePrefix="text/"/>' +
      '<rewriteSystem systemIdStartString="http://example.com/chain/" rewritePrefix="chain/"/>'
  ),
  'file:///c/doc.dtd': '<!ENTITY greeting "hello"><!ENTITY ext SYSTEM "http://example.com/ent.xml">',
  'file:///c/ent.xml': '<e>external</e>',
  'file:///c/part.xml': '<part/>',
  'file:///c/text/note.txt': 'a note',
  'file:///c/chain/outer.dtd': '<!ENTITY % inner SYSTEM "http://example.com/chain/inner.ent">%inner;',
  'file:///c/chain/inner.ent': '<!ENTITY deep "from the inner entity">',
};
const DOC = '<!DOCTYPE doc PUBLIC "-//EX//DTD Doc//EN" "http://example.com/doc.dtd"><doc>&greeting; &ext;</doc>';
const XI = 'xmlns:xi="http://www.w3.org/2001/XInclude"';

/** The text and start tags of a document read with a catalog. */
function text(factory: XMLInputFactory, xml: string): string {
  const reader = factory.createStreamReader({ text: xml, systemId: 'file:///doc/main.xml' });
  let out = '';
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.CHARACTERS) out += reader.text();
    if (event === EventType.START_ELEMENT) out += `<${reader.localName()}>`;
  }
  return out;
}

/** The XMLError reading a document fails with. */
function errorOf(read: () => unknown): XMLError {
  try {
    read();
  } catch (error) {
    if (error instanceof XMLError) return error;
    throw error;
  }
  throw new Error('Expected an XMLError');
}

describe('XML Catalogs for DTDs and external entities', () => {
  it('reads the DTD and entities the catalog maps to, checking the access list against the mapped URI', () => {
    const factory = new XMLInputFactory({
      catalog: catalog(CATALOG),
      accessExternalDTD: ['file'],
      accessExternalEntities: ['file'],
    });
    expect(text(factory, DOC)).toBe('<doc>hello <e>external');
    const closed = new XMLInputFactory({ catalog: catalog(CATALOG), accessExternalDTD: ['file'] });
    expect(() => text(closed, DOC)).toThrow(expect.objectContaining({ code: 'ACCESS_REFUSED' }));
    const refused: string[] = [];
    const reporting = closed.withOptions({ errorHandler: { error: (e) => void refused.push(e.message) } });
    expect(text(reporting, DOC)).toBe('<doc>hello ');
    expect(refused).toEqual(["Reading file:///c/ent.xml is not allowed: the access list does not name 'file'"]);
    // The DTD maps to a file: copy, so allowing http: is not enough.
    const http = new XMLInputFactory({
      catalog: catalog(CATALOG),
      accessExternalDTD: ['http'],
      errorHandler: { error: (e) => void refused.push(e.code) },
    });
    expect(text(http, '<!DOCTYPE doc PUBLIC "-//EX//DTD Doc//EN" "http://example.com/doc.dtd"><doc>x</doc>')).toBe(
      '<doc>x'
    );
    expect(refused.at(-1)).toBe('ACCESS_REFUSED');
  });

  it('maps parameter entities a mapped DTD refers to', () => {
    const factory = new XMLInputFactory({ catalog: catalog(CATALOG), accessExternalDTD: ['file'] });
    expect(text(factory, '<!DOCTYPE d SYSTEM "http://example.com/chain/outer.dtd"><d>&deep;</d>')).toBe(
      '<d>from the inner entity'
    );
  });

  it('maps a urn:publicid: system identifier through public entries (§7.1.1)', () => {
    const factory = new XMLInputFactory({ catalog: catalog(CATALOG), accessExternalDTD: ['file'] });
    expect(text(factory, '<!DOCTYPE doc SYSTEM "urn:publicid:-:EX:DTD+Doc:EN"><doc>&greeting;</doc>')).toBe(
      '<doc>hello'
    );
  });

  it('asks the caller’s resolver first, and again for the URI the catalog maps to', () => {
    const asked: string[] = [];
    const factory = new XMLInputFactory({
      catalog: catalog(CATALOG),
      accessExternalDTD: 'all',
      entityResolver: {
        resolveEntity: ({ systemId }) => {
          asked.push(systemId ?? '');
          return systemId === 'file:///c/doc.dtd' ? { systemId, text: '<!ENTITY greeting "hi">' } : undefined;
        },
      },
    });
    expect(
      text(factory, '<!DOCTYPE doc PUBLIC "-//EX//DTD Doc//EN" "http://example.com/doc.dtd"><doc>&greeting;</doc>')
    ).toBe('<doc>hi');
    expect(asked).toEqual(['http://example.com/doc.dtd', 'file:///c/doc.dtd']);
  });

  it('fails at the reference under strict when nothing matches, and reads nothing under ignore', () => {
    const xml = '<!DOCTYPE doc SYSTEM "http://example.com/unknown.dtd"><doc/>';
    const strict = new XMLInputFactory({ catalog: catalog(CATALOG, { resolve: 'strict' }), accessExternalDTD: 'all' });
    const error = errorOf(() => text(strict, xml));
    expect([error.code, error.line, error.column]).toEqual(['CATALOG_NO_MATCH', 1, 1]);
    const ignoring = new XMLInputFactory({
      catalog: catalog(CATALOG, { resolve: 'ignore' }),
      accessExternalDTD: 'all',
    });
    expect(text(ignoring, '<!DOCTYPE doc SYSTEM "http://example.com/unknown.dtd"><doc>x</doc>')).toBe('<doc>x');
  });

  it('carries on as if there were no catalog under continue', () => {
    const asked: string[] = [];
    const factory = new XMLInputFactory({
      catalog: catalog(CATALOG, { resolve: 'continue' }),
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: ({ systemId }) => void asked.push(systemId ?? '') },
    });
    expect(text(factory, '<!DOCTYPE doc SYSTEM "http://example.com/unknown.dtd"><doc>x</doc>')).toBe('<doc>x');
    expect(asked).toEqual(['http://example.com/unknown.dtd']);
  });

  it('fails a document at the reference when any resolver throws a ResolutionError', () => {
    const factory = new XMLInputFactory({
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: () => {
          throw new ResolutionError(ErrorCode.CATALOG_NO_MATCH, 'Not here');
        },
      },
    });
    const xml = '<!DOCTYPE d [<!ENTITY e SYSTEM "e.xml">]>\n<d>x &e;</d>';
    expect(() => text(factory, xml)).toThrow(expect.objectContaining({ code: 'CATALOG_NO_MATCH', line: 2, column: 6 }));
  });

  it('fails with CATALOG_CIRCULAR at the reference when the catalog files lead back to themselves', () => {
    const circular = { ...CATALOG, [ROOT]: file('<nextCatalog catalog="catalog.xml"/>') };
    const factory = new XMLInputFactory({ catalog: catalog(circular), accessExternalDTD: 'all' });
    expect(errorOf(() => text(factory, '<!DOCTYPE d SYSTEM "http://example.com/d.dtd"><d/>')).code).toBe(
      'CATALOG_CIRCULAR'
    );
  });

  it('serves as the entity resolver itself, with no access list, reading with its own reader', () => {
    const c = catalog(CATALOG, { resolve: 'ignore' });
    const factory = new XMLInputFactory({ entityResolver: c, accessExternalDTD: 'all', accessExternalEntities: 'all' });
    expect(text(factory, DOC)).toBe('<doc>hello <e>external');
    expect(text(factory, '<!DOCTYPE d SYSTEM "http://example.com/unknown.dtd"><d>x</d>')).toBe('<d>x');
  });

  it('builds DOM trees with the DTD the catalog maps to', () => {
    const factory = new XMLInputFactory({
      catalog: catalog(CATALOG),
      accessExternalDTD: ['file'],
      accessExternalEntities: ['file'],
    });
    const doc = new DocumentBuilder(factory).parse({ text: DOC, systemId: 'file:///doc/main.xml' });
    expect([doc.doctype?.publicId, doc.documentElement?.textContent]).toEqual(['-//EX//DTD Doc//EN', 'hello external']);
  });

  it('works in asynchronous readers, after resolvers that answer with promises', async () => {
    const factory = new XMLInputFactory({
      catalog: catalog(CATALOG),
      accessExternalDTD: ['file'],
      accessExternalEntities: ['file'],
      entityResolver: { resolveEntity: () => Promise.resolve(undefined) },
    });
    const doc = await new DocumentBuilder(factory).parseAsync({ text: DOC, systemId: 'file:///doc/main.xml' });
    expect(doc.documentElement?.textContent).toBe('hello external');
    const strict = factory.withOptions({ catalog: catalog(CATALOG, { resolve: 'strict' }) });
    const unknown = '<!DOCTYPE doc SYSTEM "http://example.com/unknown.dtd"><doc/>';
    await expect(new DocumentBuilder(strict).parseAsync({ text: unknown })).rejects.toThrow(
      expect.objectContaining({ code: 'CATALOG_NO_MATCH' })
    );
  });
});

describe('XML Catalogs for XInclude', () => {
  /** A factory with XInclude on and the catalog, reading file: URIs only. */
  function including(options: { resolve?: 'strict' | 'continue' | 'ignore' } = {}): XMLInputFactory {
    return new XMLInputFactory({
      catalog: catalog(CATALOG, options),
      xinclude: xincludeProcessor({ fixupBaseURIs: false }),
      accessExternalEntities: ['file'],
    });
  }

  it('serves targets through its uri entries, and then its system entries', () => {
    const xml = `<doc ${XI}><xi:include href="http://example.com/part.xml"/></doc>`;
    expect(text(including(), xml)).toBe('<doc><part>');
    expect(text(including(), xml.replace('part.xml', 'ent.xml'))).toBe('<doc><e>external');
  });

  it('serves text inclusions through rewriteURI entries', () => {
    expect(
      text(including(), `<doc ${XI}><xi:include href="http://example.com/text/note.txt" parse="text"/></doc>`)
    ).toBe('<doc>a note');
  });

  it.each(['continue', 'ignore'] as const)('falls back for a target nothing matches under %s', (resolve) => {
    const xml = `<doc ${XI}><xi:include href="http://example.com/none.xml"><xi:fallback>F</xi:fallback></xi:include></doc>`;
    expect(text(including({ resolve }), xml)).toBe('<doc>F');
  });

  it('fails with CATALOG_NO_MATCH for a target nothing matches under strict', () => {
    const xml = `<doc ${XI}><xi:include href="http://example.com/none.xml"><xi:fallback>F</xi:fallback></xi:include></doc>`;
    expect(errorOf(() => text(including({ resolve: 'strict' }), xml)).code).toBe('CATALOG_NO_MATCH');
  });

  it('serves as the URI resolver itself', () => {
    const factory = new XMLInputFactory({
      uriResolver: catalog(CATALOG, { resolve: 'strict' }),
      xinclude: xincludeProcessor(),
      accessExternalEntities: 'all',
    });
    expect(text(factory, `<doc ${XI}><xi:include href="http://example.com/part.xml"/></doc>`)).toBe('<doc><part>');
    const unmatched = `<doc ${XI}><xi:include href="http://example.com/none.xml"><xi:fallback/></xi:include></doc>`;
    expect(errorOf(() => text(factory, unmatched)).code).toBe('CATALOG_NO_MATCH');
  });

  it('builds DOM trees with the targets the catalog maps to', () => {
    const doc = new DocumentBuilder(including()).parse({
      text: `<doc ${XI}><xi:include href="http://example.com/part.xml"/></doc>`,
      systemId: 'file:///doc/main.xml',
    });
    expect(doc.documentElement?.firstChild?.nodeName).toBe('part');
  });

  it('reads a catalog file given only as a nextCatalog of another', () => {
    const files = {
      ...CATALOG,
      [ROOT]: file('<nextCatalog catalog="real.xml"/>'),
      'file:///c/real.xml': CATALOG[ROOT] as string,
    };
    const factory = new XMLInputFactory({
      catalog: catalog(files),
      xinclude: xincludeProcessor(),
      accessExternalEntities: ['file'],
    });
    expect(text(factory, `<doc ${XI}><xi:include href="http://example.com/part.xml"/></doc>`)).toBe('<doc><part>');
  });
});
