import { describe, expect, it } from 'vitest';
import { type CatalogProcessor, type InputOptions, resolveOptions } from '@/config/options.ts';
import {
  ExternalReader,
  ResolutionPendingError,
  locationIn,
  lineLocator,
  unmatchedByCatalog,
} from '@/entities/external.ts';
import { DecoderRegistry } from '@/input/decoders.ts';
import { type OpenedSource, PENDING, UnsupportedEncodingError } from '@/input/source.ts';
import { type ResolveRequest, type ResolvedSource, accessRefusedError } from '@/resolvers/resolver.ts';

/** Throws the refusal a resolver that keeps to the access list throws. */
function refuse(uri: string): never {
  throw accessRefusedError(uri);
}

const encoder = new TextEncoder();
const BASE = 'http://example.org/doc.xml';

/** An external reader with the given options, sync unless asked. */
function readerOf(options: InputOptions, async = false): ExternalReader {
  return new ExternalReader(resolveOptions(options), new DecoderRegistry(), async);
}

/** A resolver that records each request and answers with what `answer` gives. */
function recording(answer: (request: ResolveRequest) => unknown = () => undefined) {
  const asked: ResolveRequest[] = [];
  return {
    asked,
    resolver: {
      resolveEntity: (request: ResolveRequest) => {
        asked.push(request);
        return answer(request) as ResolvedSource | undefined;
      },
    },
  };
}

/** A catalog mapping system ids through a table, reading mapped URIs from another. */
function catalogOf(
  map: Record<string, string>,
  resolution: CatalogProcessor['resolution'] = 'strict',
  files: Record<string, string> = {}
): CatalogProcessor {
  return {
    resolution,
    matchEntity: (_publicId, systemId) => (systemId === undefined ? undefined : map[systemId]),
    matchURI: () => undefined,
    read: (uri) => (files[uri] === undefined ? undefined : { systemId: uri, text: files[uri] }),
  };
}

/** A fail callback that throws an error carrying the code and location, as the reader's does. */
const fail = (code: string, message: string, location: object): never => {
  throw Object.assign(new Error(message), { code, ...location });
};

/** Reads resolved text as an external subset or parameter entity is read. */
function readText(source: ResolvedSource, version11 = false) {
  const reader = readerOf({});
  return reader.readText(reader.openResolved(source, 'urn:e'), 'urn:e', version11, fail);
}

