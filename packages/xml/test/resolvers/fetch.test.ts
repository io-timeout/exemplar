import { canonicalOfAsync } from '@test/helpers/canonical.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { XMLInputFactory } from '@/index.ts';
import { fetchResolver } from '@/resolvers/fetch.ts';

/** A stub fetch that records its calls and answers with a response made from what `respond` gives. */
function stubFetch(
  respond: (url: string) => { body?: string; status?: number; headers?: Record<string, string>; url?: string }
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  /** Records the call and answers with the response `respond` describes. */
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = url instanceof Request ? url.url : url.toString();
    calls.push({ url: href, init });
    const { body = '', status = 200, headers = {}, url: final } = respond(href);
    const response = new Response(new TextEncoder().encode(body), { status, headers });
    if (final !== undefined) Object.defineProperty(response, 'url', { value: final });
    return response;
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchResolver', () => {
  it('fetches an http or https system id, resolved against the base URI', async () => {
    const { calls, fetch } = stubFetch(() => ({ body: '<!ENTITY e "x">' }));
    const resolver = fetchResolver({ fetch });
    const resolved = await resolver.resolveEntity({
      name: '[dtd]',
      systemId: 'a.dtd',
      baseURI: 'https://example.org/d/doc.xml',
    });
    expect(calls).toEqual([{ url: 'https://example.org/d/a.dtd', init: { headers: {} } }]);
    expect(resolved).toEqual({
      systemId: 'https://example.org/d/a.dtd',
      bytes: new TextEncoder().encode('<!ENTITY e "x">'),
    });
    expect(await resolver.resolveEntity({ name: '[dtd]', systemId: 'HTTP://example.org/a.dtd' })).toBeDefined();
  });

  it('keeps to the access list a request carries, fetching nothing it does not allow', async () => {
    const { calls, fetch } = stubFetch(() => ({ body: '<!ENTITY e "x">' }));
    const resolver = fetchResolver({ fetch });
    const request = { name: '[dtd]', systemId: 'https://example.org/a.dtd' };
    await expect(resolver.resolveEntity({ ...request, access: ['http'] })).rejects.toMatchObject({
      code: 'ACCESS_REFUSED',
      message: "Reading https://example.org/a.dtd is not allowed: the access list does not name 'https'",
    });
    expect(calls).toEqual([]);
    await expect(resolver.resolveEntity({ ...request, access: ['https'] })).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it('takes the charset of the response as an encoding given from outside (RFC 7303)', async () => {
    const { fetch } = stubFetch(() => ({
      headers: { 'content-type': 'application/xml-dtd; Charset= ISO-8859-1 ; x=y' },
    }));
    const resolved = await fetchResolver({ fetch }).resolveEntity({
      name: '[dtd]',
      systemId: 'http://example.org/a.dtd',
    });
    expect(resolved).toMatchObject({ encoding: 'ISO-8859-1' });
    const plain = stubFetch(() => ({ headers: { 'content-type': 'application/xml' } }));
    expect(
      await fetchResolver({ fetch: plain.fetch }).resolveEntity({ name: 'e', systemId: 'http://x/e' })
    ).not.toHaveProperty('encoding');
  });

  it('gives the URL the response came from, after redirects, as the system id', async () => {
    const { fetch } = stubFetch(() => ({ url: 'https://mirror.example.org/a.dtd' }));
    const resolved = await fetchResolver({ fetch }).resolveEntity({
      name: '[dtd]',
      systemId: 'http://example.org/a.dtd',
    });
    expect(resolved?.systemId).toBe('https://mirror.example.org/a.dtd');
  });

  it('sends the Accept and Accept-Language headers XInclude asks for', async () => {
    const { calls, fetch } = stubFetch(() => ({}));
    await fetchResolver({ fetch }).resolveEntity({
      name: 'include',
      systemId: 'http://example.org/t.xml',
      accept: 'application/xml',
      acceptLanguage: 'en',
    });
    expect(calls[0]?.init).toEqual({ headers: { Accept: 'application/xml', 'Accept-Language': 'en' } });
  });

  it('supplies nothing for a failed response', async () => {
    const { fetch } = stubFetch(() => ({ status: 404 }));
    expect(
      await fetchResolver({ fetch }).resolveEntity({ name: 'e', systemId: 'http://example.org/missing' })
    ).toBeUndefined();
  });

  it('leaves other protocols and system ids it cannot make absolute to the next resolver, without fetching', async () => {
    const { calls, fetch } = stubFetch(() => ({}));
    const resolver = fetchResolver({ fetch });
    expect(await resolver.resolveEntity({ name: 'e', systemId: 'file:///a.dtd' })).toBeUndefined();
    expect(await resolver.resolveEntity({ name: 'e', systemId: 'a.dtd' })).toBeUndefined();
    expect(await resolver.resolveEntity({ name: 'e' })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('uses the global fetch by default', async () => {
    const { calls, fetch } = stubFetch(() => ({ body: 'x' }));
    vi.stubGlobal('fetch', fetch);
    await fetchResolver().resolveEntity({ name: 'e', systemId: 'http://example.org/e' });
    expect(calls.map((c) => c.url)).toEqual(['http://example.org/e']);
  });

  it('serves an asynchronous reader the external subset and entities', async () => {
    const files: Record<string, string> = {
      'http://example.org/a.dtd': '<!ENTITY e SYSTEM "e.xml">',
      'http://example.org/e.xml': '<b>fetched</b>',
    };
    const { fetch } = stubFetch((url) => (files[url] === undefined ? { status: 404 } : { body: files[url] }));
    const factory = new XMLInputFactory({
      entityResolver: fetchResolver({ fetch }),
      accessExternalDTD: ['http'],
      accessExternalEntities: ['http'],
    });
    const reader = factory.createAsyncStreamReader({
      text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>',
      systemId: 'http://example.org/doc.xml',
    });
    expect(await canonicalOfAsync(reader)).toBe('<a><b>fetched</b></a>');
  });
});
