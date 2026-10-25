import {
  type Files,
  MAIN,
  XI,
  asyncErrorOf,
  errorOf,
  events,
  eventsAsync,
  factory,
  lookup,
  memoryResolver,
  read,
} from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import {
  type CatalogProcessor,
  type CatalogResolution,
  ErrorCode,
  EventType,
  type InputOptions,
  ResolutionError,
  type Resolution,
  type ResolveRequest,
  type ResolvedSource,
  XMLInputFactory,
} from '@exemplarjs/xml';
import { fetchResolver } from '@exemplarjs/xml/resolvers';
import { xincludeProcessor } from '@/index.ts';

const FILES: Files = {
  'file:///doc/part.xml': '<part/>',
  'file:///doc/note.txt': 'note',
  'file:///mapped/part.xml': '<mapped/>',
};

/** A factory with XInclude on, without fix-ups, and the given options. */
function bare(options: InputOptions): XMLInputFactory {
  return new XMLInputFactory({
    xinclude: xincludeProcessor({ fixupBaseURIs: false, fixupLanguage: false }),
    ...options,
  });
}

/** A document read from MAIN through a factory, written out. */
function through(f: XMLInputFactory, main: string): string {
  return events(f.createStreamReader({ text: main, systemId: MAIN }));
}

/** A catalog that maps the given URIs, reads from in-memory files, and records what it is asked. */
function fakeCatalog(map: Readonly<Record<string, string>>, resolution: CatalogResolution, files: Files = FILES) {
  const asked: string[] = [];
  const catalog: CatalogProcessor = {
    resolution,
    matchEntity: () => undefined,
    matchURI(uri, baseURI) {
      asked.push(`match ${uri} ${baseURI ?? '-'}`);
      return map[new URL(uri, baseURI).href];
    },
    read(uri) {
      asked.push(`read ${uri}`);
      return lookup(files, uri);
    },
  };
  return { catalog, asked };
}

const INCLUDE = `<r ${XI}><xi:include href="part.xml"/></r>`;
const WITH_FALLBACK = `<r ${XI}><xi:include href="part.xml"><xi:fallback>F</xi:fallback></xi:include></r>`;

describe('the resolvers XInclude asks (XInclude §4.1)', () => {
  it('asks the URI resolver first, with the escaped href, the base URI and the headers', () => {
    const asked: unknown[] = [];
    const f = bare({
      accessExternalEntities: 'all',
      uriResolver: {
        resolve: (href, base, headers) => {
          asked.push([href, base, headers]);
          return { text: '<from-uri/>' };
        },
      },
      entityResolver: { resolveEntity: () => ({ text: '<from-entity/>' }) },
    });
    const main = `<r ${XI}><xi:include href="a b.xml" accept="application/xml" accept-language="fr"/></r>`;
    expect(through(f, main)).toBe(`<r ${XI}><from-uri></from-uri></r>`);
    expect(asked).toEqual([['a%20b.xml', MAIN, { accept: 'application/xml', acceptLanguage: 'fr', access: 'all' }]]);
  });

  it('asks the entity resolver when the URI resolver supplies nothing, naming the request [xinclude]', () => {
    const asked: ResolveRequest[] = [];
    const f = bare({
      accessExternalEntities: 'all',
      uriResolver: { resolve: () => undefined },
      entityResolver: {
        resolveEntity: (request) => {
          asked.push(request);
          return { text: '<from-entity/>' };
        },
      },
    });
    expect(through(f, `<r ${XI}><xi:include href="part.xml" accept="text/xml"/></r>`)).toBe(
      `<r ${XI}><from-entity></from-entity></r>`
    );
    expect(asked).toEqual([
      { name: '[xinclude]', systemId: 'part.xml', baseURI: MAIN, accept: 'text/xml', access: 'all' },
    ]);
  });

  it('passes no headers and no base URI that are not there, only the access list', () => {
    const asked: ResolveRequest[] = [];
    const headers: unknown[] = [];
    const f = bare({
      accessExternalEntities: 'all',
      uriResolver: { resolve: (_href, _base, h) => void headers.push(h) },
      entityResolver: { resolveEntity: (request) => (asked.push(request), { text: '<e/>' }) },
    });
    const reader = f.createStreamReader(`<r ${XI}><xi:include href="file:///doc/part.xml"/></r>`);
    while (reader.next() !== EventType.END_DOCUMENT);
    expect(headers).toEqual([{ access: 'all' }]);
    expect(asked.at(-1)).toEqual({ name: '[xinclude]', systemId: 'file:///doc/part.xml', access: 'all' });
  });

  it('reads the included document as from the URI the resolver gives, or else the href resolved', () => {
    const files: Files = { 'file:///doc/part.xml': { text: '<moved/>', systemId: 'file:///elsewhere/moved.xml' } };
    expect(read(files, INCLUDE)).toBe(`<r ${XI}><moved xml:base="../elsewhere/moved.xml"></moved></r>`);
    const unnamed: Files = { 'file:///doc/part.xml': { text: '<unnamed/>' } };
    expect(read(unnamed, INCLUDE)).toBe(`<r ${XI}><unnamed xml:base="part.xml"></unnamed></r>`);
  });

  it('treats a resource no resolver supplies as a resource error', () => {
    expect(read({}, WITH_FALLBACK)).toBe(`<r ${XI}>F</r>`);
    expect(through(bare({ accessExternalEntities: 'all' }), WITH_FALLBACK)).toBe(`<r ${XI}>F</r>`);
  });

  it('fails at the xi:include when a resolver throws a ResolutionError', () => {
    const f = bare({
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: () => {
          throw new ResolutionError(ErrorCode.CATALOG_NO_MATCH, 'not here');
        },
      },
    });
    const error = errorOf(() => through(f, `<r ${XI}>\n <xi:include href="part.xml"><xi:fallback/></xi:include></r>`));
    expect([error.code, error.line, error.column]).toEqual(['CATALOG_NO_MATCH', 2, 2]);
  });
});

