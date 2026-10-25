import { eventTypes, validating, validity, validityErrors, withSubset } from '@test/helpers/validity.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode, EventType, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { createFilteredReader } from '@exemplarjs/xml/filters';
import { dtdValidator } from '@/index.ts';

const DTD = `<!DOCTYPE doc [
  <!ELEMENT doc (head, item*, foot?)>
  <!ELEMENT head (#PCDATA)>
  <!ELEMENT item (#PCDATA | b)*>
  <!ELEMENT b EMPTY>
  <!ELEMENT foot ANY>
  <!ATTLIST item id ID #REQUIRED ref IDREF #IMPLIED kind (x|y) "x" n NMTOKENS #IMPLIED>
]>`;

/** Declarations for children named a, b and c, all EMPTY. */
const LEAVES = '<!ELEMENT a EMPTY><!ELEMENT b EMPTY><!ELEMENT c EMPTY>';

describe('dtdValidator', () => {
  it('accepts a valid document', () => {
    expect(validity(`${DTD}<doc><head>h</head><item id="a" ref="b">t<b/></item><item id="b"/><foot/></doc>`)).toEqual(
      []
    );
  });

  it('throws the first validity error without an error handler', () => {
    const reader = new XMLInputFactory({ validator: dtdValidator() }).createStreamReader('<doc/>');
    expect(() => {
      while (reader.next() !== EventType.END_DOCUMENT);
    }).toThrow(expect.objectContaining({ code: ErrorCode.VC_ROOT_ELEMENT }));
  });

  it('reports errors as XMLErrors with the location of the event that breaks the constraint', () => {
    const [error] = validityErrors(`${DTD}\n<doc>\n  <head/>\n  <bad/>\n</doc>`);
    expect(error).toBeInstanceOf(XMLError);
    expect(error).toMatchObject({ code: ErrorCode.VC_ELEMENT_VALID, line: 11, column: 3 });
  });

  it('keeps no state from one document to the next', () => {
    const errors: XMLError[] = [];
    const factory = validating(errors);
    const xml = `${DTD}<doc><head/><item id="a"/></doc>`;
    for (let i = 0; i < 2; i++) {
      const reader = factory.createStreamReader(xml);
      while (reader.next() !== EventType.END_DOCUMENT);
    }
    expect(errors).toEqual([]);
  });

  it.each([
    ['events after one it drops', '<doc><head>h</head><!-- c --><b/></doc>'],
    ['the events it drops', '<doc><head>h</head><item id="i"><b><!-- c --></b></item></doc>'],
  ])('validates, through a filter, %s', (_, body) => {
    const errors: XMLError[] = [];
    const reader = createFilteredReader(
      validating(errors).createStreamReader(`${DTD}${body}`),
      (r) => r.eventType() !== EventType.COMMENT
    );
    while (reader.next() !== EventType.END_DOCUMENT);
    expect(errors.map((e) => e.code)).toEqual([ErrorCode.VC_ELEMENT_VALID]);
  });
});

describe('VC: Root Element Type (§2.8)', () => {
  it('accepts a root of the type the DOCTYPE names', () => {
    expect(validity('<!DOCTYPE a [<!ELEMENT a EMPTY>]><a/>')).toEqual([]);
  });

  it('reports a root of another type', () => {
    expect(validity('<!DOCTYPE other [<!ELEMENT doc EMPTY>]><doc/>')).toEqual([ErrorCode.VC_ROOT_ELEMENT]);
  });

  it('reports a DOCTYPE without declarations that names another root', () => {
    expect(validity('<!DOCTYPE expected><actual/>')).toEqual([ErrorCode.VC_ROOT_ELEMENT, ErrorCode.VC_ELEMENT_VALID]);
  });

  it('reports a document without a DOCTYPE, whose elements are then undeclared', () => {
    expect(validity('<doc><child/></doc>')).toEqual([
      ErrorCode.VC_ROOT_ELEMENT,
      ErrorCode.VC_ELEMENT_VALID,
      ErrorCode.VC_ELEMENT_VALID,
    ]);
  });

  it('is a validity constraint, which a factory without a validator does not check', () => {
    const reader = new XMLInputFactory().createStreamReader('<!DOCTYPE expected><actual/>');
    expect(() => {
      while (reader.next() !== EventType.END_DOCUMENT);
    }).not.toThrow();
  });
});

