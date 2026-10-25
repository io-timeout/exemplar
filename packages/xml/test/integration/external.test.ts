import { canonicalOfAsync } from '@test/helpers/canonical.ts';
import { canonical, cursor, errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import type { CatalogProcessor } from '@/config/options.ts';
import {
  type EntityResolver,
  EventType,
  type InputOptions,
  type ResolveRequest,
  type XMLError,
  XMLInputFactory,
} from '@/index.ts';
import { DTD_COMPLETE, accessAllows, accessRefusedError } from '@/internal.ts';

/** A resolver serving texts by absolute URI, recording what it was asked; a reading one keeps to the access list, as the bundled ones do. */
function memory(files: Record<string, string>, asked: ResolveRequest[] = [], reading = true): EntityResolver {
  return {
    resolveEntity(request) {
      asked.push(request);
      const uri = new URL(request.systemId ?? '', request.baseURI).href;
      if (reading && request.access !== undefined && !accessAllows(request.access, uri)) throw accessRefusedError(uri);
      const text = files[uri];
      return text === undefined ? undefined : { systemId: uri, text };
    },
  };
}

const BASE = 'http://example.org/docs/';
const DOC = `${BASE}doc.xml`;

const FILES = {
  [`${BASE}a.dtd`]:
    '<?xml version="1.0" encoding="UTF-8"?><!ENTITY e "from the external subset"><!ATTLIST a x CDATA "d">',
  [`${BASE}ext.xml`]: '<?xml encoding="UTF-8"?><b>external</b>',
  [`${BASE}sub/p.ent`]: '<!ENTITY f "from a parameter entity"><!ENTITY g SYSTEM "g.xml">',
  [`${BASE}sub/g.xml`]: '<g>relative to the parameter entity</g>',
};

describe('external DTDs and entities through resolvers (§4.2.2, §5.1)', () => {
  it('asks the resolver whatever the access lists say, as the JDK does', () => {
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY x SYSTEM "ext.xml">]><a>&e;&x;</a>', systemId: DOC };
    expect(canonical(xml, { entityResolver: memory(FILES, [], false) })).toBe(
      '<a x="d">from the external subset<b>external</b></a>'
    );
  });

  it('reports a read a resolver refuses for the access list, then goes on without it', () => {
    const asked: ResolveRequest[] = [];
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', systemId: DOC };
    expect(() => canonical(xml, { entityResolver: memory(FILES) })).toThrow(
      expect.objectContaining({
        code: 'ACCESS_REFUSED',
        message: `Reading ${BASE}a.dtd is not allowed: the access list does not name 'http'`,
        line: 1,
        column: 1,
      })
    );
    const codes: string[] = [];
    const r = cursor(xml, {
      entityResolver: memory(FILES, asked),
      errorHandler: { error: (e) => void codes.push(e.code) },
    });
    r.next();
    expect(r[DTD_COMPLETE]).toBe(false);
    r.next();
    expect(r.next()).toBe(EventType.ENTITY_REFERENCE);
    expect(codes).toEqual(['ACCESS_REFUSED']);
    expect(asked).toEqual([{ name: '[dtd]', systemId: 'a.dtd', baseURI: DOC, access: [] }]);
  });

  it('reads the external subset, with relative system ids resolved against the document', () => {
    const options = { accessExternalDTD: ['http'], entityResolver: memory(FILES) } as const;
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', systemId: DOC };
    expect(canonical(xml, options)).toBe('<a x="d">from the external subset</a>');
    const r = cursor(xml, options);
    r.next();
    expect(r[DTD_COMPLETE]).toBe(true);
  });

  it('resolves against the base URI the source gives, over its system id', () => {
    const options = { accessExternalDTD: ['http'], entityResolver: memory(FILES) } as const;
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', systemId: 'urn:elsewhere', baseURI: DOC };
    expect(canonical(xml, options)).toBe('<a x="d">from the external subset</a>');
  });

  it('asks the resolver with the entity name, public id, system id as written and base URI (SAX EntityResolver2)', () => {
    const asked: ResolveRequest[] = [];
    const options = {
      accessExternalDTD: 'all',
      accessExternalEntities: 'all',
      entityResolver: memory(FILES, asked),
    } as const;
    const xml = '<!DOCTYPE a PUBLIC "-//A//EN" "a.dtd" [<!ENTITY % p SYSTEM "sub/p.ent"> %p;]><a>&g;</a>';
    canonical({ text: xml, systemId: DOC }, options);
    expect(asked).toEqual([
      { name: '%p', systemId: 'sub/p.ent', baseURI: DOC, access: 'all' },
      { name: '[dtd]', publicId: '-//A//EN', systemId: 'a.dtd', baseURI: DOC, access: 'all' },
      { name: 'g', systemId: 'g.xml', baseURI: `${BASE}sub/p.ent`, access: 'all' },
    ]);
  });

  it('reads external parameter entities, resolving what they declare against their own URI (XML Base §4.2)', () => {
    const options = {
      accessExternalDTD: ['http'],
      accessExternalEntities: ['http'],
      entityResolver: memory(FILES),
    } as const;
    const xml = { text: '<!DOCTYPE a [<!ENTITY % p SYSTEM "sub/p.ent"> %p;]><a>&f;&g;</a>', systemId: DOC };
    expect(canonical(xml, options)).toBe('<a>from a parameter entity<g>relative to the parameter entity</g></a>');
  });

  it('governs external parameter entities by accessExternalDTD, as the JDK does', () => {
    const xml = { text: '<!DOCTYPE a [<!ENTITY % p SYSTEM "sub/p.ent"> %p;]><a>&f;</a>', systemId: DOC };
    const codes: string[] = [];
    const errorHandler = { error: (e: { code: string }) => void codes.push(e.code) };
    const entitiesOnly = { accessExternalEntities: 'all', entityResolver: memory(FILES), errorHandler } as const;
    expect(reader(xml, entitiesOnly).next()).toBe(EventType.DTD);
    expect(canonical(xml, entitiesOnly)).toBe('<a></a>');
    expect(codes).toContain('ACCESS_REFUSED');
  });

  it('expands external parsed entities in content, as accessExternalEntities allows', () => {
    const xml = { text: '<!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>', systemId: DOC };
    expect(canonical(xml, { accessExternalEntities: ['http'], entityResolver: memory(FILES) })).toBe(
      '<a><b>external</b></a>'
    );
    expect(() => canonical(xml, { accessExternalDTD: 'all', entityResolver: memory(FILES) })).toThrow(
      expect.objectContaining({ code: 'ACCESS_REFUSED' })
    );
    expect(
      canonical(xml, {
        accessExternalEntities: ['http'],
        supportExternalEntities: false,
        entityResolver: memory(FILES),
      })
    ).toBe('<a></a>');
  });

  it('gives errors in an external entity its system id, line and the entity chain', () => {
    const bad = { ...FILES, [`${BASE}ext.xml`]: '<b>\n<c></b>' };
    const xml = { text: '<!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>', systemId: DOC };
    expect(() => canonical(xml, { accessExternalEntities: 'all', entityResolver: memory(bad) })).toThrow(
      expect.objectContaining({ code: 'WF_END_TAG_MISMATCH', systemId: `${BASE}ext.xml`, line: 2, entities: ['x'] })
    );
  });

  it('counts error offsets in the text as given, CRs included, in external DTDs and entities alike', () => {
    const bad = '<?xml encoding="UTF-8"?>\r\n<!--1-->\r\n<!--2-->\r\n<!-- -- -->';
    const offset = bad.lastIndexOf('-- -->');
    const files = { [`${BASE}bad.ent`]: bad, [`${BASE}bad.dtd`]: bad };
    const options: InputOptions = {
      accessExternalEntities: 'all',
      accessExternalDTD: 'all',
      entityResolver: memory(files),
    };
    const located = (text: string): number[] => {
      try {
        canonical({ text, systemId: DOC }, options);
      } catch (error) {
        const { line, column, offset } = error as XMLError;
        return [line, column, offset];
      }
      throw new Error('The document was accepted');
    };
    expect(located('<!DOCTYPE a [<!ENTITY x SYSTEM "bad.ent">]><a>&x;</a>')).toEqual([4, 6, offset]);
    expect(located('<!DOCTYPE a SYSTEM "bad.dtd"><a/>')).toEqual([4, 6, offset]);
    expect(located('<!DOCTYPE a [<!ENTITY % p SYSTEM "bad.dtd">%p;]><a/>')).toEqual([4, 6, offset]);
  });

  it('rejects an XML 1.1 entity in an XML 1.0 document (§4.3.4)', () => {
    const v11 = { [`${BASE}ext.xml`]: '<?xml version="1.1" encoding="UTF-8"?><b/>' };
    const xml = { text: '<!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>', systemId: DOC };
    expect(() => canonical(xml, { accessExternalEntities: 'all', entityResolver: memory(v11) })).toThrow(
      expect.objectContaining({ code: 'WF_ENTITY_VERSION' })
    );
  });

  it('reads an XML 1.0 entity in an XML 1.1 document, by XML 1.1 rules', () => {
    const v10 = { [`${BASE}ext.xml`]: '<?xml version="1.0" encoding="UTF-8"?><b>&#x1;</b>' };
    const xml = { text: '<?xml version="1.1"?><!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>', systemId: DOC };
    expect(canonical(xml, { accessExternalEntities: 'all', entityResolver: memory(v10) })).toBe('<a><b>\u0001</b></a>');
  });

  it('requires an encoding in a text declaration (§4.3.1)', () => {
    const bad = { [`${BASE}a.dtd`]: '<?xml version="1.0"?><!ENTITY e "x">' };
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd"><a/>', systemId: DOC };
    expect(() => canonical(xml, { accessExternalDTD: 'all', entityResolver: memory(bad) })).toThrow(
      expect.objectContaining({ code: 'WF_TEXT_DECLARATION', systemId: `${BASE}a.dtd` })
    );
  });

  it('requires an encoding in the text declaration of an external general entity too (§4.3.1 [77])', () => {
    const bad = { [`${BASE}ext.xml`]: '<?xml version="1.0"?><b/>' };
    const xml = { text: '<!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>', systemId: DOC };
    expect(() => canonical(xml, { accessExternalEntities: 'all', entityResolver: memory(bad) })).toThrow(
      expect.objectContaining({ code: 'WF_TEXT_DECLARATION', systemId: `${BASE}ext.xml`, line: 1, column: 20 })
    );
  });

  it('takes an external subset a resolver offers for a document that names none (SAX getExternalSubset)', () => {
    const resolver: EntityResolver = {
      resolveEntity: () => undefined,
      getExternalSubset: ({ name }) => (name === 'a' ? { text: '<!ENTITY e "offered">' } : undefined),
    };
    expect(canonical('<!DOCTYPE a><a>&e;</a>', { entityResolver: resolver })).toBe('<a>offered</a>');
    expect(canonical('<!DOCTYPE b><b/>', { entityResolver: resolver })).toBe('<b></b>');
  });

  it('refuses a resolver that answers with a promise or a stream in the synchronous reader', () => {
    /** Options whose resolver gives every request one answer. */
    const options = (answer: unknown): InputOptions => ({
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: () => answer as never },
    });
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd"><a/>', systemId: `${BASE}d.xml` };
    expect(() => canonical(xml, options(Promise.resolve(undefined)))).toThrow(TypeError);
    const stream = new ReadableStream<Uint8Array>();
    expect(() => canonical(xml, options({ stream }))).toThrow(TypeError);
  });

  it('reads what a resolver supplies as bytes, in the encoding it declares or is given', () => {
    const latin1 = new Uint8Array([
      ...new TextEncoder().encode('<?xml encoding="ISO-8859-1"?><!ENTITY e "'),
      0xe9,
      0x22,
      0x3e,
    ]);
    /** Options whose resolver gives every request one source. */
    const options = (source: object): InputOptions => ({
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: () => source },
    });
    expect(canonical('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', options({ bytes: latin1 }))).toBe('<a>é</a>');
    const bare = new Uint8Array([...new TextEncoder().encode('<!ENTITY e "'), 0xe9, 0x22, 0x3e]);
    expect(canonical('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', options({ bytes: bare, encoding: 'ISO-8859-1' }))).toBe(
      '<a>é</a>'
    );
  });
});