describe('documents with no URI', () => {
  it('give the URI resolver no base URI', () => {
    const bases: (string | undefined)[] = [];
    const f = bare({
      accessExternalEntities: 'all',
      uriResolver: { resolve: (_href, base) => (bases.push(base), { text: '<u/>' }) },
    });
    expect(events(f.createStreamReader(`<r ${XI}><xi:include href="file:///doc/part.xml"/></r>`))).toBe(
      `<r ${XI}><u></u></r>`
    );
    expect(bases).toEqual([undefined]);
  });

  it('resolve href against an absolute xml:base, and cannot against a relative one (XML Base §4.2)', () => {
    const f = factory(FILES, { settings: { fixupBaseURIs: false } });
    const absolute = `<r ${XI} xml:base="file:///doc/"><xi:include href="part.xml"/></r>`;
    expect(events(f.createStreamReader(absolute))).toBe(`<r ${XI} xml:base="file:///doc/"><part></part></r>`);
    const relative = `<r ${XI} xml:base="doc/"><xi:include href="part.xml"><xi:fallback>F</xi:fallback></xi:include></r>`;
    expect(events(f.createStreamReader(relative))).toBe(`<r ${XI} xml:base="doc/">F</r>`);
  });

  it('fail with CATALOG_NO_MATCH under a strict catalog that matches nothing', () => {
    const f = bare({ catalog: fakeCatalog({}, 'strict').catalog, accessExternalEntities: ['file'] });
    expect(
      errorOf(() => events(f.createStreamReader(`<r ${XI}><xi:include href="file:///doc/x.xml"/></r>`))).code
    ).toBe('CATALOG_NO_MATCH');
  });
});

describe('external access for XInclude (XInclude §4.1)', () => {
  it('asks the resolvers whatever the access list says, as the JDK does', () => {
    let asked = false;
    const f = bare({ entityResolver: { resolveEntity: () => ((asked = true), { text: '<e/>' }) } });
    expect(through(f, WITH_FALLBACK)).toBe(`<r ${XI}><e></e></r>`);
    expect(asked).toBe(true);
  });

  it('treats a read a resolver refuses for the access list as a resource error', () => {
    const f = bare({ entityResolver: memoryResolver(FILES) });
    expect(through(f, WITH_FALLBACK)).toBe(`<r ${XI}>F</r>`);
    expect(errorOf(() => through(f, INCLUDE)).code).toBe('XINCLUDE_RESOURCE');
  });

  it('reads only with the protocols accessExternalEntities allows', () => {
    const allowed = bare({ accessExternalEntities: ['file'], entityResolver: memoryResolver(FILES) });
    expect(through(allowed, WITH_FALLBACK)).toBe(`<r ${XI}><part></part></r>`);
    const other = bare({ accessExternalEntities: ['https'], entityResolver: memoryResolver(FILES) });
    expect(through(other, WITH_FALLBACK)).toBe(`<r ${XI}>F</r>`);
  });
});

