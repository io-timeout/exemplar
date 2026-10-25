import { validity, validityErrors, withFiles, withSubset } from '@test/helpers/validity.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@exemplarjs/xml';

describe('VC: Unique Element Type Declaration (§3.2)', () => {
  it('reports an element type declared twice', () => {
    expect(validity('<!DOCTYPE a [<!ELEMENT a EMPTY><!ELEMENT a ANY>]><a/>')).toEqual([
      ErrorCode.VC_UNIQUE_ELEMENT_TYPE,
    ]);
  });
});

describe('VC: No Duplicate Types (§3.2.2)', () => {
  it('reports a name mixed content lists twice', () => {
    expect(validity('<!DOCTYPE a [<!ELEMENT a (#PCDATA|b|b)*><!ELEMENT b EMPTY>]><a/>')).toEqual([
      ErrorCode.VC_NO_DUPLICATE_TYPES,
    ]);
  });

  it('reports it once the DTD has been read, at the DOCTYPE', () => {
    const [error] = validityErrors('\n<!DOCTYPE a [<!ELEMENT a (#PCDATA|b|b)*>]><a/>');
    expect(error).toMatchObject({ line: 2, column: 1 });
  });
});

describe('declarations that are not errors (§3.2, §3.3)', () => {
  it('accepts a content model naming types the DTD does not declare, until one is used', () => {
    expect(validity('<!DOCTYPE a [<!ELEMENT a (b?)>]><a/>')).toEqual([]);
    expect(validity('<!DOCTYPE a [<!ELEMENT a (b?)>]><a><b/></a>')).toEqual([ErrorCode.VC_ELEMENT_VALID]);
  });

  it('accepts attribute lists for undeclared element types, and keeps the first declaration of an attribute', () => {
    const subset = '<!ELEMENT a EMPTY><!ATTLIST z q CDATA #IMPLIED><!ATTLIST a q CDATA #IMPLIED q ID #IMPLIED>';
    expect(validity(withSubset('a', subset, '<a q="1 2"/>'))).toEqual([]);
  });
});

describe('VC: Proper Declaration/PE Nesting (§2.8)', () => {
  it('reports a declaration that ends in another parameter entity than it starts in', () => {
    const options = withFiles({ 'a.dtd': '<!ENTITY % close ">"><!ELEMENT a EMPTY %close;' });
    expect(validity('<!DOCTYPE a SYSTEM "a.dtd"><a/>', options)).toEqual([ErrorCode.VC_PE_NESTING]);
  });
});

describe('VC: Proper Group/PE Nesting (§3.2.1)', () => {
  it('reports a group that ends in another parameter entity than it starts in', () => {
    const options = withFiles({ 'a.dtd': '<!ENTITY % open "(b"><!ELEMENT a %open;)><!ELEMENT b EMPTY>' });
    expect(validity('<!DOCTYPE a SYSTEM "a.dtd"><a><b/></a>', options)).toEqual([ErrorCode.VC_PE_NESTING]);
  });

  it('accepts a whole group in a parameter entity', () => {
    const options = withFiles({ 'a.dtd': '<!ENTITY % group "(b)"><!ELEMENT a %group;><!ELEMENT b EMPTY>' });
    expect(validity('<!DOCTYPE a SYSTEM "a.dtd"><a><b/></a>', options)).toEqual([]);
  });
});

describe('VC: Proper Conditional Section/PE Nesting (§3.4)', () => {
  it.each([
    ['its start', '<!ENTITY % s "<![INCLUDE[ <!ELEMENT a EMPTY>">%s;]]>'],
    ['its end', '<!ENTITY % s "<![INCLUDE["><!ENTITY % e "]]>">%s;<!ELEMENT a EMPTY>%e;'],
  ])('reports a conditional section with %s in a parameter entity', (_, dtd) => {
    expect(validity('<!DOCTYPE a SYSTEM "a.dtd"><a/>', withFiles({ 'a.dtd': dtd }))).toEqual([ErrorCode.VC_PE_NESTING]);
  });
});

describe('VC: Unique Notation Name (§4.7)', () => {
  it('reports a notation declared twice', () => {
    const xml = withSubset('a', '<!ELEMENT a EMPTY><!NOTATION n SYSTEM "x"><!NOTATION n SYSTEM "y">', '<a/>');
    expect(validity(xml)).toEqual([ErrorCode.VC_UNIQUE_NOTATION]);
  });
});

describe('VC: Notation Declared (§4.2.2)', () => {
  it('reports an unparsed entity whose notation is not declared, used or not', () => {
    const xml = withSubset('a', '<!ELEMENT a EMPTY><!ENTITY u SYSTEM "u.bin" NDATA bin>', '<a/>');
    expect(validity(xml)).toEqual([ErrorCode.VC_NOTATION_DECLARED]);
  });

  it('accepts a notation declared after the entity', () => {
    const xml = withSubset(
      'a',
      '<!ELEMENT a EMPTY><!ENTITY u SYSTEM "u.bin" NDATA bin><!NOTATION bin SYSTEM "b">',
      '<a/>'
    );
    expect(validity(xml)).toEqual([]);
  });
});

describe('VC: Entity Declared (§4.1)', () => {
  const options = withFiles({ 'a.dtd': '<!ELEMENT a (#PCDATA)>' });

  it('reports a reference to an undeclared entity in a document with an external subset', () => {
    expect(validity('<!DOCTYPE a SYSTEM "a.dtd"><a>&undeclared;</a>', options)).toEqual([ErrorCode.VC_ENTITY_DECLARED]);
  });

  it('reports one in an attribute value too', () => {
    const xml = '<!DOCTYPE a SYSTEM "a.dtd" [<!ATTLIST a v CDATA #IMPLIED>]><a v="&undeclared;"/>';
    expect(validity(xml, options)).toEqual([ErrorCode.VC_ENTITY_DECLARED]);
  });
});
