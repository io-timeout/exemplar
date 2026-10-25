import { resolveURI } from '../util/uri.ts';
import { type EntityResolver, type ResolvedSource, checkAccess } from './resolver.ts';

/** Settings for `fetchResolver`. */
export interface FetchResolverOptions {
  /** The `fetch` to use; the global one by default. */
  readonly fetch?: typeof fetch;
}

/** Reads `http:` and `https:` entities and DTDs with `fetch`, as the access list allows; only asynchronous readers can use it. */
export function fetchResolver(options: FetchResolverOptions = {}): EntityResolver {
  const get = options.fetch ?? fetch;
  return {
    async resolveEntity(request): Promise<ResolvedSource | undefined> {
      const { systemId, baseURI, accept, acceptLanguage } = request;
      const uri = resolveURI(systemId, baseURI);
      if (uri === undefined || !/^https?:/i.test(uri)) return;
      checkAccess(request, uri);
      // XInclude's accept and accept-language become the request's headers.
      const headers = {
        ...(accept !== undefined && { Accept: accept }),
        ...(acceptLanguage !== undefined && { 'Accept-Language': acceptLanguage }),
      };
      const response = await get(uri, { headers });
      if (!response.ok) return;
      // An HTTP charset is an encoding supplied from outside (RFC 7303).
      const charset = /charset=([^;]+)/i.exec(response.headers.get('content-type') ?? '')?.[1]?.trim();
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { systemId: response.url || uri, bytes, ...(charset !== undefined && { encoding: charset }) };
    },
  };
}
