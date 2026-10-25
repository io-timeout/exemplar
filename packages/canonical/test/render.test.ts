import { describe, expect, it } from 'vitest';
import type { CanonicalizeOptions } from '@/canonicalize.ts';
import { Canonicalizer, type CanonicalAttribute, sortAttributes } from '@/render.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';

/** A canonicalizer whose shared steps a test can call one at a time. */
class Probe extends Canonicalizer {
  constructor(options: CanonicalizeOptions = {}, encoding?: string | null, exclusive = false) {
    super(exclusive, options, encoding);
  }

  /** What has been written so far. */
  get written(): string {
    return this.output;
  }

  /** Whether comments are kept. */
  get commentsKept(): boolean {
    return this.keepsComments;
  }

  /** Writes character data; returns all written so far. */
  write(text: string): string {
    this.writeCharacters(text);
    return this.output;
  }

  /** A comment's canonical form. */
  commentOf(data: string): string {
    return this.commentMarkup(data);
  }

  /** A processing instruction's canonical form. */
  piOf(target: string, data: string): string {
    return this.piMarkup(target, data);
  }

  /** The prefixes an element visibly uses. */
  usedBy(prefix: string, attributes: readonly CanonicalAttribute[], scope: Map<string, string>): string[] {
    return [...this.usedPrefixes(prefix, attributes, scope)];
  }

  /** Writes the start tag of an element `e`; returns the namespaces rendered. */
  tag(
    candidates: Iterable<string>,
    scope: Map<string, string>,
    parent: Map<string, string>,
    attributes: readonly CanonicalAttribute[] = []
  ): ReadonlyMap<string, string> {
    return this.writeStartTag('e', candidates, scope, parent, attributes);
  }
}

/** A namespace map from pairs of prefix and URI, with the empty default. */
const ns = (...pairs: [string, string][]): Map<string, string> => new Map([['', ''], ...pairs]);

describe('sortAttributes', () => {
  /** An attribute with a namespace URI and local name. */
  const attr = (uri: string, local: string): CanonicalAttribute => [uri, local, local, ''];

  it('orders by namespace URI, no namespace first, then by local name (C14N §2.2)', () => {
    const sorted = sortAttributes([
      attr('urn:b', 'a'),
      attr('urn:a', 'z'),
      attr('', 'z'),
      attr('urn:a', 'b'),
      attr('', 'a'),
    ]);
    expect(sorted.map(([uri, local]) => `${uri} ${local}`)).toEqual([' a', ' z', 'urn:a b', 'urn:a z', 'urn:b a']);
  });

  it('orders by code point, not by UTF-16 code unit', () => {
    const sorted = sortAttributes([attr('', '\u{10000}'), attr('', 'Ａ'), attr('', '\u{10000}a'), attr('', 'x')]);
    expect(sorted.map(([, local]) => local)).toEqual(['x', 'Ａ', '\u{10000}', '\u{10000}a']);
  });

  it('compares past an astral character the names share', () => {
    const sorted = sortAttributes([attr('', 'x\u{10000}b'), attr('', 'x\u{10000}a')]);
    expect(sorted.map(([, local]) => local)).toEqual(['x\u{10000}a', 'x\u{10000}b']);
  });

  it('puts a name before the longer names it starts', () => {
    expect(sortAttributes([attr('urn:ab', 'a'), attr('urn:a', 'a')]).map(([uri]) => uri)).toEqual(['urn:a', 'urn:ab']);
  });

  it('leaves its input as it was', () => {
    const input = [attr('', 'b'), attr('', 'a')];
    sortAttributes(input);
    expect(input.map(([, local]) => local)).toEqual(['b', 'a']);
  });
});