describe('catalogs for XInclude (XML Catalogs §7.2)', () => {
  it('reads the URI the catalog maps a target to, asking the resolvers for it first', () => {
    const { catalog, asked } = fakeCatalog({ 'file:///doc/part.xml': 'file:///mapped/part.xml' }, 'strict');
    const requests: string[] = [];
    const f = bare({
      catalog,
      accessExternalEntities: ['file'],
      entityResolver: { resolveEntity: ({ systemId, baseURI }) => void requests.push(`${systemId} ${baseURI ?? '-'}`) },
    });
    expect(through(f, INCLUDE)).toBe(`<r ${XI}><mapped></mapped></r>`);
    expect(requests).toEqual([`part.xml ${MAIN}`, 'file:///mapped/part.xml -']);
    expect(asked).toEqual([`match part.xml ${MAIN}`, 'read file:///mapped/part.xml']);
  });

  it('takes what the resolvers supply for the mapped URI', () => {
    const { catalog, asked } = fakeCatalog({ 'file:///doc/part.xml': 'file:///mapped/part.xml' }, 'strict');
    const f = bare({
      catalog,
      accessExternalEntities: ['file'],
      entityResolver: memoryResolver({ 'file:///mapped/part.xml': '<resolved/>' }),
    });
    expect(through(f, INCLUDE)).toBe(`<r ${XI}><resolved></resolved></r>`);
    expect(asked).toEqual([`match part.xml ${MAIN}`]);
  });

  it('checks the access list against the mapped URI, not the target', () => {
    const map = { 'http://example.com/part.xml': 'file:///mapped/part.xml' };
    const main = `<r ${XI}><xi:include href="http://example.com/part.xml"><xi:fallback>F</xi:fallback></xi:include></r>`;
    const file = bare({ catalog: fakeCatalog(map, 'strict').catalog, accessExternalEntities: ['file'] });
    expect(through(file, main)).toBe(`<r ${XI}><mapped></mapped></r>`);
    const http = bare({ catalog: fakeCatalog(map, 'strict').catalog, accessExternalEntities: ['http'] });
    expect(through(http, main)).toBe(`<r ${XI}>F</r>`);
  });

  it('fails with CATALOG_NO_MATCH for a target nothing matches under strict', () => {
    const f = bare({ catalog: fakeCatalog({}, 'strict').catalog, accessExternalEntities: ['file'] });
    expect(errorOf(() => through(f, WITH_FALLBACK)).code).toBe('CATALOG_NO_MATCH');
  });

  it.each(['continue', 'ignore'] as const)(
    'treats a target nothing matches as a resource error under %s',
    (resolution) => {
      const f = bare({ catalog: fakeCatalog({}, resolution).catalog, accessExternalEntities: ['file'] });
      expect(through(f, WITH_FALLBACK)).toBe(`<r ${XI}>F</r>`);
    }
  );

  it('uses the catalog only when the resolvers supply nothing', () => {
    const { catalog, asked } = fakeCatalog({}, 'strict');
    const f = bare({ catalog, accessExternalEntities: ['file'], entityResolver: memoryResolver(FILES) });
    expect(through(f, INCLUDE)).toBe(`<r ${XI}><part></part></r>`);
    expect(asked).toEqual([]);
  });
});

