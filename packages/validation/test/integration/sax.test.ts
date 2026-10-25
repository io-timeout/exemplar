import { validity, withSubset } from '@test/helpers/validity.ts';
import { describe, expect, it } from 'vitest';
import { SAXParser } from '@exemplarjs/sax';
import { ErrorCode, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { dtdValidator } from '@/index.ts';

const SUBSET =
  '<!ELEMENT r (s+)><!ELEMENT s (#PCDATA|t)*><!ELEMENT t EMPTY><!ATTLIST s id ID #REQUIRED ref IDREF #IMPLIED>';

/** Documents breaking one constraint each, and one breaking none. */
const DOCUMENTS = [
  withSubset('r', SUBSET, '<r>\n  <s id="a">x<t/></s>\n  <s id="b" ref="a"/>\n</r>'),
  withSubset('r', SUBSET, '<r/>'),
  withSubset('r', SUBSET, '<r><s id="a"/><s id="a"/></r>'),
  withSubset('r', SUBSET, '<r><s id="a" ref="b"/></r>'),
  withSubset('r', SUBSET, '<r><s/><t/></r>'),
  withSubset('other', SUBSET, '<r><s id="a"><t>x</t></s></r>'),
];

/** The validity error codes SAX reports for a document. */
function saxValidity(xml: string): string[] {
  const codes: string[] = [];
  new SAXParser(new XMLInputFactory({ validator: dtdValidator() })).parse(xml, { error: (e) => codes.push(e.code) });
  return codes;
}

describe('validating through SAX', () => {
  it.each(DOCUMENTS)('reports to the error handler what the cursor reports: %s', (xml) => {
    expect(saxValidity(xml)).toEqual(validity(xml));
  });

  it.each(DOCUMENTS)('reports the same through parseAsync: %s', async (xml) => {
    const codes: string[] = [];
    const parser = new SAXParser(new XMLInputFactory({ validator: dtdValidator() }));
    await parser.parseAsync(new TextEncoder().encode(xml), { error: (e) => codes.push(e.code) });
    expect(codes).toEqual(validity(xml));
  });

  it('throws the first validity error when no handler has an error method', () => {
    const parser = new SAXParser(new XMLInputFactory({ validator: dtdValidator() }));
    expect(() => parser.parse(DOCUMENTS[1] as string, {})).toThrow(XMLError);
    expect(() => parser.parse(DOCUMENTS[1] as string, {})).toThrow(
      expect.objectContaining({ code: ErrorCode.VC_ELEMENT_VALID })
    );
  });

  it('reports whitespace in element content as ignorable, and in mixed content as characters', () => {
    const ignorable: string[] = [];
    const characters: string[] = [];
    new SAXParser(new XMLInputFactory({ validator: dtdValidator() })).parse(DOCUMENTS[0] as string, {
      ignorableWhitespace: (text) => ignorable.push(text),
      characters: (text) => characters.push(text),
    });
    expect(ignorable).toEqual(['\n  ', '\n  ', '\n']);
    expect(characters).toEqual(['x']);
  });

  it('reports no whitespace as ignorable without a validator', () => {
    const ignorable: string[] = [];
    new SAXParser().parse(DOCUMENTS[0] as string, { ignorableWhitespace: (text) => ignorable.push(text) });
    expect(ignorable).toEqual([]);
  });
});
