import { normalizePublicId } from '@exemplarjs/xml/internal';

/** The namespace of XML Catalogs. */
export const CATALOG_NAMESPACE = 'urn:oasis:names:tc:entity:xmlns:xml:catalog';

/** How a URN standing for a public identifier starts (§6.4). */
const PUBLICID_URN_PREFIX = 'urn:publicid:';

/** What each escape in a `urn:publicid:` URN stands for (§6.4). */
const URN_ESCAPES: Readonly<Record<string, string>> = {
  '+': ' ',
  ':': '//',
  ';': '::',
  '%2B': '+',
  '%3A': ':',
  '%2F': '/',
  '%3B': ';',
  '%27': "'",
  '%3F': '?',
  '%23': '#',
  '%25': '%',
};

/** Normalizes a public identifier (§6.2), and a system identifier or URI (§6.3), escaping what a URI may not hold. */
export { escapeURI as normalizeURI, normalizePublicId } from '@exemplarjs/xml/internal';

/** The public identifier a `urn:publicid:` URN stands for (§6.4); undefined for anything else. */
export function unwrapURN(uri: string): string | undefined {
  if (uri.slice(0, PUBLICID_URN_PREFIX.length).toLowerCase() !== PUBLICID_URN_PREFIX) return undefined;
  const publicId = uri
    .slice(PUBLICID_URN_PREFIX.length)
    .replaceAll(/[+:;]|%(?:2B|3A|2F|3B|27|3F|23|25)/gi, (escape) => {
      return URN_ESCAPES[escape.toUpperCase()] as string;
    });
  return normalizePublicId(publicId);
}