describe('standalone="yes" (§2.9, §4.1)', () => {
  it('does not count declarations from parameter entities for references in the document', () => {
    const xml = '<?xml version="1.0" standalone="yes"?><!DOCTYPE a [<!ENTITY % p "<!ENTITY e \'x\'>"> %p;]><a>&e;</a>';
    expect(errorOf(xml).code).toBe('WF_UNDECLARED_ENTITY');
  });

  it('does not count declarations from the external subset either', () => {
    const options = { accessExternalDTD: 'all', entityResolver: memory(FILES) } as const;
    const xml = { text: '<?xml version="1.0" standalone="yes"?><!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', systemId: DOC };
    expect(() => canonical(xml, options)).toThrow(expect.objectContaining({ code: 'WF_UNDECLARED_ENTITY' }));
  });

  it('still applies internal declarations', () => {
    expect(parseEveryWay('<?xml version="1.0" standalone="yes"?><!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>')).toBe(
      '<a>x</a>'
    );
  });
});

describe('catalogs (javax.xml.catalog), asked after the resolver', () => {
  /** A catalog mapping system ids to URIs and reading those URIs from a table. */
  function catalog(
    map: Record<string, string>,
    files: Record<string, string>,
    resolution: CatalogProcessor['resolution'] = 'strict'
  ): CatalogProcessor {
    return {
      resolution,
      matchEntity: (_publicId, systemId) => (systemId === undefined ? undefined : map[systemId]),
      matchURI: () => undefined,
      read: (uri) => (files[uri] === undefined ? undefined : { systemId: uri, text: files[uri] }),
    };
  }

  it('serves a DTD the catalog maps to a local copy, checking the access list against that copy', () => {
    const local = catalog(
      { 'http://remote/a.dtd': 'file:///local/a.dtd' },
      { 'file:///local/a.dtd': '<!ENTITY e "local">' }
    );
    const xml = '<!DOCTYPE a SYSTEM "http://remote/a.dtd"><a>&e;</a>';
    expect(canonical(xml, { catalog: local, accessExternalDTD: ['file'] })).toBe('<a>local</a>');
    expect(
      canonical(xml, { catalog: local, accessExternalDTD: ['http'], errorHandler: { error: () => undefined } })
    ).toBe('<a></a>');
  });

  it('prefers the resolver’s answer', () => {
    const local = catalog(
      { 'http://remote/a.dtd': 'file:///local/a.dtd' },
      { 'file:///local/a.dtd': '<!ENTITY e "local">' }
    );
    const resolver = { resolveEntity: () => ({ text: '<!ENTITY e "resolver">' }) };
    const xml = '<!DOCTYPE a SYSTEM "http://remote/a.dtd"><a>&e;</a>';
    expect(canonical(xml, { catalog: local, entityResolver: resolver, accessExternalDTD: 'all' })).toBe(
      '<a>resolver</a>'
    );
  });

  it('fails a reference nothing matches under strict, and reads it as empty under ignore', () => {
    const xml = '<!DOCTYPE a SYSTEM "http://remote/a.dtd"><a/>';
    expect(() => canonical(xml, { catalog: catalog({}, {}), accessExternalDTD: 'all' })).toThrow(
      expect.objectContaining({ code: 'CATALOG_NO_MATCH', line: 1, column: 1 })
    );
    expect(canonical(xml, { catalog: catalog({}, {}, 'ignore'), accessExternalDTD: 'all' })).toBe('<a></a>');
    expect(canonical(xml, { catalog: catalog({}, {}, 'continue'), accessExternalDTD: 'all' })).toBe('<a></a>');
  });

  it('fails an entity reference nothing matches under strict, where the reference is', () => {
    const xml = '<!DOCTYPE a [<!ENTITY x SYSTEM "http://remote/x.xml">]>\n<a>&x;</a>';
    expect(() => canonical(xml, { catalog: catalog({}, {}), accessExternalEntities: 'all' })).toThrow(
      expect.objectContaining({ code: 'CATALOG_NO_MATCH', line: 2, column: 4 })
    );
  });

  it('serves external entities and parameter entities in an asynchronous reader', async () => {
    const local = catalog(
      { 'http://remote/p.ent': 'file:///p.ent', 'http://remote/x.xml': 'file:///x.xml' },
      { 'file:///p.ent': '<!ENTITY e "pe">', 'file:///x.xml': '<x/>' }
    );
    const factory = new XMLInputFactory({
      catalog: local,
      accessExternalDTD: ['file'],
      accessExternalEntities: ['file'],
    });
    const xml =
      '<!DOCTYPE a [<!ENTITY % p SYSTEM "http://remote/p.ent"> %p; <!ENTITY x SYSTEM "http://remote/x.xml">]><a>&e;&x;</a>';
    expect(await canonicalOfAsync(factory.createAsyncStreamReader(xml))).toBe('<a>pe<x></x></a>');
  });
});
