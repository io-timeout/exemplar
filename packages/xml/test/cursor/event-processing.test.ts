import { eventsEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';

const DECLARED = '<!DOCTYPE r [<!ENTITY e "x"><!ENTITY m "<a/>"><!ENTITY bad "<b">]>';

/** The type and name of each event, and the error last, read every way with entity boundaries reported. */
function boundaries(xml: string): string[] {
  return eventsEveryWay(`${DECLARED}${xml}`, { reportEntityBoundaries: true })
    .slice(1)
    .map((event) => event.replace(/@\S+/, '').replace(/ at \d+:\d+$/, ''));
}

describe('entity boundaries (reportEntityBoundaries)', () => {
  it.each([
    ['an end tag with no name', '<r>&e;</>', 'WF_NAME'],
    ['a mismatched end tag', '<r>&e;</s>', 'WF_END_TAG_MISMATCH'],
    ['an undeclared entity', '<r>&e;&u;</r>', 'WF_UNDECLARED_ENTITY'],
    ['a malformed comment', '<r>&e;<!-- -- --></r>', 'WF_COMMENT'],
    ['a forbidden character reference', '<r>&e;&#0;</r>', 'WF_CHARACTER_REFERENCE'],
  ])('report the end of an entity of text before %s after it', (_, xml, code) => {
    expect(boundaries(xml)).toEqual(['1 <r{}>', '258 e', '4 "x"', '259 e', code]);
  });

  it('report the end of an entity of markup before an error after it', () => {
    expect(boundaries('<r>&m;</s>')).toEqual([
      '1 <r{}>',
      '258 m',
      '1 <a{}>',
      '2 </a{}>',
      '259 m',
      'WF_END_TAG_MISMATCH',
    ]);
  });

  it('report the start of an entity before an error inside it', () => {
    expect(boundaries('<r>&bad;</r>')).toEqual(['1 <r{}>', '258 bad', 'WF_UNEXPECTED_END']);
  });
});

describe('entity boundary locations', () => {
  const entityResolver = { resolveEntity: () => ({ systemId: 'urn:x', text: '<?xml encoding="UTF-8"?>t' }) };

  /** The location of each start and end of an entity, read every way. */
  function boundaryLocations(xml: string): string[] {
    return eventsEveryWay(xml, { reportEntityBoundaries: true, entityResolver }).filter((e) => /^25[89]@/.test(e));
  }

  it('put the end of an entity where its reference ends, though another expansion follows', () => {
    expect(boundaryLocations('<!DOCTYPE r [<!ENTITY x SYSTEM "x.xml">]><r>&x;&x;</r>')).toEqual([
      '258@1:25urn:x x',
      '259@1:48 x',
      '258@1:25urn:x x',
      '259@1:51 x',
    ]);
  });

  it('put the end of an empty entity where its reference ends', () => {
    expect(boundaryLocations('<!DOCTYPE r [<!ENTITY e "">]><r>&e;\n<a/></r>').at(-1)).toBe('259@1:36 e');
  });
});
