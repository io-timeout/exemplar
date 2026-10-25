import { describe, expect, it } from 'vitest';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';
import { PointerMatcher, type PointerPart, Selection, parsePointer } from '@/pointer.ts';

/** An element() part, or a shorthand pointer when it has no steps. */
function element(id: string | undefined, ...steps: number[]): PointerPart {
  return { kind: 'element', id, steps };
}

/** A part in a scheme exemplar does not support. */
function unsupported(scheme: string): PointerPart {
  return { kind: 'unsupported', scheme };
}

describe('parsePointer', () => {
  it.each([
    ['chapter-3', [element('chapter-3')]],
    ['_x.y', [element('_x.y')]],
  ])('reads %s as a shorthand pointer (XPointer Framework §3.2)', (value, parts) => {
    expect(parsePointer(value)).toEqual(parts);
  });

  it.each([
    ['element(/1)', [element(undefined, 1)]],
    ['element(/1/2/10)', [element(undefined, 1, 2, 10)]],
    ['element(intro)', [element('intro')]],
    ['element(intro/3/1)', [element('intro', 3, 1)]],
  ])('reads %s in the element() scheme (XPointer element() §3)', (value, parts) => {
    expect(parsePointer(value)).toEqual(parts);
  });

  it.each([
    ['element(a) element(/1)', [element('a'), element(undefined, 1)]],
    ['element(a)element(/1)', [element('a'), element(undefined, 1)]],
    ['  element(a)\t\n element(/2)  ', [element('a'), element(undefined, 2)]],
  ])('reads the parts of %s in order, with optional white space between (XPointer Framework §3.3)', (value, parts) => {
    expect(parsePointer(value)).toEqual(parts);
  });

  it.each([
    ['xpointer(/a/b)', [unsupported('xpointer')]],
    ['xmlns(x=urn:x) element(/1)', [unsupported('xmlns'), element(undefined, 1)]],
    ['my:scheme(data)', [unsupported('my:scheme')]],
  ])('keeps a part in an unsupported scheme, to be skipped, in %s (XPointer Framework §3.3)', (value, parts) => {
    expect(parsePointer(value)).toEqual(parts);
  });

  it.each([
    'element()',
    'element(/0)',
    'element(/01)',
    'element(/1/)',
    'element(//1)',
    'element(a//1)',
    'element(1a)',
    'element(a:b)',
    'element(/a)',
  ])('reads %s, whose element() data is not well-formed, as a part that identifies nothing', (value) => {
    expect(parsePointer(value)).toEqual([unsupported('element')]);
  });

  it.each([
    ['xpointer(f(x)) element(/1)', [unsupported('xpointer'), element(undefined, 1)]],
    ['xpointer(^() element(/1)', [unsupported('xpointer'), element(undefined, 1)]],
    ['xpointer(^)) element(/1)', [unsupported('xpointer'), element(undefined, 1)]],
    ['xpointer(^^) element(/1)', [unsupported('xpointer'), element(undefined, 1)]],
  ])('balances parentheses and undoes ^ escapes in scheme data: %s (XPointer Framework §3.1)', (value, parts) => {
    expect(parsePointer(value)).toEqual(parts);
  });

  it('undoes ^ escapes before reading element() data', () => {
    expect(parsePointer('element(a^^)')).toEqual([unsupported('element')]);
  });

  it.each([
    [''],
    ['   '],
    ['1abc'],
    ['a:b'],
    ['element(/1'],
    ['element(/1) x'],
    ['element (/1)'],
    ['1x(data)'],
    ['(data)'],
    ['xpointer(^a)'],
    ['xpointer(^'],
    ['xpointer(f(x)'],
  ])('rejects %j, which is not a well-formed pointer (XPointer Framework §3.1)', (value) => {
    expect(parsePointer(value)).toBeUndefined();
  });
});

/** A tree of elements as nested arrays, each `[ids, ...children]`. */
type Tree = readonly [readonly string[], ...Tree[]];

/** Walks a tree through a matcher; returns the paths of the elements it selected. */
function selections(m: PointerMatcher, tree: Tree, path: number[] = [1]): string[] {
  const [ids, ...children] = tree;
  const found = m.select({ ids }) ? [`/${path.join('/')}`] : [];
  for (const [i, child] of children.entries()) found.push(...selections(m, child, [...path, i + 1]));
  m.end();
  return found;
}

