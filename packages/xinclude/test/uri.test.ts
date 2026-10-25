import { describe, expect, it } from 'vitest';
import { relativeURI } from '@/uri.ts';

const SEGMENTS = ['', 'a', 'b', 'a:b', '%2E', 'C:'];

/** Paths of up to three segments, empty ones, dot segments and colons among them. */
const PATHS = ['/'].concat(
  SEGMENTS.flatMap((s) => ['', ...SEGMENTS].flatMap((t) => [`/${s}`, `/${s}/${t}`, `/a/${s}/${t}`]))
);

const SUFFIXES = ['', '?', '?q#f', '#', '#f'];

/** What is wrong with the reference relativeURI writes for a target: it resolves elsewhere, or is absolute where it need not be. */
function unreached(target: string, base: string, reachable: boolean): string[] {
  const relative = relativeURI(target, base);
  const wrong: string[] = [];
  if (new URL(relative, base).href !== target) wrong.push(`${target} from ${base} as ${relative}`);
  // Engines resolve against a drive-letter segment such as C: differently, so a reference may only reach in some.
  const driveLetter = /\/[A-Za-z]:(\/|$)/.test(new URL(base).pathname);
  if (reachable && !driveLetter && /^[a-z]+:/.test(relative)) wrong.push(`${target} from ${base} kept absolute`);
  return wrong;
}

describe('relativeURI', () => {
  it.each([
    ['file:///doc/part.xml', 'file:///doc/main.xml', 'part.xml'],
    ['file:///doc/main.xml', 'file:///doc/main.xml', 'main.xml'],
    ['file:///doc/sub/part.xml', 'file:///doc/main.xml', 'sub/part.xml'],
    ['file:///part.xml', 'file:///doc/main.xml', '../part.xml'],
    ['file:///other/part.xml', 'file:///doc/main.xml', '../other/part.xml'],
    ['file:///a/x/y.xml', 'file:///a/b/c/main.xml', '../../x/y.xml'],
    ['file:///doc/a.xml', 'file:///doc/', 'a.xml'],
    ['file:///doc/sub/', 'file:///doc/main.xml', 'sub/'],
    ['file:///doc/', 'file:///doc/sub/main.xml', '../'],
    ['http://h/doc/a.xml?q=1#f', 'http://h/doc/main.xml', 'a.xml?q=1#f'],
    ['http://u@h/doc/a.xml', 'http://u@h/doc/main.xml', 'a.xml'],
    ['file:///doc/', 'file:///doc/main.xml', './'],
    ['file:///doc/?q', 'file:///doc/main.xml', './?q'],
    ['file:///doc/#f', 'file:///doc/main.xml', './#f'],
    ['file:///doc/a:b.xml', 'file:///doc/main.xml', './a:b.xml'],
    ['file:///doc/a:b/c.xml', 'file:///doc/main.xml', './a:b/c.xml'],
    ['file:///doc//x.xml', 'file:///doc/main.xml', './/x.xml'],
    ['file:///doc/main.xml?', 'file:///doc/main.xml', 'main.xml?'],
    ['file:///doc/main.xml#', 'file:///doc/main.xml', 'main.xml#'],
  ])('writes %s relative to %s as %s (XML Base §4.5.5 of XInclude)', (target, base, expected) => {
    expect(relativeURI(target, base)).toBe(expected);
    expect(new URL(expected, base).href).toBe(target);
  });

  it.each([
    ['http://h/a.xml', 'file:///doc/main.xml'],
    ['http://a.example/doc/a.xml', 'http://b.example/doc/main.xml'],
    ['http://a.example:8080/doc/a.xml', 'http://a.example/doc/main.xml'],
    ['http://u@h/doc/a.xml', 'http://v@h/doc/main.xml'],
  ])('keeps %s absolute when its scheme or authority differs from %s', (target, base) => {
    expect(relativeURI(target, base)).toBe(target);
  });

  it('gives, for every target and base, a reference that resolves back to the target (RFC 3986 §4.2, §5.2)', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const origin of ['file://', 'http://h', 'foo://h', 'foo:']) {
      const urls = PATHS.map((path) => `${origin}${path}`).filter((url) => URL.canParse(url));
      const targets = urls.flatMap((url) => SUFFIXES.map((suffix) => new URL(url + suffix).href));
      for (const base of urls) {
        for (const target of targets) {
          failures.push(...unreached(target, base, origin.endsWith('//h')));
          checked++;
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(100_000);
  });

  it('keeps the target absolute when no relative reference can reach it from the base', () => {
    // Whether a reference can cross drive letters depends on the engine's URL parser; it must reach the target either way.
    expect(new URL(relativeURI('file:///D:/x.xml', 'file:///C:/doc/main.xml'), 'file:///C:/doc/main.xml').href).toBe(
      'file:///D:/x.xml'
    );
    expect(relativeURI('urn:a:b', 'urn:a:c')).toBe('urn:a:b');
    expect(relativeURI('foo:/a/b', 'foo://h/a/c')).toBe('foo:/a/b');
  });

  it.each([
    ['part.xml', 'file:///doc/main.xml'],
    ['file:///doc/part.xml', ''],
    ['file:///doc/part.xml', 'main.xml'],
  ])('gives %s back as it is when it or the base %s is not absolute', (target, base) => {
    expect(relativeURI(target, base)).toBe(target);
  });
});