describe('resolvers that answer with promises', () => {
  /** A factory whose entity resolver answers each request through a function, asynchronously. */
  function answering(answer: (uri: string) => Promise<ResolvedSource | undefined>) {
    return bare({
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: ({ systemId, baseURI }) => answer(new URL(systemId ?? '', baseURI).href) },
    });
  }

  /** A document read from MAIN through an asynchronous cursor, written out. */
  function readAsync(f: XMLInputFactory, main: string): Promise<string> {
    return eventsAsync(f.createAsyncStreamReader({ text: main, systemId: MAIN }));
  }

  it('waits for them in an asynchronous reader', async () => {
    expect(
      await readAsync(
        factory(FILES, { async: true }),
        `<r ${XI}><xi:include href="part.xml"/><xi:include href="note.txt" parse="text"/></r>`
      )
    ).toBe(`<r ${XI}><part xml:base="part.xml"></part>note</r>`);
  });

  it('treats an answer of nothing, or a rejection, as a resource error', async () => {
    expect(
      await readAsync(
        answering(async () => undefined),
        WITH_FALLBACK
      )
    ).toBe(`<r ${XI}>F</r>`);
    expect(
      await readAsync(
        answering(() => Promise.reject(new Error('offline'))),
        WITH_FALLBACK
      )
    ).toBe(`<r ${XI}>F</r>`);
  });

  it('fails at the xi:include on a rejection with a ResolutionError', async () => {
    const f = answering(() => Promise.reject(new ResolutionError(ErrorCode.CATALOG_NO_MATCH, 'no')));
    const error = await asyncErrorOf(() => readAsync(f, WITH_FALLBACK));
    expect(error.code).toBe('CATALOG_NO_MATCH');
  });

  it('fails with XINCLUDE_RESOURCE when no fallback stands in for a rejection', async () => {
    const f = answering(() => Promise.reject(new Error('offline')));
    const error = await asyncErrorOf(() => readAsync(f, INCLUDE));
    expect(error.code).toBe('XINCLUDE_RESOURCE');
  });

  it('fails in a synchronous reader rather than falling back, as the cursor does for DTDs and entities', () => {
    const f = answering(async () => ({ text: '<p/>' }));
    expect(() => through(f, WITH_FALLBACK)).toThrow(TypeError);
    expect(() => through(f, WITH_FALLBACK)).toThrow(/needs an asynchronous reader/);
  });

  it('gives NEED_INPUT until the resolver answers, and throws if asked again before fill()', async () => {
    const reader = factory(FILES, { async: true }).createAsyncStreamReader({ text: INCLUDE, systemId: MAIN });
    let e = reader.next();
    while (e !== EventType.START_ELEMENT)
      e = e === EventType.NEED_INPUT ? (await reader.fill(), reader.next()) : reader.next();
    expect(reader.next()).toBe(EventType.NEED_INPUT);
    expect(() => reader.next()).toThrow('The reader needs more input: await fill() before calling next() again');
    await reader.fill();
    expect([reader.next(), reader.localName()]).toEqual([EventType.START_ELEMENT, 'part']);
  });

  it('reads an answer that names no URI as from the href resolved', async () => {
    const f = answering(async () => ({ text: '<unnamed/>' }));
    expect(await readAsync(f, INCLUDE)).toBe(`<r ${XI}><unnamed></unnamed></r>`);
    const based = factory({ 'file:///doc/part.xml': { text: '<unnamed/>' } }, { async: true });
    expect(await readAsync(based, INCLUDE)).toBe(`<r ${XI}><unnamed xml:base="part.xml"></unnamed></r>`);
  });

  it('waits again when a pointer’s later part needs the document read again', async () => {
    const main = `<r ${XI}><xi:include href="two.xml" xpointer="element(/9) element(/1/2)"/></r>`;
    const files = { 'file:///doc/two.xml': '<t><a/><b/></t>' };
    expect(await readAsync(factory(files, { async: true, settings: { fixupBaseURIs: false } }), main)).toBe(
      `<r ${XI}><b></b></r>`
    );
  });

  it('reads a streamed document again by its URI for an intra-document reference', async () => {
    const main = `<r ${XI}><s xml:id="s">S</s><xi:include xpointer="s"/></r>`;
    const bytes = new TextEncoder().encode(main);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const f = factory({ [MAIN]: main }, { async: true });
    expect(await eventsAsync(f.createAsyncStreamReader({ stream, systemId: MAIN }))).toBe(
      `<r ${XI}><s xml:id="s">S</s><s xml:id="s">S</s></r>`
    );
  });

  it('treats a streamed document with no URI, which cannot be read again, as a resource error', async () => {
    const main = `<r ${XI}><s xml:id="s">S</s><xi:include xpointer="s"><xi:fallback>F</xi:fallback></xi:include></r>`;
    const reader = factory({}, { async: true }).createAsyncStreamReader();
    reader.feed(new TextEncoder().encode(main));
    reader.endOfInput();
    expect(await eventsAsync(reader)).toBe(`<r ${XI}><s xml:id="s">S</s>F</r>`);
  });

  it('lets the caller wait on the reader while an included document is read', async () => {
    const reader = factory(FILES, { async: true }).createAsyncStreamReader({ text: INCLUDE, systemId: MAIN });
    let names = '';
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      if (e === EventType.NEED_INPUT) await reader.fill();
      if (e !== EventType.START_ELEMENT) continue;
      names += reader.localName();
      await reader.fill();
    }
    expect(names).toBe('rpart');
  });

  it('reads an included document’s external DTD and entities through a resolver that answers with a promise', async () => {
    const files = {
      'file:///doc/dtd.xml': '<!DOCTYPE d SYSTEM "d.dtd"><d/>',
      'file:///doc/d.dtd': '<!ATTLIST d a CDATA "default">',
      'file:///doc/outer.xml': `<o ${XI}><xi:include href="dtd.xml"/></o>`,
      'file:///doc/entity.xml': '<!DOCTYPE e [<!ENTITY x SYSTEM "x.ent">]><e>&x;</e>',
      'file:///doc/x.ent': '<x/>',
    };
    const f = factory(files, {
      async: true,
      settings: { fixupBaseURIs: false },
      options: { accessExternalDTD: 'all' },
    });
    expect(await readAsync(f, `<r ${XI}><xi:include href="dtd.xml"/></r>`)).toBe(`<r ${XI}><d a="default"></d></r>`);
    expect(await readAsync(f, `<r ${XI}><xi:include href="outer.xml"/></r>`)).toBe(
      `<r ${XI}><o ${XI}><d a="default"></d></o></r>`
    );
    expect(await readAsync(f, `<r ${XI}><xi:include href="entity.xml"/></r>`)).toBe(`<r ${XI}><e><x></x></e></r>`);
  });

  it('sends accept and accept-language as HTTP headers through fetchResolver (§3.1)', async () => {
    const asked: Record<string, string>[] = [];
    const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      asked.push((init?.headers ?? {}) as Record<string, string>);
      return new Response('bonjour', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    };
    const f = new XMLInputFactory({
      xinclude: xincludeProcessor(),
      accessExternalEntities: 'all',
      entityResolver: fetchResolver({ fetch: fetch as typeof globalThis.fetch }),
    });
    const main = `<r ${XI}><xi:include href="http://example.com/t" parse="text" accept="text/plain" accept-language="fr"/></r>`;
    expect(await eventsAsync(f.createAsyncStreamReader({ text: main, systemId: 'http://example.com/main.xml' }))).toBe(
      `<r ${XI}>bonjour</r>`
    );
    expect(asked).toEqual([{ Accept: 'text/plain', 'Accept-Language': 'fr' }]);
  });
});

