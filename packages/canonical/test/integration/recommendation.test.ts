import fixtures from '@test/fixtures/c14n/examples.json' with { type: 'json' };
import { factoryFor, tree } from '@test/helpers/c14n.ts';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@/index.ts';

interface Example {
  readonly name: string;
  readonly input: string;
  readonly uncommented: string;
  readonly commented?: string;
  readonly files?: Readonly<Record<string, string>>;
}

const { examples } = fixtures as { examples: Example[] };
const SYSTEM_ID = 'file:///examples/doc.xml';

describe('the examples of Canonical XML 1.0 and 1.1 (§3)', () => {
  it.each(examples.map((e) => [e.name, e] as const))('%s, as 1.0 and 1.1', (_, example) => {
    const factory = factoryFor(example.files);
    const source = { text: example.input, systemId: SYSTEM_ID };
    for (const method of ['c14n', 'c14n11'] as const) {
      expect(canonicalize(source, { method, factory })).toBe(example.uncommented);
      if (example.commented !== undefined) {
        expect(canonicalize(source, { method, factory, comments: true })).toBe(example.commented);
      }
    }
  });

  it('3.3 under Exclusive Canonicalization renders only the namespaces each element uses', () => {
    const example = examples.find((e) => e.name.startsWith('3.3')) as Example;
    const out = canonicalize(example.input, { method: 'exc-c14n' });
    expect(out).toContain('<e5 xmlns="http://example.org" xmlns:a="http://www.w3.org" xmlns:b="http://www.ietf.org"');
    expect(out).toContain('<e6>');
    expect(out).toContain('<e7 xmlns="http://www.ietf.org">');
    expect(out).toContain('<e8 xmlns="">');
    expect(out).toContain('<e9 attr="default"></e9>');
  });
});

describe('the same canonical form however the document is given', () => {
  const methods = ['c14n', 'c14n11', 'exc-c14n'] as const;

  it.each(examples.map((e) => [e.name, e] as const))(
    '%s: as a source, as UTF-8 bytes, as a cursor and as a DOM tree',
    (_, example) => {
      const factory = factoryFor(example.files);
      const bytes = new TextEncoder().encode(example.input.replace(/encoding="ISO-8859-1"/, 'encoding="UTF-8"'));
      for (const method of methods) {
        for (const comments of [false, true]) {
          const options = { method, factory, comments };
          const expected = canonicalize({ text: example.input, systemId: SYSTEM_ID }, options);
          expect(canonicalize({ bytes, systemId: SYSTEM_ID }, options)).toBe(expected);
          const reader = factory.createStreamReader({ text: example.input, systemId: SYSTEM_ID });
          expect(canonicalize(reader, options)).toBe(expected);
          expect(canonicalize(tree(example.input, factory), { method, comments })).toBe(expected);
        }
      }
    }
  );
});
