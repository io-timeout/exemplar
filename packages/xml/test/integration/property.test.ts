import { fc, test } from '@fast-check/vitest';
import { write } from '@test/helpers/canonical.ts';
import { canonical, parseEveryWay } from '@test/helpers/parse.ts';
import { expect } from 'vitest';
import { EventType, XMLInputFactory } from '@/index.ts';

// The nightly run scales the number of runs up.
const SCALE = Number(globalThis.process?.env['EXEMPLAR_FUZZ_SCALE'] ?? 1);

/** A document as the generator models it, with its text as the reader must report it. */
type Node =
  | {
      readonly kind: 'element';
      readonly name: string;
      readonly attributes: readonly [string, string][];
      readonly children: readonly Node[];
    }
  | { readonly kind: 'text'; readonly text: string; readonly cdata: boolean }
  | { readonly kind: 'comment'; readonly text: string }
  | { readonly kind: 'pi'; readonly target: string; readonly data: string };

const nameStart = fc.constantFrom(...Array.from('abcxyzABC_é中ſ'));
const nameChar = fc.constantFrom(...Array.from('abc019-._éÀ中·'));
const name = fc.tuple(nameStart, fc.string({ unit: nameChar, maxLength: 6 })).map(([a, b]) => a + b);
const textChar = fc.constantFrom(...Array.from('ab z\t\n<>&"\'é中𝄞]'));
const text = fc.string({ unit: textChar, minLength: 1, maxLength: 12 });
const value = fc.string({ unit: textChar, maxLength: 8 });
const plainChar = fc.constantFrom(...Array.from('ab z-é'));
const plain = fc.string({ unit: plainChar, maxLength: 10 });

const node: fc.Arbitrary<Node> = fc.letrec<{ node: Node; element: Node }>((tie) => ({
  element: fc.record({
    kind: fc.constant('element' as const),
    name,
    attributes: fc.uniqueArray(fc.tuple(name, value), {
      selector: ([n]) => n,
      maxLength: 4,
    }),
    children: fc.array(tie('node'), { maxLength: 4 }),
  }),
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.record({ kind: fc.constant('text' as const), text, cdata: fc.boolean() }),
    fc.record({ kind: fc.constant('comment' as const), text: plain }),
    fc.record({ kind: fc.constant('pi' as const), target: name.filter((n) => n.toLowerCase() !== 'xml'), data: plain }),
    tie('element')
  ),
})).node;

const root = node.filter((n) => n.kind === 'element');

/** Writes a character as a reference, chosen by the code unit. */
function reference(c: string, seed: number): string {
  const named: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
  const code = c.codePointAt(0) ?? 0;
  return [named[c] ?? `&#${code};`, `&#${code};`, `&#x${code.toString(16)};`][seed % 3] ?? '';
}

/** Escapes text for content or a double-quoted attribute value, varying the references and line ends used. */
function serializeText(value: string, attribute: boolean, seed: number): string {
  let out = '';
  let previous = '';
  for (const c of value) {
    const special = c === '<' || c === '&' || (attribute && (c === '"' || c === '\t' || c === '\n'));
    // ]]> may not appear literally in content, even across the texts of adjacent nodes.
    const closes = c === '>' && (previous === '' || previous === ']');
    if (special) out += reference(c, seed++);
    else if (c === '\n') out += seed++ % 2 === 0 ? '\r\n' : '\n';
    else if (c === '>' && (closes || seed++ % 2 === 0)) out += '&gt;';
    else out += c;
    previous = c;
  }
  return out;
}

/** Writes a modelled node as XML. */
function serialize(n: Node, seed: number): string {
  switch (n.kind) {
    case 'element': {
      const attributes = n.attributes.map(([k, v], i) => ` ${k}="${serializeText(v, true, seed + i)}"`).join('');
      const children = n.children.map((child, i) => serialize(child, seed + i)).join('');
      return children === '' && seed % 2 === 0
        ? `<${n.name}${attributes}/>`
        : `<${n.name}${attributes}>${children}</${n.name}>`;
    }
    case 'text': {
      return n.cdata && !n.text.includes(']]>') ? `<![CDATA[${n.text}]]>` : serializeText(n.text, false, seed);
    }
    case 'comment': {
      return `<!--${n.text.replaceAll('-', ' ')}-->`;
    }
    case 'pi': {
      const data = n.data === '' ? '' : ` ${n.data}`;
      return `<?${n.target}${data}?>`;
    }
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;',
};
const escape = (value: string) => value.replaceAll(/[&<>"\t\n\r]/g, (c) => ESCAPES[c] ?? c);

/** The canonical form the model must read back as. */
function expected(n: Node): string {
  switch (n.kind) {
    case 'element': {
      const sorted = n.attributes.toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)));
      const attributes = sorted.map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
      return `<${n.name}${attributes}>${n.children.map(expected).join('')}</${n.name}>`;
    }
    case 'text': {
      return escape(n.text);
    }
    case 'comment': {
      return '';
    }
    case 'pi': {
      // The data starts after all the whitespace that follows the target.
      return `<?${n.target} ${n.data.trimStart()}?>`;
    }
  }
}

