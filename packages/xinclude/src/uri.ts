/** A URI relative to a base, as `xml:base` fix-ups write it; absolute when no relative reference reaches it from the base. */
export function relativeURI(target: string, base: string): string {
  let targetURL: URL;
  let baseURL: URL;
  try {
    targetURL = new URL(target);
    baseURL = new URL(base);
  } catch {
    return target;
  }
  const [toStart, toPath, toEnd] = splitAroundPath(targetURL);
  const [fromStart, fromPath] = splitAroundPath(baseURL);
  if (toStart !== fromStart || !toPath.startsWith('/') || !fromPath.startsWith('/')) return target;
  const relative = relativePath(toPath, fromPath) + toEnd;
  // File URLs' drive letters can make a path unreachable from another.
  return new URL(relative, baseURL).href === targetURL.href ? relative : target;
}

/** The relative path from an absolute path's directory to another absolute path. */
function relativePath(toPath: string, fromPath: string): string {
  const directory = fromPath.split('/').slice(0, -1);
  const path = toPath.split('/');
  let shared = 0;
  while (shared < directory.length && shared < path.length - 1 && directory[shared] === path[shared]) shared++;
  const up = directory.length - shared;
  const relative = '../'.repeat(up) + path.slice(shared).join('/');
  // An empty path, one starting with "/", or a colon in the first segment would change meaning (RFC 3986 §4.2).
  const ambiguous = up === 0 && (relative === '' || relative.startsWith('/') || (path[shared] as string).includes(':'));
  return ambiguous ? `./${relative}` : relative;
}

/** A URL's serialization in three parts: what comes before its path, its path, and its query and fragment. */
function splitAroundPath(url: URL): [string, string, string] {
  const href = url.href;
  const query = href.search(/[?#]/);
  const end = query === -1 ? href.length : query;
  const path = url.pathname;
  return [href.slice(0, end - path.length), path, href.slice(end)];
}