describe('Canonicalizer', () => {
  it('escapes &, <, > and carriage return in text, and nothing else (C14N §2.3)', () => {
    expect(new Probe().write('&<>\r"\'\t\n')).toBe('&amp;&lt;&gt;&#xD;"\'\t\n');
  });

  it('escapes &, <, ", tab, line feed and carriage return in attribute values (C14N §2.3)', () => {
    const probe = new Probe();
    probe.tag([], ns(), ns(), [['', 'v', 'v', '&<>"\'\t\n\r']]);
    expect(probe.written).toBe('<e v="&amp;&lt;>&quot;\'&#x9;&#xA;&#xD;">');
  });

  it.each([
    ['ISO-8859-1', true],
    ['windows-1252', true],
    ['Shift_JIS', true],
    ['UTF-8', false],
    ['utf-16', false],
    ['UTF-16LE', false],
    ['UCS-4', false],
    ['ISO-10646-UCS-2', false],
    [undefined, false],
    [null, false],
  ])('puts text decoded from %s in Normalization Form C: %s (C14N §1)', (encoding, normalized) => {
    const decomposed = 'e\u0301';
    const expected = normalized ? '\u00E9' : decomposed;
    const probe = new Probe({}, encoding);
    expect(probe.write(decomposed)).toBe(expected);
    expect(probe.commentOf(decomposed)).toBe(`<!--${expected}-->`);
    expect(probe.piOf('p', decomposed)).toBe(`<?p ${expected}?>`);
    const tagged = new Probe({}, encoding);
    tagged.tag([], ns(), ns(), [['', 'v', 'v', decomposed]]);
    expect(tagged.written).toBe(`<e v="${expected}">`);
  });

  it('writes a processing instruction without data with no space before ?> (C14N §2.3)', () => {
    expect(new Probe().piOf('p', '')).toBe('<?p?>');
    expect(new Probe().piOf('p', 'a  b ')).toBe('<?p a  b ?>');
  });

  it('keeps comments only when asked', () => {
    expect(new Probe().commentsKept).toBe(false);
    expect(new Probe({ comments: false }).commentsKept).toBe(false);
    expect(new Probe({ comments: true }).commentsKept).toBe(true);
  });

  describe('used, for Exclusive Canonicalization (Exc-C14N §3)', () => {
    const scope = ns(['', 'urn:d'], ['p', 'urn:p'], ['q', 'urn:q'], ['r', 'urn:r']);

    it("names the element's prefix, the default for an unprefixed element", () => {
      expect(new Probe({}, null, true).usedBy('', [], scope)).toEqual(['']);
      expect(new Probe({}, null, true).usedBy('p', [], scope)).toEqual(['p']);
    });

    it('adds the prefixes of qualified attributes, not of unqualified or xml: ones', () => {
      const attributes: CanonicalAttribute[] = [
        ['', 'a', 'a', ''],
        [XML, 'lang', 'xml:lang', 'en'],
        ['urn:q', 'b', 'q:b', ''],
      ];
      expect(new Probe({}, null, true).usedBy('p', attributes, scope)).toEqual(['p', 'q']);
    });

    it('adds the prefixes of the inclusive list that are in scope, #default naming the default namespace', () => {
      const probe = new Probe({ inclusivePrefixes: ['r', '#default', 'unbound'] }, null, true);
      expect(probe.usedBy('p', [], scope).toSorted()).toEqual(['', 'p', 'r']);
    });
  });

  describe('startTag', () => {
    it('declares, default first then by prefix, the candidates its nearest output ancestor did not render', () => {
      const probe = new Probe();
      const scope = ns(['', 'urn:d'], ['b', 'urn:b'], ['a', 'urn:a'], ['c', 'urn:c']);
      probe.tag(['b', 'c', '', 'a'], scope, ns(['c', 'urn:c']));
      expect(probe.written).toBe('<e xmlns="urn:d" xmlns:a="urn:a" xmlns:b="urn:b">');
    });

    it('writes the namespace declarations before the attributes', () => {
      const probe = new Probe();
      probe.tag(['p'], ns(['p', 'urn:p']), ns(), [['', 'a', 'a', '1']]);
      expect(probe.written).toBe('<e xmlns:p="urn:p" a="1">');
    });

    it('undeclares a default namespace its output ancestor rendered, with xmlns=""', () => {
      const probe = new Probe();
      probe.tag([''], ns(), ns(['', 'urn:d']));
      expect(probe.written).toBe('<e xmlns="">');
    });

    it('never declares the xml prefix, nor a prefix bound nowhere', () => {
      const probe = new Probe();
      probe.tag(['xml', 'unbound'], ns(['xml', XML]), ns());
      expect(probe.written).toBe('<e>');
    });

    it("returns its ancestor's rendered namespaces when it declares none, and a copy with its own otherwise", () => {
      const parent = ns(['p', 'urn:p']);
      expect(new Probe().tag(['p'], ns(['p', 'urn:p']), parent)).toBe(parent);
      const rendered = new Probe().tag(['q'], ns(['p', 'urn:p'], ['q', 'urn:q']), parent);
      expect([...rendered]).toEqual([...parent, ['q', 'urn:q']]);
      expect([...parent]).toEqual([...ns(['p', 'urn:p'])]);
    });

    it('escapes namespace URIs as attribute values', () => {
      const probe = new Probe();
      probe.tag(['p'], ns(['p', 'urn:a&b"c']), ns());
      expect(probe.written).toBe('<e xmlns:p="urn:a&amp;b&quot;c">');
    });
  });
});
