/** Writes the UTF-8 that escapes are made of. */
const ENCODER = new TextEncoder();

/**
 * A character a URI reference may not hold as it is, as XML 1.1 §4.2.2 lists them: the controls #x0-#x1F
 * and #x7F, the space, `"`, `<`, `>`, `\`, `^`, `` ` ``, `{`, `|` and `}`, and everything above #x7F.
 */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const NEEDS_ESCAPING = /[\u0000-\u0020"<>\\^`{|}\u007F-\uFFFF]/;

/** Escapes each character a URI reference may not hold as `%HH`, one per byte of its UTF-8. */
export function escapeURI(uri: string): string {
  if (!NEEDS_ESCAPING.test(uri)) return uri;
  let escaped = '';
  for (const char of uri) {
    if (NEEDS_ESCAPING.test(char)) {
      for (const byte of ENCODER.encode(char)) escaped += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

/** Whether a URI reference is absolute, starting with a scheme such as `http:`. */
export function hasScheme(uri: string): boolean {
  return /^[A-Za-z][\d+.A-Za-z-]*:/.test(uri);
}

/** Resolves a URI against a base URI; undefined when there is no URI, or it can't be made absolute. */
export function resolveURI(uri: string | undefined, baseURI: string | undefined): string | undefined {
  if (uri === undefined) return undefined;
  try {
    return new URL(uri, baseURI).href;
  } catch {
    return undefined;
  }
}

/**
 * Escapes a URI reference, as XML Base and XML 1.1 §4.2.2 say, then resolves it against a base
 * URI; undefined when it can't be made absolute.
 */
export function escapeAndResolveURI(reference: string, baseURI: string | undefined): string | undefined {
  return resolveURI(escapeURI(reference), baseURI);
}

/** The scheme of an absolute URI, lower-cased, such as `https`, as access lists name it. */
export function protocolOf(uri: string): string {
  return uri.slice(0, uri.indexOf(':')).toLowerCase();
}
