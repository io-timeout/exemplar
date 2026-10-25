import { recorder } from '@test/helpers/recorder.ts';
import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { SAXParser } from '@/index.ts';

const BOUNDARIES = ['startEntity', 'endEntity', 'characters', 'startElement', 'endElement', 'skippedEntity'];

/** The boundary and content calls a document gives, read with the given factory options. */
function boundaries(xml: string, options = {}): string[] {
  const { handler, calls } = recorder(BOUNDARIES);
  new SAXParser(new XMLInputFactory(options)).parse({ systemId: 'http://example.org/d.xml', text: xml }, handler);
  return calls;
}

describe('entity boundaries with SAX (LexicalHandler.startEntity and endEntity)', () => {
  it('reports each expanded entity around its text, once, with reportEntityBoundaries on', () => {
    const xml = '<!DOCTYPE a [<!ENTITY t "text">]><a>&t;</a>';
    const seen: string[] = [];
    new SAXParser(new XMLInputFactory({ reportEntityBoundaries: true })).parse(xml, {
      startEntity: (name) => seen.push(`start ${name}`),
      endEntity: (name) => seen.push(`end ${name}`),
      characters: (text) => seen.push(text),
    });
    expect(seen).toEqual(['start t', 'text', 'end t']);
  });

  it('reports the same boundaries whether reportEntityBoundaries is on or off', () => {
    const xml = '<!DOCTYPE a [<!ENTITY t "<b>&u;</b>"><!ENTITY u "u">]><a>&t;</a>';
    expect(boundaries(xml, { reportEntityBoundaries: true })).toEqual(boundaries(xml));
  });

  it('reports boundaries around markup from an entity', () => {
    expect(boundaries('<!DOCTYPE a [<!ENTITY e "<b/>">]><a>&e;</a>')).toEqual([
      'startElement(, a, a, [])',
      'startEntity(e)',
      'startElement(, b, b, [])',
      'endElement(, b, b)',
      'endEntity(e)',
      'endElement(, a, a)',
    ]);
  });

  it('nests boundaries as entity references nest', () => {
    expect(boundaries('<!DOCTYPE a [<!ENTITY o "[&i;]"><!ENTITY i "in">]><a>&o;</a>').slice(1, -1)).toEqual([
      'startEntity(o)',
      'characters([)',
      'startEntity(i)',
      'characters(in)',
      'endEntity(i)',
      'characters(])',
      'endEntity(o)',
    ]);
  });

  it('reports an entity used twice twice', () => {
    const calls = boundaries('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;&e;</a>');
    expect(calls.filter((call) => call === 'startEntity(e)')).toHaveLength(2);
  });

  it('reports an empty entity as a start and an end with nothing between', () => {
    expect(boundaries('<!DOCTYPE a [<!ENTITY e "">]><a>&e;</a>').slice(1, -1)).toEqual([
      'startEntity(e)',
      'endEntity(e)',
    ]);
  });

  it('reports no boundaries for entities in attribute values, or for the predefined entities and character references', () => {
    expect(boundaries('<!DOCTYPE a [<!ENTITY e "x">]><a v="&e;">&amp;&#65;</a>')).toEqual([
      'startElement(, a, a, [v=x])',
      'characters(&A)',
      'endElement(, a, a)',
    ]);
  });

  it('reports boundaries around an external entity read through a resolver', () => {
    const options = {
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: () => ({ systemId: 'http://example.org/e.xml', text: '<?xml encoding="UTF-8"?><b>e</b>' }),
      },
    } as const;
    expect(boundaries('<!DOCTYPE a [<!ENTITY x SYSTEM "e.xml">]><a>&x;</a>', options).slice(1, -1)).toEqual([
      'startEntity(x)',
      'startElement(, b, b, [])',
      'characters(e)',
      'endElement(, b, b)',
      'endEntity(x)',
    ]);
  });

  it('reports an entity it cannot read as skipped, with no boundaries', () => {
    expect(boundaries('<!DOCTYPE a [<!ENTITY x SYSTEM "e.xml">]><a>&x;</a>').slice(1, -1)).toEqual([
      'skippedEntity(x)',
    ]);
  });

  it('gives the same boundaries when the document arrives in chunks', async () => {
    const xml = '<!DOCTYPE a [<!ENTITY o "<b>&i;</b>"><!ENTITY i "in">]><a>&o;&i;</a>';
    const bytes = new TextEncoder().encode(xml);
    const chunks = async function* () {
      for (let i = 0; i < bytes.length; i += 5) yield bytes.subarray(i, i + 5);
    };
    const { handler, calls } = recorder(BOUNDARIES);
    await new SAXParser().parseAsync(chunks(), handler);
    expect(calls).toEqual(boundaries(xml));
  });
});
