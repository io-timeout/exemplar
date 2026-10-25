import type { AsyncStreamReader, StreamReader } from '@exemplarjs/xml';
import type { Headers } from './resources.ts';

/** What an xi:include's attributes ask for, with `parse` and `href` defaulted. */
export interface IncludeAttributes {
  readonly parse: string;
  readonly href: string;
  readonly xpointer: string | undefined;
  readonly accept: string | undefined;
  readonly acceptLanguage: string | undefined;
  readonly encoding: string | undefined;
}

/** What `accept` and `accept-language` may hold: printable ASCII. */
const PRINTABLE_ASCII = /^[ -~]*$/;

/** A `%` that does not begin an escape of two hex digits. */
const STRAY_PERCENT = /%(?![\dA-Fa-f]{2})/;

/** Reads an xi:include's attributes from its start tag. */
export function includeAttributesOf(tag: StreamReader | AsyncStreamReader): IncludeAttributes {
  const attribute = (name: string): string | undefined => tag.attributeValue('', name);
  return {
    parse: attribute('parse') ?? 'xml',
    href: attribute('href') ?? '',
    xpointer: attribute('xpointer'),
    accept: attribute('accept'),
    acceptLanguage: attribute('accept-language'),
    encoding: attribute('encoding'),
  };
}

/** Why XInclude does not allow an xi:include's attribute values or their combination; undefined when it does. */
export function attributeProblem(include: IncludeAttributes): string | undefined {
  const { parse, href, xpointer, accept, acceptLanguage } = include;
  if (parse !== 'xml' && parse !== 'text') return `parse must be xml or text, not ${parse}`;
  if (href.includes('#')) return 'href cannot hold a fragment identifier; xpointer selects part of a document';
  if (STRAY_PERCENT.test(href)) return `${href} is not a well-formed IRI: % must begin an escape of two hex digits`;
  if (href === '' && parse === 'xml' && xpointer === undefined) return 'xi:include needs an href or an xpointer';
  if (parse === 'text' && xpointer !== undefined) return 'xpointer cannot be used with parse="text"';
  if (!PRINTABLE_ASCII.test(accept ?? '') || !PRINTABLE_ASCII.test(acceptLanguage ?? '')) {
    return 'accept and accept-language may hold only printable ASCII';
  }
  return undefined;
}

/** The headers an xi:include asks a resolver to send, leaving out those it does not give. */
export function headersOf(include: IncludeAttributes): Headers {
  const { accept, acceptLanguage } = include;
  return {
    ...(accept !== undefined && { accept }),
    ...(acceptLanguage !== undefined && { acceptLanguage }),
  };
}

/** How the chain of inclusions knows a resource and pointer. */
export function inclusionKey(uri: string, xpointer: string | undefined): string {
  return `${uri}#${xpointer ?? ''}`;
}

/** Whether a reference into the including document leads back to the same part of it in the chain. */
export function isIntraDocumentLoop(chain: readonly string[], uri: string, xpointer: string | undefined): boolean {
  return chain.includes(inclusionKey(uri, xpointer));
}

/** Whether a reference to another document leads back to any part of one in the chain, since all of it is processed. */
export function isDocumentLoop(chain: readonly string[], uri: string): boolean {
  return chain.some((key) => key.startsWith(`${uri}#`));
}
