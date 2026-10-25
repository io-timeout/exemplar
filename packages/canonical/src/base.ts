/** A URI reference's parts (RFC 3986 Appendix B), without its fragment; an absent part is undefined. */
interface URIParts {
  readonly scheme: string | undefined;
  readonly authority: string | undefined;
  readonly path: string;
  readonly query: string | undefined;
}

/** Matches a URI reference's scheme, authority, path and query (RFC 3986 Appendix B). */
const URI_PARTS = /^(?:([A-Za-z][\d+.A-Za-z-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?/;

/** Splits a URI reference into its parts. */
function splitURI(uri: string): URIParts {
  const [, scheme, authority, path = '', query] = URI_PARTS.exec(uri) as RegExpExecArray;
  return { scheme, authority, path, query };
}

/** Puts parts back together (RFC 3986 §5.3). */
function composeURI(
  scheme: string | undefined,
  authority: string | undefined,
  path: string,
  query: string | undefined
): string {
  let uri = scheme === undefined ? '' : `${scheme}:`;
  if (authority !== undefined) uri += `//${authority}`;
  uri += path;
  return query === undefined ? uri : `${uri}?${query}`;
}

/** Removes dot segments as C14N 1.1 §2.4 modifies RFC 3986 §5.2.4: keeps leading `..`, collapses `//`, ends a trailing `..` with `/`. */
export function removeDotSegments(path: string): string {
  const collapsed = path.replaceAll(/\/{2,}/g, '/');
  const absolute = collapsed.startsWith('/');
  const segments = (absolute ? collapsed.slice(1) : collapsed).split('/');
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === '..') applyParentSegment(kept, absolute);
    else if (segment !== '.') kept.push(segment);
  }
  // A path ending in a dot segment names a directory.
  const last = segments.at(-1);
  if (last === '.' || last === '..') kept.push('');
  return (absolute ? '/' : '') + kept.join('/');
}

/** Applies a `..` segment: removes the segment before it, or keeps the `..` when a relative path has none to remove. */
function applyParentSegment(kept: string[], absolute: boolean): void {
  if (kept.length > 0 && kept.at(-1) !== '..') kept.pop();
  else if (!absolute) kept.push('..');
}

/** Merges a relative path onto a base path (RFC 3986 §5.2.3): the path replaces the base's last segment. */
function mergePaths(base: URIParts, basePath: string, path: string): string {
  if (base.authority !== undefined && basePath === '') return `/${path}`;
  return basePath.slice(0, basePath.lastIndexOf('/') + 1) + path;
}

/** The join-URI-References function of C14N 1.1 §2.4: RFC 3986 §5.2.2 on strings, where the base may be relative. */
export function joinURIReferences(base: string, reference: string): string {
  const ref = splitURI(reference);
  if (ref.scheme !== undefined) return composeURI(ref.scheme, ref.authority, removeDotSegments(ref.path), ref.query);
  const from = splitURI(base);
  if (ref.authority !== undefined)
    return composeURI(from.scheme, ref.authority, removeDotSegments(ref.path), ref.query);
  // The base's trailing `..` is a directory.
  const basePath = from.path.replace(/(?:^|\/)\.\.$/, '$&/');
  if (ref.path === '') return composeURI(from.scheme, from.authority, basePath, ref.query ?? from.query);
  if (ref.path.startsWith('/')) return composeURI(from.scheme, from.authority, removeDotSegments(ref.path), ref.query);
  return composeURI(from.scheme, from.authority, removeDotSegments(mergePaths(from, basePath, ref.path)), ref.query);
}
