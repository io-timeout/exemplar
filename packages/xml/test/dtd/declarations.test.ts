import { reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import type { DtdItem } from '@/dtd/store.ts';
import { EventType, type InputOptions, type Source } from '@/index.ts';
import { DTD_ITEMS } from '@/internal.ts';

/** The declarations of a document's DTD, in order. */
function declared(xml: Source, options: InputOptions = {}): unknown[] {
  const r = reader(xml, options);
  while (r.next() !== EventType.DTD);
  return r[DTD_ITEMS]()
    .filter((item): item is Extract<DtdItem, { declaration: unknown }> => 'declaration' in item)
    .map((item) => item.declaration);
}

const SERVED: InputOptions = {
  accessExternalDTD: 'all',
  entityResolver: {
    resolveEntity: ({ systemId }) =>
      systemId === 'a.dtd'
        ? {
            systemId: 'http://example.org/dtd/a.dtd',
            text: '<!ENTITY x SYSTEM "x.xml"><!ELEMENT a ANY><!ATTLIST a d CDATA "1"><!NOTATION n SYSTEM "n">',
          }
        : undefined,
  },
};

describe('the declarations a DTD reports', () => {
  it('give entity declarations their kind, value or identifiers, base URI and whether they are external', () => {
    const xml = {
      text: '<!DOCTYPE a [<!ENTITY i "v"><!ENTITY % p SYSTEM "p.ent">]><a/>',
      systemId: 'http://example.org/doc.xml',
    };
    expect(declared(xml)).toEqual([
      { name: 'i', isParameterEntity: false, value: 'v', declaredExternally: false },
      {
        name: 'p',
        isParameterEntity: true,
        systemId: 'p.ent',
        baseURI: 'http://example.org/doc.xml',
        declaredExternally: false,
      },
    ]);
  });

  it('give declarations in the external subset that subset’s base URI, and mark them external', () => {
    const xml = { text: '<!DOCTYPE a SYSTEM "a.dtd"><a/>', systemId: 'http://example.org/doc.xml' };
    expect(declared(xml, SERVED)).toEqual([
      {
        name: 'x',
        isParameterEntity: false,
        systemId: 'x.xml',
        baseURI: 'http://example.org/dtd/a.dtd',
        declaredExternally: true,
      },
      { name: 'a', content: 'ANY', declaredExternally: true },
      { element: 'a', name: 'd', type: 'CDATA', mode: 'DEFAULT', value: '1', declaredExternally: true },
      { name: 'n', systemId: 'n', baseURI: 'http://example.org/dtd/a.dtd' },
    ]);
  });

  it('give attribute declarations their element, type, allowed values, mode and normalized default', () => {
    expect(declared('<!DOCTYPE a [<!ATTLIST a e (x|y) " y " n NOTATION (g) #REQUIRED>]><a n="g"/>')).toEqual([
      {
        element: 'a',
        name: 'e',
        type: 'ENUMERATION',
        values: ['x', 'y'],
        mode: 'DEFAULT',
        value: 'y',
        declaredExternally: false,
      },
      { element: 'a', name: 'n', type: 'NOTATION', values: ['g'], mode: 'REQUIRED', declaredExternally: false },
    ]);
  });

  it('give element declarations their content model without whitespace', () => {
    expect(declared('<!DOCTYPE a [<!ELEMENT a ( b | c )*>]><a/>')).toEqual([
      { name: 'a', content: '(b|c)*', declaredExternally: false },
    ]);
  });
});