test.prop([root, fc.nat(), fc.boolean()], { numRuns: 300 * SCALE })(
  'reads generated well-formed documents back as written, every way',
  (doc, seed, declaration) => {
    const xml = `${declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''}${serialize(doc, seed)}`;
    expect(parseEveryWay(xml, { namespaceAware: false })).toBe(expected(doc));
  },
  10_000 * SCALE
);

/** Feeds a document's bytes to an asynchronous reader in chunks of one size; returns the canonical form. */
function fedInChunks(bytes: Uint8Array, size: number): string {
  const reader = new XMLInputFactory({ namespaceAware: false }).createAsyncStreamReader();
  let out = '';
  let at = 0;
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event !== EventType.NEED_INPUT) out += write(reader, event);
    else if (at < bytes.length) reader.feed(bytes.subarray(at, (at += size)));
    else reader.endOfInput();
  }
  return out;
}

test.prop([root, fc.nat(), fc.nat(), fc.integer({ min: 1, max: 40 })], { numRuns: 200 * SCALE })(
  'reads generated documents the same split at any byte, or fed in chunks of any size',
  (doc, seed, split, size) => {
    const xml = serialize(doc, seed);
    const bytes = new TextEncoder().encode(xml);
    const at = split % (bytes.length + 1);
    const halves = [bytes.subarray(0, at), bytes.subarray(at)];
    expect(canonical(halves, { namespaceAware: false })).toBe(expected(doc));
    expect(fedInChunks(bytes, size)).toBe(expected(doc));
  },
  10_000 * SCALE
);

/** A "billion laughs" document: each entity refers to the one before it `fanout` times, `depth` levels deep. */
function laughs(fanout: number, depth: number): string {
  const entities = ['<!ENTITY e0 "ha">'];
  for (let level = 1; level <= depth; level++) {
    const references = `&e${level - 1};`.repeat(fanout);
    entities.push(`<!ENTITY e${level} "${references}">`);
  }
  return `<!DOCTYPE r [${entities.join('')}]><r>&e${depth};</r>`;
}

/** The limit codes a stopped expansion may give. */
const ENTITY_LIMITS = ['LIMIT_ENTITY_EXPANSIONS', 'LIMIT_TOTAL_ENTITY_SIZE', 'LIMIT_GENERAL_ENTITY_SIZE'];

test.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 12 })], { numRuns: 100 * SCALE })(
  'expands entity bombs within the limits, and stops at a limit beyond them, quickly',
  (fanout, depth) => {
    const characters = 2 * fanout ** depth;
    const started = performance.now();
    let text: string | undefined;
    let code: string | undefined;
    try {
      text = parseEveryWay(laughs(fanout, depth));
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(performance.now() - started, 'parsing time in ms').toBeLessThan(2000);
    if (text === undefined) expect(ENTITY_LIMITS).toContain(code);
    else expect(text).toBe(`<r>${'ha'.repeat(characters / 2)}</r>`);
    if (characters <= 1000) expect(text, 'a small expansion is read').toBeDefined();
    if (characters > 200_000) expect(code, 'a bomb is stopped').toBeDefined();
  },
  10_000 * SCALE
);

test.prop([fc.integer({ min: 1, max: 20_000 }), fc.integer({ min: 1, max: 60 })], { numRuns: 50 * SCALE })(
  'stops a large entity referred to so often that the text it adds passes totalEntitySize',
  (size, references) => {
    const xml = `<!DOCTYPE r [<!ENTITY big "${'x'.repeat(size)}">]><r>${'&big;'.repeat(references)}</r>`;
    let code: string | undefined;
    try {
      parseEveryWay(xml);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    if (size * references > 100_000) expect(code).toBe('LIMIT_TOTAL_ENTITY_SIZE');
    else expect(code).toBeUndefined();
  },
  10_000 * SCALE
);

test.prop([fc.integer({ min: 1, max: 250 }), fc.integer({ min: 0, max: 3 })], { numRuns: 100 * SCALE })(
  'stops nesting deeper than elementDepth, written out or from entities',
  (depth, split) => {
    // The innermost `split` levels come from an entity's replacement text.
    const inner = Math.min(split, depth);
    const outer = depth - inner;
    const entity = '<a>'.repeat(inner) + '</a>'.repeat(inner);
    const xml = `<!DOCTYPE a [<!ENTITY n "${entity}">]>${'<a>'.repeat(outer)}&n;${'</a>'.repeat(outer)}`;
    if (outer === 0) return;
    let code: string | undefined;
    try {
      parseEveryWay(xml);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe(depth > 100 ? 'LIMIT_ELEMENT_DEPTH' : undefined);
  },
  10_000 * SCALE
);
