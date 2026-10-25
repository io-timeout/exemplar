import { describe, expect, it } from 'vitest';
import {
  type CatalogProcessor,
  ErrorCode,
  EventType,
  type InputOptions,
  ResolutionError,
  type ResolveRequest,
  type ResolvedSource,
  XMLInputFactory,
} from '@exemplarjs/xml';
import type { ResolvedOptions } from '@exemplarjs/xml/internal';
import { Pending, ResourceError, contentOf, findResource, isStreamOnly, waitFor } from '@/resources.ts';

const BASE = 'file:///doc/main.xml';

/** Options with every default filled in, as a reader has them. */
function options(input: InputOptions): ResolvedOptions {
  return new XMLInputFactory(input).options;
}

/** A catalog mapping one URI to another, read from memory. */
function catalog(from: string, to: string, resolution: CatalogProcessor['resolution'] = 'strict'): CatalogProcessor {
  return {
    resolution,
    matchEntity: () => undefined,
    matchURI: (uri) => (uri === from ? to : undefined),
    read: (uri) => ({ text: `<read uri="${uri}"/>`, systemId: uri }),
  };
}

/** A stream of one chunk. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('contentOf', () => {
  it('gives a string source as text', () => {
    expect(contentOf('<a/>')).toEqual({ text: '<a/>' });
  });

  it('gives a byte source as bytes', () => {
    const bytes = new TextEncoder().encode('<a/>');
    expect(contentOf(bytes)).toEqual({ bytes });
  });

  it('gives a source object its text before its bytes, without its identifiers', () => {
    const bytes = new TextEncoder().encode('<b/>');
    expect(contentOf({ text: '<a/>', bytes, systemId: BASE })).toEqual({ text: '<a/>' });
    expect(contentOf({ bytes, systemId: BASE })).toEqual({ bytes });
  });

  it('gives nothing for a stream, a source object with neither, or no source', () => {
    expect(contentOf(streamOf('<a/>'))).toBeUndefined();
    expect(contentOf({ systemId: BASE })).toBeUndefined();
    expect(contentOf(undefined)).toBeUndefined();
  });
});

describe('findResource', () => {
  it('asks the URI resolver with the href made absolute, the headers and the access list', () => {
    const asked: unknown[] = [];
    const found = findResource(
      options({
        accessExternalEntities: ['file'],
        uriResolver: {
          resolve: (href, base, headers) => {
            asked.push(href, base, headers);
            return { text: '<part/>' };
          },
        },
      }),
      'part.xml',
      BASE,
      { accept: 'text/xml' }
    );
    expect(found).toEqual({ uri: 'file:///doc/part.xml', source: { text: '<part/>' } });
    expect(asked).toEqual(['part.xml', BASE, { accept: 'text/xml', access: ['file'] }]);
  });

  it('asks the entity resolver when the URI resolver gives nothing', () => {
    const requests: ResolveRequest[] = [];
    const resolver = {
      resolveEntity: (request: ResolveRequest) => {
        requests.push(request);
        return { text: '<part/>' };
      },
    };
    const found = findResource(options({ entityResolver: resolver }), 'part.xml', BASE, { acceptLanguage: 'fr' });
    expect(found.source).toEqual({ text: '<part/>' });
    expect(requests).toEqual([
      { name: '[xinclude]', systemId: 'part.xml', baseURI: BASE, acceptLanguage: 'fr', access: [] },
    ]);
  });

  it('reads what the catalog maps a resource to when no resolver supplies it', () => {
    const mapped = 'file:///mapped/part.xml';
    const found = findResource(
      options({ catalog: catalog('part.xml', mapped), accessExternalEntities: 'all' }),
      'part.xml',
      BASE,
      {}
    );
    expect(found).toEqual({
      uri: 'file:///doc/part.xml',
      source: { text: `<read uri="${mapped}"/>`, systemId: mapped },
    });
  });

  it('refuses to read a catalog target the access list does not allow', () => {
    const resolve = () =>
      findResource(options({ catalog: catalog('part.xml', 'file:///mapped/part.xml') }), 'part.xml', BASE, {});
    expect(resolve).toThrow(expect.objectContaining({ code: ErrorCode.ACCESS_REFUSED }));
  });

  it('fails on a resource a strict catalog does not match, and leaves it to a fallback under continue', () => {
    const strict = () => findResource(options({ catalog: catalog('other.xml', BASE) }), 'part.xml', BASE, {});
    expect(strict).toThrow(expect.objectContaining({ code: ErrorCode.CATALOG_NO_MATCH }));
    const continuing = () =>
      findResource(options({ catalog: catalog('other.xml', BASE, 'continue') }), 'part.xml', BASE, {});
    expect(continuing).toThrow(new ResourceError('No resolver supplies file:///doc/part.xml'));
  });

  it('gives a resource error when no resolver supplies the resource', () => {
    expect(() => findResource(options({}), 'part.xml', BASE, {})).toThrow(
      new ResourceError('No resolver supplies file:///doc/part.xml')
    );
  });

  it('gives a resource error for a relative href with no base URI', () => {
    expect(() => findResource(options({}), 'part.xml', '', {})).toThrow(
      new ResourceError('part.xml cannot be resolved against no base URI')
    );
  });
});

describe('isStreamOnly', () => {
  it('is true only for an answer with a stream and no text or bytes', () => {
    expect(isStreamOnly({ stream: streamOf('<a/>') })).toBe(true);
    expect(isStreamOnly({ stream: streamOf('<a/>'), text: '<a/>' })).toBe(false);
    expect(isStreamOnly({ text: '<a/>' })).toBe(false);
  });
});

describe('waitFor', () => {
  const resume = () => 0;

  it('settles with a promised answer', async () => {
    const answer: ResolvedSource = { text: '<a/>' };
    const waiting = waitFor(BASE, Promise.resolve(answer), resume);
    expect(waiting.hasSettled).toBe(false);
    await waiting.promise;
    expect(waiting).toMatchObject({ hasSettled: true, hasFailed: false, answer });
  });

  it('reads a stream whole into bytes, as the cursor reads one a resolver answers with', async () => {
    const waiting = waitFor(BASE, { stream: streamOf('<a/>'), systemId: BASE }, resume);
    await waiting.promise;
    expect(waiting.answer).toEqual({ systemId: BASE, bytes: new TextEncoder().encode('<a/>') });
  });

  it('records what a rejected answer failed with', async () => {
    const failure = new Error('offline');
    const waiting = waitFor(BASE, Promise.reject(failure), resume);
    await waiting.promise;
    expect(waiting).toMatchObject({ hasSettled: true, hasFailed: true, failure, answer: undefined });
  });
});

describe('Pending', () => {
  /** A pending answer that has settled, from a resolver that answered with `found`. */
  async function settled(found: Promise<ResolvedSource | undefined>): Promise<Pending> {
    const pending = new Pending();
    pending.wait(BASE, found, () => 0);
    await pending.fill();
    return pending;
  }

  it('gives NEED_INPUT until the answer comes, then goes on with it', async () => {
    const pending = new Pending();
    const answer: ResolvedSource = { text: '<a/>', systemId: 'file:///doc/answer.xml' };
    const resumed: [ResolvedSource, string][] = [];
    const resume = (source: ResolvedSource, uri: string) => resumed.push([source, uri]) + 6;
    expect(pending.wait(BASE, Promise.resolve(answer), resume)).toBe(EventType.NEED_INPUT);
    expect(pending.waiting).toBe(true);
    await pending.fill();
    expect(pending.resume()).toBe(7);
    expect(resumed).toEqual([[answer, 'file:///doc/answer.xml']]);
    expect(pending.waiting).toBe(false);
    expect(pending.fill()).toBeUndefined();
  });

  it('throws when asked for input again before a fill', () => {
    const pending = new Pending();
    pending.wait(BASE, new Promise(() => {}), () => 0);
    expect(() => pending.resume()).toThrow('await fill() before calling next() again');
    expect(pending.fill()).toBeInstanceOf(Promise);
    expect(pending.resume()).toBe(EventType.NEED_INPUT);
  });

  it('rethrows a ResolutionError the resolver rejects with', async () => {
    const refused = new ResolutionError(ErrorCode.ACCESS_REFUSED, 'Reading is refused');
    const pending = await settled(Promise.reject(refused));
    expect(() => pending.resume()).toThrow(refused);
  });

  it('makes any other failure, or no answer, a resource error', async () => {
    const failed = await settled(Promise.reject(new Error('offline')));
    expect(() => failed.resume()).toThrow(/^Reading .* failed$/);
    const unanswered = await settled(Promise.resolve(undefined));
    expect(() => unanswered.resume()).toThrow(/^No resolver supplies /);
  });

  it('refuses to go on when no answer is awaited', () => {
    expect(() => new Pending().resume()).toThrow('No resolver answer is awaited');
  });
});