describe('ExternalReader.resolve', () => {
  it('asks nothing without a resolver or a catalog', () => {
    expect(readerOf({ accessExternalDTD: 'all' }).resolve({ name: '[dtd]', systemId: 'a.dtd' }, 'all')).toBeUndefined();
  });

  it('asks the resolver first, whatever the access list, passing the list on with the request', () => {
    const { asked, resolver } = recording(() => ({ text: 'x' }));
    const reader = readerOf({ entityResolver: resolver });
    const request = { name: 'e', systemId: 'e.xml', baseURI: BASE };
    expect(reader.resolve(request, [])).toEqual({ source: { text: 'x' }, systemId: 'http://example.org/e.xml' });
    expect(reader.resolve({ name: 'e', systemId: 'e.xml' }, ['http'])).toEqual({ source: { text: 'x' } });
    expect(asked).toEqual([
      { ...request, access: [] },
      { name: 'e', systemId: 'e.xml', access: ['http'] },
    ]);
  });

  it('passes on the refusal of a resolver that keeps to the access list', () => {
    const resolver = { resolveEntity: () => refuse('http://example.org/e.xml') };
    expect(() => readerOf({ entityResolver: resolver }).resolve({ name: 'e', systemId: 'e.xml' }, [])).toThrow(
      expect.objectContaining({ code: 'ACCESS_REFUSED' })
    );
  });

  it('prefers the system id the resolver gives', () => {
    const { resolver } = recording(() => ({ systemId: 'urn:moved', text: 'x' }));
    expect(
      readerOf({ entityResolver: resolver }).resolve({ name: 'e', systemId: 'e.xml', baseURI: BASE }, 'all')
    ).toEqual({
      source: { systemId: 'urn:moved', text: 'x' },
      systemId: 'urn:moved',
    });
  });

  it('gives nothing when the resolver supplies nothing', () => {
    const { resolver } = recording();
    expect(readerOf({ entityResolver: resolver }).resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toBeUndefined();
  });

  it('asks the catalog after the resolver, then the resolver again for the URI the catalog maps to', () => {
    const { asked, resolver } = recording((request) =>
      request.systemId === 'file:///local/e.xml' ? { text: 'local' } : undefined
    );
    const catalog = catalogOf({ 'http://remote/e.xml': 'file:///local/e.xml' });
    const reader = readerOf({ entityResolver: resolver, catalog });
    const request = { name: 'e', publicId: '-//E//EN', systemId: 'http://remote/e.xml' };
    expect(reader.resolve(request, ['file'])).toEqual({ source: { text: 'local' }, systemId: 'http://remote/e.xml' });
    expect(asked).toEqual([
      { ...request, access: ['file'] },
      { name: 'e', systemId: 'file:///local/e.xml', publicId: '-//E//EN', access: ['file'] },
    ]);
  });

  it('reads a mapped URI with the catalog when no resolver supplies it', () => {
    const catalog = catalogOf({ 'urn:e': 'file:///local/e.xml' }, 'strict', { 'file:///local/e.xml': 'from catalog' });
    expect(readerOf({ catalog }).resolve({ name: 'e', systemId: 'urn:e' }, ['file'])).toEqual({
      source: { systemId: 'file:///local/e.xml', text: 'from catalog' },
      systemId: 'file:///local/e.xml',
    });
  });

  it('refuses a catalog read the access list does not allow, checking the URI the catalog maps to', () => {
    const catalog = catalogOf({ 'urn:e': 'http://elsewhere/e.xml' }, 'strict', { 'http://elsewhere/e.xml': 'x' });
    expect(() => readerOf({ catalog }).resolve({ name: 'e', systemId: 'urn:e' }, ['file'])).toThrow(
      "Reading http://elsewhere/e.xml is not allowed: the access list does not name 'http'"
    );
    expect(readerOf({ catalog }).resolve({ name: 'e', systemId: 'urn:e' }, ['http'])?.source.text).toBe('x');
  });

  it('does what the catalog’s resolution says when nothing matches', () => {
    const request = { name: 'e', publicId: '-//E//EN', systemId: 'e.xml', baseURI: BASE };
    expect(readerOf({ catalog: catalogOf({}, 'continue') }).resolve(request, 'all')).toBeUndefined();
    expect(readerOf({ catalog: catalogOf({}, 'ignore') }).resolve(request, 'all')).toEqual({
      source: { text: '', systemId: 'http://example.org/e.xml' },
      systemId: 'http://example.org/e.xml',
    });
    expect(() => readerOf({ catalog: catalogOf({}, 'strict') }).resolve(request, 'all')).toThrow(
      expect.objectContaining({
        code: 'CATALOG_NO_MATCH',
        message: 'No catalog entry matches public id -//E//EN or system id http://example.org/e.xml',
      })
    );
  });

  it('names a relative system id as written when nothing matches and it cannot be made absolute', () => {
    expect(() => readerOf({ catalog: catalogOf({}) }).resolve({ name: 'e', systemId: 'e.xml' }, 'all')).toThrow(
      'No catalog entry matches system id e.xml'
    );
  });

  it('refuses a promise in a synchronous reader', () => {
    const { resolver } = recording(() => Promise.resolve({ text: 'x' }));
    expect(() => readerOf({ entityResolver: resolver }).resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toThrow(
      TypeError
    );
  });
});

describe('ExternalReader.resolve in an asynchronous reader', () => {
  it('asks each resolver once per request, keeping its answer', () => {
    const { asked, resolver } = recording(() => ({ text: 'x' }));
    const reader = readerOf({ entityResolver: resolver }, true);
    const request = { name: 'e', systemId: 'urn:e' };
    reader.resolve(request, 'all');
    expect(reader.resolve(request, 'all')).toEqual({ source: { text: 'x' }, systemId: 'urn:e' });
    expect(asked).toHaveLength(1);
  });

  it('waits for a promise, then gives its answer', async () => {
    const { asked, resolver } = recording(() => Promise.resolve({ text: 'later' }));
    const reader = readerOf({ entityResolver: resolver }, true);
    const request = { name: 'e', systemId: 'urn:e' };
    expect(() => reader.resolve(request, 'all')).toThrow(ResolutionPendingError);
    await reader.pending;
    expect(reader.resolve(request, 'all')).toEqual({ source: { text: 'later' }, systemId: 'urn:e' });
    expect(asked).toHaveLength(1);
  });

  it('keeps a promise that gives nothing as no answer', async () => {
    const { resolver } = recording(() => Promise.resolve(undefined));
    const reader = readerOf({ entityResolver: resolver }, true);
    expect(() => reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toThrow(ResolutionPendingError);
    await reader.pending;
    expect(reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toBeUndefined();
  });

  it('reads a stream answer into bytes', async () => {
    /** An element's bytes in two chunks. */
    async function* chunks() {
      yield encoder.encode('<b>');
      yield encoder.encode('</b>');
    }
    const { resolver } = recording(() => ({ systemId: 'urn:s', stream: chunks() }));
    const reader = readerOf({ entityResolver: resolver }, true);
    expect(() => reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toThrow(ResolutionPendingError);
    await reader.pending;
    expect(reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toEqual({
      source: { systemId: 'urn:s', bytes: encoder.encode('<b></b>') },
      systemId: 'urn:s',
    });
  });

  it('throws what a rejected promise failed with when asked again', async () => {
    const failure = new RangeError('refused');
    const { resolver } = recording(() => Promise.reject(failure));
    const reader = readerOf({ entityResolver: resolver }, true);
    expect(() => reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toThrow(ResolutionPendingError);
    await reader.pending;
    expect(() => reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toThrow(failure);
  });

  it('waits for a catalog read through a promise', async () => {
    const resolver = {
      resolveEntity: (request: ResolveRequest) =>
        Promise.resolve(request.systemId === 'file:///l' ? { text: 'l' } : undefined),
    };
    const reader = readerOf({ entityResolver: resolver, catalog: catalogOf({ 'urn:e': 'file:///l' }) }, true);
    expect(() => reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toThrow(ResolutionPendingError);
    await reader.pending;
    expect(reader.resolve({ name: 'e', systemId: 'urn:e' }, 'all')).toEqual({
      source: { text: 'l' },
      systemId: 'urn:e',
    });
  });
});

describe('ExternalReader.externalSubset (SAX EntityResolver2.getExternalSubset)', () => {
  it('asks a resolver that offers external subsets, with the root name and base URI', () => {
    const asked: unknown[] = [];
    const reader = readerOf({
      entityResolver: {
        resolveEntity: () => undefined,
        getExternalSubset: (request) => {
          asked.push(request);
          return request.name === 'a' ? { systemId: 'urn:subset', text: '<!ENTITY e "x">' } : undefined;
        },
      },
    });
    expect(reader.externalSubset('a', BASE)).toEqual({
      source: { systemId: 'urn:subset', text: '<!ENTITY e "x">' },
      systemId: 'urn:subset',
    });
    expect(reader.externalSubset('b', undefined)).toBeUndefined();
    expect(asked).toEqual([{ name: 'a', baseURI: BASE }, { name: 'b' }]);
  });

  it('gives no system id when the resolver names none, and nothing without the method', () => {
    const offering = readerOf({
      entityResolver: { resolveEntity: () => undefined, getExternalSubset: () => ({ text: '' }) },
    });
    expect(offering.externalSubset('a', undefined)).toEqual({ source: { text: '' } });
    expect(readerOf({ entityResolver: { resolveEntity: () => undefined } }).externalSubset('a', BASE)).toBeUndefined();
  });
});

describe('ExternalReader.open and readText', () => {
  it('reads text whole, its line ends normalized and its text declaration skipped, offsets counting the text as given (§4.3.1, §2.11)', () => {
    const { text, systemId, locate } = readText({ text: '<?xml version="1.0" encoding="UTF-8"?>a\r\nb\rc' });
    expect([text, systemId]).toEqual(['a\nb\nc', 'urn:e']);
    expect(locate(2)).toEqual({ line: 2, column: 1, offset: 41, systemId: 'urn:e' });
  });

  it('reads bytes in the encoding they declare, or the one given from outside', () => {
    const latin1 = new Uint8Array([...encoder.encode('<?xml encoding="ISO-8859-1"?>'), 0xe9]);
    expect(readText({ bytes: latin1 }).text).toBe('é');
    expect(readText({ bytes: new Uint8Array([0xe9]), encoding: 'ISO-8859-1' }).text).toBe('é');
  });

  it('keeps text that only starts like a text declaration', () => {
    expect(readText({ text: '<?xml-stylesheet x?>' }).text).toBe('<?xml-stylesheet x?>');
  });

  it.each([
    ['<?xml version="1.0"?>x', 'WF_TEXT_DECLARATION'],
    ['<?xml encoding="UTF-8" standalone="yes"?>x', 'WF_TEXT_DECLARATION'],
    ['<?xml version="1.1" encoding="UTF-8"?>x', 'WF_ENTITY_VERSION'],
  ])('rejects the text declaration of %s', (text, code) => {
    expect(() => readText({ text })).toThrow(expect.objectContaining({ code, systemId: 'urn:e' }));
  });

  it('reports a line end inside a text declaration as the document entity does (§2.11)', () => {
    expect(() => readText({ text: '<?xml version="1.1"\u0085encoding="UTF-8"?>x' }, true)).toThrow(
      expect.objectContaining({ code: 'WF_LINE_END_IN_DECLARATION', systemId: 'urn:e' })
    );
  });

  it('accepts an XML 1.1 entity in an XML 1.1 document', () => {
    expect(readText({ text: '<?xml version="1.1" encoding="UTF-8"?>x' }, true).text).toBe('x');
  });

  it('rejects bytes whose text declaration contradicts their byte-order mark (§4.3.3)', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('<?xml encoding="UTF-16"?>x')]);
    expect(() => readText({ bytes })).toThrow(expect.objectContaining({ code: 'ENCODING_MISMATCH' }));
  });

  it('rejects bytes that are not legal in their encoding, where they are', () => {
    const bytes = new Uint8Array([...encoder.encode('ab\ncd'), 0xc0]);
    expect(() => readText({ bytes })).toThrow(
      expect.objectContaining({ code: 'ENCODING_INVALID_BYTES', line: 2, column: 3, systemId: 'urn:e' })
    );
  });

  it.each([
    ['CR LF', '\r\n', false],
    ['a lone CR', '\r', false],
    ['NEL and LS in XML 1.1', '\u0085', true],
  ])('counts %s as a line end when it locates bytes that are not legal (§2.11)', (_, lineEnd, version11) => {
    const bytes = new Uint8Array([...encoder.encode(`ab${lineEnd}cd\u2028ef`), 0xc0]);
    const line = version11 ? 3 : 2;
    const column = version11 ? 3 : 6;
    expect(() => readText({ bytes }, version11)).toThrow(
      expect.objectContaining({ code: 'ENCODING_INVALID_BYTES', line, column })
    );
  });

  it.each([
    ['a\u0000', false, 2],
    ['ab\u0008', false, 3],
    ['\uFFFE', false, 1],
    ['a\uD800b', false, 2],
    ['a\uDC00', false, 2],
    ['\u007F', true, 1],
    ['x\u0090', true, 2],
  ])('rejects the character in %j (§2.2)', (text, version11, column) => {
    expect(() => readText({ text }, version11)).toThrow(
      expect.objectContaining({ code: 'WF_INVALID_CHARACTER', line: 1, column })
    );
  });

  it('accepts surrogate pairs, the C1 controls in XML 1.0 and NEL in XML 1.1', () => {
    expect(readText({ text: 'a𝄞b\u007F\u0090' }).text).toBe('a𝄞b\u007F\u0090');
    expect(readText({ text: 'a\u0085b' }, true).text).toBe('a\nb');
  });

  it('locates text without a system id', () => {
    const reader = readerOf({});
    const read = reader.readText(reader.openResolved({ text: 'x' }, undefined), undefined, false, fail);
    expect([read.systemId, read.locate(0)]).toEqual([undefined, { line: 1, column: 1, offset: 0 }]);
  });

  it('refuses a stream in a synchronous reader', () => {
    /** An element's bytes in two chunks. */
    async function* chunks() {
      yield encoder.encode('x');
    }
    const reader = readerOf({});
    expect(() => reader.openResolved({ stream: chunks() }, 'urn:e')).toThrow(TypeError);
  });

  it('passes on an encoding no decoder supports', () => {
    expect(() => readText({ bytes: encoder.encode('<?xml encoding="x-unknown"?>') })).toThrow(UnsupportedEncodingError);
  });

  it('refuses a source that would have to wait for input', () => {
    const waiting: OpenedSource = {
      text: { read: (): typeof PENDING => PENDING, detection: undefined },
    };
    expect(() => readerOf({}).readText(waiting, 'urn:e', false, fail)).toThrow(TypeError);
  });

  it('opens a source with its public id and system id', () => {
    const opened = readerOf({}).openResolved({ text: 'x', publicId: '-//P//EN' }, 'urn:e');
    expect([opened.systemId, opened.publicId, opened.text.read()]).toEqual(['urn:e', '-//P//EN', 'x']);
  });
});

describe('unmatched', () => {
  it('describes whichever identifiers there are', () => {
    expect(() => unmatchedByCatalog(catalogOf({}), undefined, 'urn:s')).toThrow(
      'No catalog entry matches system id urn:s'
    );
    expect(() => unmatchedByCatalog(catalogOf({}), '-//P//EN', undefined)).toThrow(
      'No catalog entry matches public id -//P//EN'
    );
  });

  it('gives empty content with no system id under ignore', () => {
    expect(unmatchedByCatalog(catalogOf({}, 'ignore'), '-//P//EN', undefined)).toEqual({ text: '' });
  });
});

describe('locator', () => {
  it('gives the line and column of each index, counting lines from 1', () => {
    const locate = lineLocator('ab\ncd\n\nef', 'urn:x');
    const places = [0, 2, 3, 5, 6, 7, 8, 9].map((i) => [locate(i).line, locate(i).column]);
    expect(places).toEqual([
      [1, 1],
      [1, 3],
      [2, 1],
      [2, 3],
      [3, 1],
      [4, 1],
      [4, 2],
      [4, 3],
    ]);
    expect(locate(8)).toEqual({ line: 4, column: 2, offset: 8, systemId: 'urn:x' });
  });
});

describe('locationIn', () => {
  it('counts lines and columns in text whose line ends are LF', () => {
    expect(locationIn('ab\ncd\n\nef', 8, 'urn:x')).toEqual({ line: 4, column: 2, offset: 8, systemId: 'urn:x' });
    expect(locationIn('ab', 0, undefined)).toEqual({ line: 1, column: 1, offset: 0 });
    expect(locationIn('ab\n', 3, undefined)).toEqual({ line: 2, column: 1, offset: 3 });
  });
});

describe('ResolutionPendingError', () => {
  it('names itself', () => {
    const error = new ResolutionPendingError();
    expect([error.name, error.message, error instanceof Error]).toEqual([
      'ResolutionPendingError',
      'A resolver has yet to answer',
      true,
    ]);
  });
});
