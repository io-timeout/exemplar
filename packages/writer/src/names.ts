import { isNcName } from '@exemplarjs/xml/internal';

/** Names already found to be XML names without colons; documents repeat their names. */
const NC_NAMES = new Set<string>();

/** How many names `NC_NAMES` remembers at most. */
const NC_NAMES_LIMIT = 10_000;

/** Whether a name is an XML name without colons, remembering the ones that are. */
export function isKnownNcName(name: string): boolean {
  if (NC_NAMES.has(name)) return true;
  if (!isNcName(name)) return false;
  if (NC_NAMES.size < NC_NAMES_LIMIT) NC_NAMES.add(name);
  return true;
}

/** A qualified name: the local name, after the prefix and a colon when there is one. */
export function qualifiedName(prefix: string, localName: string): string {
  return prefix === '' ? localName : `${prefix}:${localName}`;
}
