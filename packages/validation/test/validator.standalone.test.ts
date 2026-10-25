import { eventTypes, validity, withFiles } from '@test/helpers/validity.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode, EventType, XMLError } from '@exemplarjs/xml';

/** External declarations: element content, a defaulted attribute, a tokenized one, and an entity. */
const EXTERNAL = '<!ELEMENT a (b*)><!ELEMENT b EMPTY><!ATTLIST b d CDATA "x" t NMTOKENS #IMPLIED><!ENTITY ext "z">';
const options = withFiles({ 'a.dtd': EXTERNAL, 'b.ent': '<!ATTLIST b d CDATA "x">' });

/** A document with a standalone declaration and the external DTD. */
const standalone = (value: 'yes' | 'no', body: string): string =>
  `<?xml version="1.0" standalone="${value}"?><!DOCTYPE a SYSTEM "a.dtd">${body}`;

describe('VC: Standalone Document Declaration (§2.9)', () => {
  it('accepts a standalone document that depends on nothing external', () => {
    expect(validity(standalone('yes', '<a><b d="y"/></a>'), options)).toEqual([]);
  });

  it('reports an attribute defaulted from an external declaration', () => {
    expect(validity(standalone('yes', '<a><b/></a>'), options)).toEqual([ErrorCode.VC_STANDALONE]);
  });

  it('reports a tokenized value that normalization under an external declaration changes', () => {
    expect(validity(standalone('yes', '<a><b d="y" t=" p  q "/></a>'), options)).toEqual([ErrorCode.VC_STANDALONE]);
    expect(validity(standalone('yes', '<a><b d="y" t="p q"/></a>'), options)).toEqual([]);
  });

  it('reports whitespace in element content declared externally', () => {
    const xml = standalone('yes', '<a>\n  <b d="y"/>\n</a>');
    expect(validity(xml, options)).toEqual([ErrorCode.VC_STANDALONE, ErrorCode.VC_STANDALONE]);
    expect(eventTypes(xml, options).filter((type) => type === EventType.SPACE)).toHaveLength(2);
  });

  it('accepts all of these when the document is not standalone', () => {
    expect(validity(standalone('no', '<a> <b/> <b t=" p "/></a>'), options)).toEqual([]);
  });

  it('accepts defaults and element content declared in the internal subset', () => {
    const subset = '<!ELEMENT a (b*)><!ELEMENT b EMPTY><!ATTLIST b d CDATA "x" t NMTOKENS #IMPLIED>';
    const xml = `<?xml version="1.0" standalone="yes"?><!DOCTYPE a [${subset}]><a> <b t=" p "/></a>`;
    expect(validity(xml)).toEqual([]);
  });

  it.each([
    ['an external parameter entity', '<!ENTITY % p SYSTEM "b.ent">%p;'],
    ['an internal parameter entity', '<!ENTITY % p \'<!ATTLIST b d CDATA "x">\'>%p;'],
  ])('counts declarations in %s as external', (_, declare) => {
    const xml = `<?xml version="1.0" standalone="yes"?><!DOCTYPE a [<!ELEMENT a (b)><!ELEMENT b EMPTY>${declare}]><a><b/></a>`;
    expect(validity(xml, options)).toEqual([ErrorCode.VC_STANDALONE]);
  });

  it('makes a reference to an externally declared entity a well-formedness error (WFC: Entity Declared)', () => {
    expect(() => validity(standalone('yes', '<a>&ext;</a>'), options)).toThrow(
      expect.objectContaining({ code: ErrorCode.WF_UNDECLARED_ENTITY })
    );
    expect(() => validity(standalone('yes', '<a>&ext;</a>'), options)).toThrow(XMLError);
  });
});
