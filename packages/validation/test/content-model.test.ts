import { describe, expect, it } from 'vitest';
import { type Automaton, type ContentModel, compileContentModel } from '@/content-model.ts';

/** The automaton of an element-content model. */
function automaton(content: string): Automaton {
  const model = compileContentModel(content);
  if (model.kind !== 'CHILDREN') throw new Error(`${content} is not element content`);
  return model.automaton;
}

/** Whether a model allows children of these names, in this order. */
function matches(content: string, children: readonly string[]): boolean {
  const a = automaton(content);
  let state = a.start;
  for (const name of children) {
    state = a.next(state, name);
    if (state < 0) return false;
  }
  return a.accepts(state);
}

describe('compileContentModel', () => {
  it.each(['EMPTY', 'ANY'])('keeps %s as it is (§3.2)', (content) => {
    expect(compileContentModel(content)).toEqual({ kind: content });
  });

  it.each([
    ['(#PCDATA)', []],
    ['(#PCDATA)*', []],
    ['(#PCDATA|a)*', ['a']],
    ['(#PCDATA|a|b|c)*', ['a', 'b', 'c']],
  ])('reads mixed content %s with the names it allows (§3.2.2)', (content, names) => {
    const model = compileContentModel(content) as Extract<ContentModel, { kind: 'MIXED' }>;
    expect(model.kind).toBe('MIXED');
    expect([...model.names]).toEqual(names);
    expect(model.duplicate).toBeUndefined();
  });

  it('notes a name mixed content lists twice (VC: No Duplicate Types)', () => {
    const model = compileContentModel('(#PCDATA|a|b|a)*') as Extract<ContentModel, { kind: 'MIXED' }>;
    expect(model.duplicate).toBe('a');
    expect([...model.names]).toEqual(['a', 'b']);
  });

  it('compiles element content to an automaton (§3.2.1)', () => {
    expect(compileContentModel('(a,b)').kind).toBe('CHILDREN');
  });
});

describe('Automaton', () => {
  it.each([
    ['(a)', [], false],
    ['(a)', ['a'], true],
    ['(a)', ['a', 'a'], false],
    ['(a)', ['b'], false],
    ['(a?)', [], true],
    ['(a?)', ['a'], true],
    ['(a?)', ['a', 'a'], false],
    ['(a*)', [], true],
    ['(a*)', ['a', 'a', 'a'], true],
    ['(a+)', [], false],
    ['(a+)', ['a', 'a'], true],
    ['(a)*', ['a', 'a'], true],
    ['(a)+', [], false],
    ['(a,b,c)', ['a', 'b', 'c'], true],
    ['(a,b,c)', ['a', 'b'], false],
    ['(a,b,c)', ['a', 'c'], false],
    ['(a,b,c)', ['b', 'a', 'c'], false],
    ['(a,b,c)', ['a', 'b', 'c', 'c'], false],
    ['(a|b|c)', ['b'], true],
    ['(a|b|c)', [], false],
    ['(a|b|c)', ['a', 'b'], false],
    ['(a,b?,c)', ['a', 'c'], true],
    ['(a,b?,c)', ['a', 'b', 'c'], true],
    ['(a,b?,c)', ['a', 'b', 'b', 'c'], false],
    ['(a,(b|c)*,d)', ['a', 'd'], true],
    ['(a,(b|c)*,d)', ['a', 'b', 'c', 'b', 'd'], true],
    ['(a,(b|c)*,d)', ['a', 'b'], false],
    ['((a,b)+)', ['a', 'b', 'a', 'b'], true],
    ['((a,b)+)', ['a', 'b', 'a'], false],
    ['((a|b),c)', ['b', 'c'], true],
    ['(a?,b?,c?)', [], true],
    ['(a?,b?,c?)', ['c'], true],
    ['(a?,b?,c?)', ['c', 'a'], false],
    ['(a?,b?,c?)+', ['c', 'a'], true],
    ['(a?,b?,c?)+', ['b', 'b'], true],
    ['((a?,b?)*,c)', ['c'], true],
    ['((a?,b?)*,c)', ['b', 'a', 'c'], true],
    ['((a?,b?)*,c)', ['a'], false],
    ['(a,(b,(c,d)?)?)', ['a'], true],
    ['(a,(b,(c,d)?)?)', ['a', 'b', 'c', 'd'], true],
    ['(a,(b,(c,d)?)?)', ['a', 'b', 'c'], false],
    ['(x.y,_z-1,p:q)', ['x.y', '_z-1', 'p:q'], true],
  ])('%s matches %j: %s', (content, children, expected) => {
    expect(matches(content, children)).toBe(expected);
  });

  // Appendix E asks for deterministic models only for compatibility; the automaton matches the rest exactly.
  it.each([
    ['((a,b)|(a,c))', ['a', 'b'], true],
    ['((a,b)|(a,c))', ['a', 'c'], true],
    ['((a,b)|(a,c))', ['a'], false],
    ['((a,b)|(a,c))', ['a', 'b', 'c'], false],
    ['((a|b)*,a,b)', ['a', 'b'], true],
    ['((a|b)*,a,b)', ['b', 'a', 'a', 'b'], true],
    ['((a|b)*,a,b)', ['a', 'b', 'a'], false],
    ['(a*,a)', ['a', 'a', 'a'], true],
    ['(a*,a)', [], false],
    ['(a?,a?)', ['a', 'a'], true],
    ['(a?,a?)', ['a', 'a', 'a'], false],
  ])('matches the non-deterministic model %s against %j: %s (Appendix E)', (content, children, expected) => {
    expect(matches(content, children)).toBe(expected);
  });

  it('accepts at the start only a model that can match nothing', () => {
    expect(automaton('(a*)').accepts(automaton('(a*)').start)).toBe(true);
    const a = automaton('(a,b)');
    expect(a.accepts(a.start)).toBe(false);
  });

  it('gives -1 for a name the model does not allow, every time', () => {
    const a = automaton('(a,b)');
    expect(a.next(a.start, 'b')).toBe(-1);
    expect(a.next(a.start, 'b')).toBe(-1);
  });

  it('keeps each state it finds, reaching it again by the same positions', () => {
    const a = automaton('(a*)');
    const once = a.next(a.start, 'a');
    expect(a.next(a.start, 'a')).toBe(once);
    expect(a.next(once, 'a')).toBe(once);
  });

  it('lists the names it allows next, each once', () => {
    const a = automaton('((a,b)|(a,c))');
    expect(a.expected(a.start)).toEqual(['a']);
    const afterA = a.next(a.start, 'a');
    expect(a.expected(afterA).toSorted()).toEqual(['b', 'c']);
    expect(a.expected(a.next(afterA, 'b'))).toEqual([]);
  });
});