/** A matcher for a pointer, with no parts when it is not well-formed. */
function matcher(pointer: string): PointerMatcher {
  return new PointerMatcher(parsePointer(pointer) ?? []);
}

describe('PointerMatcher', () => {
  const tree: Tree = [[], [['a']], [['b'], [[]], [['c']]], [['b']]];

  it.each([
    ['element(/1)', ['/1']],
    ['element(/1/2)', ['/1/2']],
    ['element(/1/2/2)', ['/1/2/2']],
    ['element(/1/4)', []],
    ['element(/2)', []],
    ['element(/1/1/1)', []],
  ])('selects by child sequence with %s (XPointer element() §3)', (pointer, selected) => {
    expect(selections(matcher(pointer), tree)).toEqual(selected);
  });

  it.each([
    ['a', ['/1/1']],
    ['c', ['/1/2/2']],
    ['element(b/1)', ['/1/2/1']],
    ['element(b/2)', ['/1/2/2']],
    ['element(b/3)', []],
    ['missing', []],
  ])('selects by ID, and steps below it, with %s (XPointer Framework §3.2, element() §3)', (pointer, selected) => {
    expect(selections(matcher(pointer), tree)).toEqual(selected);
  });

  it('anchors an ID at the first element bearing it, in document order', () => {
    expect(selections(matcher('b'), tree)).toEqual(['/1/2']);
  });

  it('gives the first part that identifies an element precedence over later parts (XPointer Framework §3.3)', () => {
    const m = matcher('element(/1/3) element(/1/1)');
    expect(selections(m, tree)).toEqual(['/1/3']);
    expect(m.laterMatch).toEqual([1, 1]);
  });

  it('notes what a later part identifies when no earlier part does, for reading the document again', () => {
    const m = matcher('element(/9) element(/1/2/2) element(/1/1)');
    expect(selections(m, tree)).toEqual([]);
    expect(m.laterMatch).toEqual([1, 2, 2]);
  });

  it('skips parts in unsupported schemes, so the first supported one wins', () => {
    const m = matcher('xpointer(//p) element(/1/1)');
    expect(selections(m, tree)).toEqual(['/1/1']);
    expect(m.laterMatch).toBeUndefined();
  });

  it('identifies nothing when no part is in a supported scheme', () => {
    const m = new PointerMatcher([unsupported('xpointer'), unsupported('element')]);
    expect(selections(m, tree)).toEqual([]);
    expect(m.laterMatch).toBeUndefined();
  });

  it('notes a later part that identifies the element the first part also does as no fallback', () => {
    const m = matcher('element(/1/1) element(a)');
    expect(selections(m, tree)).toEqual(['/1/1']);
    expect(m.laterMatch).toBeUndefined();
  });
});

describe('Selection', () => {
  /** Reads a document until a pointer's selection finds its element, or to the end. */
  function select(pointer: string, xml: string): Selection {
    const selection = new Selection(parsePointer(pointer) as PointerPart[]);
    const reader = new XMLInputFactory().createStreamReader(xml);
    let depth = 0;
    for (let e = reader.next(); e !== EventType.END_DOCUMENT && selection.depth === undefined; e = reader.next()) {
      if (e === EventType.START_ELEMENT) selection.select(reader, ++depth);
      if (e === EventType.END_ELEMENT) {
        depth--;
        selection.end();
      }
    }
    return selection;
  }

  it('finds the element a pointer selects, at its depth', () => {
    const selection = select('element(/1/2)', '<a><b/><c><d/></c></a>');
    expect(selection.depth).toBe(2);
    expect(selection.outcome()).toBe('selected');
  });

  it('finds an element by an attribute of type ID', () => {
    const selection = select('x', '<!DOCTYPE a [<!ATTLIST c id ID #IMPLIED>]><a><b/><c id="x"/></a>');
    expect(selection.depth).toBe(2);
  });

  it('gives the child sequence of an element only a later part identified', () => {
    const selection = select('element(missing)element(/1/1)', '<a><b/></a>');
    expect(selection.depth).toBeUndefined();
    expect(selection.outcome()).toEqual([1, 1]);
  });

  it('gives nothing when no part identifies an element', () => {
    expect(select('element(/2)', '<a/>').outcome()).toBeUndefined();
  });
});