describe('resolvers that answer with streams', () => {
  /** Bytes as a web stream, in chunks of a few bytes. */
  function webStream(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3));
        controller.close();
      },
    });
  }

  /** Bytes as an async iterable. */
  async function* iterable(text: string): AsyncIterable<Uint8Array> {
    yield new TextEncoder().encode(text);
  }

  /** A factory whose resolver answers each file with a stream of its text, at once or through a promise. */
  function streaming(files: Readonly<Record<string, string>>, answer: (s: ResolvedSource) => Resolution) {
    return bare({
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: ({ systemId, baseURI }) => {
          const uri = new URL(systemId ?? '', baseURI).href;
          const text = files[uri];
          return text === undefined ? undefined : answer({ systemId: uri, stream: webStream(text) });
        },
      },
    });
  }

  const STREAMED = { 'file:///doc/part.xml': '<part>é</part>', 'file:///doc/note.txt': 'note é' };
  const BOTH = `<r ${XI}><xi:include href="part.xml"/><xi:include href="note.txt" parse="text"/></r>`;

  it('reads them whole in an asynchronous reader, for parse="xml" and parse="text"', async () => {
    const read = (f: XMLInputFactory) => eventsAsync(f.createAsyncStreamReader({ text: BOTH, systemId: MAIN }));
    expect(await read(streaming(STREAMED, (s) => s))).toBe(`<r ${XI}><part>é</part>note é</r>`);
    expect(await read(streaming(STREAMED, async (s) => s))).toBe(`<r ${XI}><part>é</part>note é</r>`);
  });

  it('reads a stream given as an async iterable', async () => {
    const f = bare({
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => ({ stream: iterable('<it/>') }) },
    });
    expect(await eventsAsync(f.createAsyncStreamReader({ text: INCLUDE, systemId: MAIN }))).toBe(
      `<r ${XI}><it></it></r>`
    );
  });

  it('treats a stream that fails as a resource error', async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('broken'));
      },
    });
    const f = bare({ accessExternalEntities: 'all', entityResolver: { resolveEntity: () => ({ stream: failing }) } });
    expect(await eventsAsync(f.createAsyncStreamReader({ text: WITH_FALLBACK, systemId: MAIN }))).toBe(
      `<r ${XI}>F</r>`
    );
  });

  it('fails in a synchronous reader rather than falling back', () => {
    const f = streaming(STREAMED, (s) => s);
    const xml = `<r ${XI}><xi:include href="part.xml"><xi:fallback>F</xi:fallback></xi:include></r>`;
    const text = `<r ${XI}><xi:include href="note.txt" parse="text"><xi:fallback>F</xi:fallback></xi:include></r>`;
    expect(() => through(f, xml)).toThrow(/answers with a stream, which needs an asynchronous reader/);
    expect(() => through(f, text)).toThrow(/answers with a stream, which needs an asynchronous reader/);
  });
});
