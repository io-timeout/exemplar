import { validating, validity, validityErrors, withFiles, withSubset } from '@test/helpers/validity.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode, EventType, type InputOptions, type XMLError } from '@exemplarjs/xml';

const SUBSET =
  '<!ELEMENT r (s+)><!ELEMENT s (#PCDATA|t)*><!ELEMENT t EMPTY><!ATTLIST s id ID #REQUIRED ref IDREFS #IMPLIED>';

/** An invalid document with errors in several places, each with a location. */
const INVALID = withSubset(
  'r',
  SUBSET,
  '<r>\n  <s id="a" ref="a b">x<t/></s>\n  <s id="a"/>\n  <s>é<u/></s>\n  <t/>\n</r>'
);

/** The code and location of each error. */
const summary = (errors: readonly XMLError[]): string[] => errors.map((e) => `${e.code} ${e.line}:${e.column}`);

/** Feeds a document's bytes to an async validating reader in chunks of one size; returns its errors. */
function fedErrors(xml: string, size: number, options: InputOptions = {}): XMLError[] {
  const errors: XMLError[] = [];
  const reader = validating(errors, options).createAsyncStreamReader();
  const bytes = new TextEncoder().encode(xml);
  let at = 0;
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event !== EventType.NEED_INPUT) continue;
    if (at < bytes.length) reader.feed(bytes.subarray(at, (at += size)));
    else reader.endOfInput();
  }
  return errors;
}

/** A document's bytes in chunks of one size. */
function* chunks(xml: string, size: number): Generator<Uint8Array> {
  const bytes = new TextEncoder().encode(xml);
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

describe('validating through every reader', () => {
  const expected = summary(validityErrors(INVALID));

  it('reports each error once, where it is', () => {
    expect(expected).toEqual([
      `${ErrorCode.VC_ID} 3:3`,
      `${ErrorCode.VC_REQUIRED_ATTRIBUTE} 4:3`,
      `${ErrorCode.VC_ELEMENT_VALID} 4:7`,
      `${ErrorCode.VC_ELEMENT_VALID} 4:7`,
      `${ErrorCode.VC_ELEMENT_VALID} 5:3`,
      `${ErrorCode.VC_IDREF} 2:3`,
    ]);
  });

  it.each([1, 2, 3, 7, 64])('reports the same from bytes in chunks of %i', (size) => {
    const errors: XMLError[] = [];
    const reader = validating(errors).createStreamReader(chunks(INVALID, size));
    while (reader.next() !== EventType.END_DOCUMENT);
    expect(summary(errors)).toEqual(expected);
  });

  it.each([1, 3, 7])('reports the same from an async reader fed chunks of %i', (size) => {
    expect(summary(fedErrors(INVALID, size))).toEqual(expected);
  });

  it('reports the same through the event reader, with whitespace in element content as SPACE', () => {
    const errors: XMLError[] = [];
    const types: EventType[] = [];
    for (const event of validating(errors).createEventReader(INVALID)) types.push(event.type);
    expect(summary(errors)).toEqual(expected);
    expect(types.filter((type) => type === EventType.SPACE)).toHaveLength(5);
  });
});

describe('validating against external declarations', () => {
  const files = {
    'r.dtd': SUBSET,
    'items.xml': '<s id="x">from an entity</s><s id="y"/>',
    'bad.xml': '<t/>',
  };
  const options = withFiles(files);

  it('reads the external subset through the resolver', () => {
    expect(validity('<!DOCTYPE r SYSTEM "r.dtd"><r><s id="a"/></r>', options)).toEqual([]);
    expect(validity('<!DOCTYPE r SYSTEM "r.dtd"><r><t/></r>', options)).toEqual([ErrorCode.VC_ELEMENT_VALID]);
  });

  it('lets the internal subset declare attributes first, so its declarations bind', () => {
    const xml = '<!DOCTYPE r SYSTEM "r.dtd" [<!ATTLIST s id CDATA #IMPLIED>]><r><s/><s id="1 2"/></r>';
    expect(validity(xml, options)).toEqual([]);
  });

  it('checks the content of external parsed entities', () => {
    const subset = '<!ENTITY items SYSTEM "items.xml"><!ENTITY bad SYSTEM "bad.xml">';
    expect(validity(`<!DOCTYPE r SYSTEM "r.dtd" [${subset}]><r>&items;</r>`, options)).toEqual([]);
    expect(validity(`<!DOCTYPE r SYSTEM "r.dtd" [${subset}]><r>&items;&bad;</r>`, options)).toEqual([
      ErrorCode.VC_ELEMENT_VALID,
    ]);
  });
});