describe('VC: Element Valid (§3)', () => {
  it('reports an element whose type is not declared, once, whatever it holds', () => {
    expect(validity('<!DOCTYPE a [<!ELEMENT a ANY>]><a><b/></a>')).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    expect(validity('<!DOCTYPE a [<!ELEMENT a ANY>]><a><b> t <![CDATA[x]]></b></a>')).toEqual([
      ErrorCode.VC_ELEMENT_VALID,
    ]);
  });

  it('leaves whitespace outside the root element alone', () => {
    const xml = '<!DOCTYPE a [<!ELEMENT a EMPTY>]>\n<a/>\n';
    expect(validity(xml, { reportPrologWhitespace: true })).toEqual([]);
    expect(eventTypes(xml, { reportPrologWhitespace: true })).toContain(EventType.SPACE);
  });

  describe('EMPTY', () => {
    it('accepts an empty-element tag, or a start tag followed at once by its end tag', () => {
      expect(validity('<!DOCTYPE a [<!ELEMENT a EMPTY>]><a/>')).toEqual([]);
      expect(validity('<!DOCTYPE a [<!ELEMENT a EMPTY>]><a></a>')).toEqual([]);
    });

    it.each([
      ['text', 'x'],
      ['whitespace', ' '],
      ['a character reference', '&#32;'],
      ['a CDATA section', '<![CDATA[x]]>'],
      ['an element', '<a/>'],
      ['a comment', '<!--c-->'],
      ['a processing instruction', '<?p?>'],
      ['a reference to an empty entity', '&empty;'],
      ['a reference to an entity with text', '&text;'],
    ])('reports %s in an element declared EMPTY', (_, content) => {
      const xml = withSubset('a', '<!ELEMENT a EMPTY><!ENTITY empty ""><!ENTITY text "t">', `<a>${content}</a>`);
      expect(validity(xml)).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    });

    it('reports an entity reference the cursor does not expand', () => {
      const xml = withSubset('a', '<!ELEMENT a EMPTY><!ENTITY e "x">', '<a>&e;</a>');
      expect(validity(xml, { replaceEntityReferences: false })).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    });

    it('validates what an entity the cursor does not expand holds, as if it were expanded (§3)', () => {
      const valid = withSubset('a', '<!ELEMENT a (b)><!ELEMENT b EMPTY><!ENTITY e "<b/>">', '<a>&e;</a>');
      expect(validity(valid, { replaceEntityReferences: false })).toEqual([]);
      const invalid = withSubset('a', '<!ELEMENT a (b)><!ELEMENT b EMPTY><!ENTITY e "<b>x</b>">', '<a>&e;</a>');
      expect(validity(invalid, { replaceEntityReferences: false })).toEqual([ErrorCode.VC_ELEMENT_VALID]);
      expect(eventTypes(valid, { replaceEntityReferences: false })).toEqual([
        EventType.DTD,
        EventType.START_ELEMENT,
        EventType.ENTITY_REFERENCE,
        EventType.END_ELEMENT,
      ]);
    });
  });

  describe('ANY', () => {
    it('accepts text, markup and declared children in any order', () => {
      const xml = withSubset('r', `<!ELEMENT r ANY>${LEAVES}`, '<r>t<c/><!--c--><a/> <?p?><a/>&#32;<![CDATA[x]]></r>');
      expect(validity(xml)).toEqual([]);
    });

    it('reports children whose types are not declared', () => {
      expect(validity(withSubset('r', '<!ELEMENT r ANY>', '<r><x/></r>'))).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    });
  });

  describe('mixed content (§3.2.2)', () => {
    it('accepts text and the listed children in any order and number', () => {
      const xml = withSubset('r', `<!ELEMENT r (#PCDATA|a|b)*>${LEAVES}`, '<r>x<b/>y<a/><a/><![CDATA[z]]>&#60;</r>');
      expect(validity(xml)).toEqual([]);
    });

    it('reports a child it does not list', () => {
      const xml = withSubset('r', `<!ELEMENT r (#PCDATA|a)*>${LEAVES}`, '<r>x<a/><c/></r>');
      expect(validity(xml)).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    });

    it('allows only text in (#PCDATA)', () => {
      const xml = withSubset('r', `<!ELEMENT r (#PCDATA)>${LEAVES}`, '<r>x<a/></r>');
      expect(validity(xml)).toEqual([ErrorCode.VC_ELEMENT_VALID]);
      expect(validity(withSubset('r', '<!ELEMENT r (#PCDATA)>', '<r>x<!--c-->y</r>'))).toEqual([]);
    });
  });

  describe('element content (§3.2.1)', () => {
    const subset = `<!ELEMENT r (a,b*,c?)>${LEAVES}<!ENTITY ws "&#32;"><!ENTITY ref "&#38;#32;"><!ENTITY kids "<b/><b/>">`;

    it.each([
      ['the required children', '<a/>'],
      ['every child', '<a/><b/><b/><c/>'],
      ['whitespace, comments and processing instructions between children', '\n <a/> <!--c--> <?p?>\n<c/>\n'],
      ['children from an entity', '<a/>&kids;'],
      ['an entity whose replacement text is whitespace', '<a/>&ws;'],
    ])('accepts %s', (_, content) => {
      expect(validity(withSubset('r', subset, `<r>${content}</r>`))).toEqual([]);
    });

    it.each([
      ['a missing child', ''],
      ['a child out of order', '<b/><a/>'],
      ['a child too many', '<a/><c/><c/>'],
      ['a child the model does not name', '<a/><x/>'],
      ['text', '<a/>t'],
      ['a character reference to whitespace', '<a/>&#32;'],
      ['an entity whose replacement text is a character reference', '<a/>&ref;'],
      ['a CDATA section of whitespace', '<a/><![CDATA[ ]]>'],
    ])('reports %s once', (_, content) => {
      const codes = validity(withSubset('r', `${subset}<!ELEMENT x EMPTY>`, `<r>${content}</r>`));
      expect(codes).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    });

    it('reports one content error per element, then stops checking its content', () => {
      expect(validity(withSubset('r', subset, '<r><b/><c/>text<a/></r>'))).toEqual([ErrorCode.VC_ELEMENT_VALID]);
    });

    it("checks each element against its own type's model", () => {
      const xml = withSubset('r', `<!ELEMENT r (s,s)><!ELEMENT s (a)>${LEAVES}`, '<r><s><b/></s><s/><s><a/></s></r>');
      expect(validity(xml)).toEqual([
        ErrorCode.VC_ELEMENT_VALID,
        ErrorCode.VC_ELEMENT_VALID,
        ErrorCode.VC_ELEMENT_VALID,
      ]);
    });

    it('reports incomplete content at the end tag', () => {
      const [error] = validityErrors(withSubset('r', subset, '<r>\n</r>'));
      expect(error).toMatchObject({ code: ErrorCode.VC_ELEMENT_VALID, line: 2, column: 1 });
    });

    it('reports whitespace between children as SPACE, and other text as CHARACTERS', () => {
      expect(eventTypes(withSubset('r', subset, '<r> <a/></r>'))).toEqual([
        EventType.DTD,
        EventType.START_ELEMENT,
        EventType.SPACE,
        EventType.START_ELEMENT,
        EventType.END_ELEMENT,
        EventType.END_ELEMENT,
      ]);
      expect(eventTypes(withSubset('r', `<!ELEMENT r ANY>${LEAVES}`, '<r> <a/></r>'))).toContain(EventType.CHARACTERS);
      expect(eventTypes(withSubset('r', subset, '<r><a/>&#32;</r>'))).toContain(EventType.CHARACTERS);
    });
  });
});
