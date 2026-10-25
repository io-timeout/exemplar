import { validity, validityErrors, withSubset } from '@test/helpers/validity.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@exemplarjs/xml';

const NOTATIONS = '<!NOTATION gif SYSTEM "gif"><!NOTATION png SYSTEM "png">';
const UNPARSED = `${NOTATIONS}<!ENTITY u SYSTEM "u.gif" NDATA gif><!ENTITY v SYSTEM "v.png" NDATA png><!ENTITY p "parsed">`;

/** A document whose root `a` (ANY, with children `b`) declares these attributes and has these on its start tag. */
function attributes(attlist: string, attrs: string, more = '', body = ''): string {
  const subset = `<!ELEMENT a ANY><!ELEMENT b ANY><!ATTLIST a ${attlist}>${more}`;
  return withSubset('a', subset, `<a ${attrs}>${body}</a>`);
}

describe('VC: Attribute Value Type (§3.1)', () => {
  it('reports an attribute not declared for its element', () => {
    expect(validity(attributes('x CDATA #IMPLIED', 'y="1"'))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
  });

  it('reports the attributes of an element with no attribute-list declaration', () => {
    expect(validity(attributes('x CDATA #IMPLIED', '', '', '<b y="1" z="2"/>'))).toEqual([
      ErrorCode.VC_ATTRIBUTE_TYPE,
      ErrorCode.VC_ATTRIBUTE_TYPE,
    ]);
  });

  it('requires namespace declarations to be declared like any other attribute', () => {
    expect(validity(attributes('x CDATA #IMPLIED', 'xmlns:p="urn:p"'))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
    expect(validity(attributes('xmlns:p CDATA #FIXED "urn:p"', 'xmlns:p="urn:p"'))).toEqual([]);
  });

  it.each(['xml:space="preserve"', 'xml:lang="en"'])(
    'requires %s to be declared like any other attribute (§2.10, §2.12)',
    (attr) => {
      expect(validity(attributes('x CDATA #IMPLIED', attr))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
      const declared = 'xml:space (default|preserve) #IMPLIED xml:lang CDATA #IMPLIED';
      expect(validity(attributes(declared, attr))).toEqual([]);
    }
  );

  it('accepts any text in CDATA', () => {
    expect(validity(attributes('c CDATA #IMPLIED', 'c=" &lt; 1 &#9;:x "'))).toEqual([]);
  });

  it.each(['IDREF', 'IDREFS', 'ENTITY', 'ENTITIES', 'NMTOKEN', 'NMTOKENS'])(
    'reports an empty %s value, or one of spaces only',
    (type) => {
      expect(validity(attributes(`v ${type} #IMPLIED`, 'v=""', UNPARSED))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
      expect(validity(attributes(`v ${type} #IMPLIED`, 'v="   "', UNPARSED))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
    }
  );
});

describe('the declared type of xml:space (§2.10)', () => {
  it.each(['CDATA', 'NMTOKEN', '(default|preserve|keep)', '(keep)'])(
    'reports xml:space declared as %s, used or not',
    (type) => {
      const subset = `<!ELEMENT a EMPTY><!ATTLIST a xml:space ${type} #IMPLIED>`;
      expect(validity(withSubset('a', subset, '<a/>'))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
      expect(validity(withSubset('a', subset, '<a xml:space="keep"/>'))).toEqual([ErrorCode.VC_ATTRIBUTE_TYPE]);
    }
  );

  it.each(['(default|preserve)', '(preserve|default)', '(default)', '(preserve)'])(
    'accepts xml:space declared as %s',
    (type) => {
      const subset = `<!ELEMENT a EMPTY><!ATTLIST a xml:space ${type} #IMPLIED>`;
      expect(validity(withSubset('a', subset, '<a/>'))).toEqual([]);
    }
  );

  it('reports the declaration once the DTD has been read, at the DOCTYPE', () => {
    const errors = validityErrors('\n<!DOCTYPE a [<!ELEMENT a EMPTY><!ATTLIST a xml:space CDATA #IMPLIED>]><a/>');
    expect(errors).toMatchObject([{ code: ErrorCode.VC_ATTRIBUTE_TYPE, line: 2, column: 1 }]);
  });
});

describe('VC: ID (§3.3.1)', () => {
  const more = '<!ATTLIST b j ID #IMPLIED>';

  it('accepts distinct Names, on elements of any type', () => {
    expect(validity(attributes('i ID #IMPLIED', 'i="x"', more, '<b j="y"/><b j="_z.1"/><b/>'))).toEqual([]);
  });

  it.each(['1a', '-a', 'a b', ''])('reports %j, which is not a Name', (value) => {
    expect(validity(attributes('i ID #IMPLIED', `i="${value}"`))).toEqual([ErrorCode.VC_ID]);
  });

  it('reports a value used twice, even by attributes of other names', () => {
    expect(validity(attributes('i ID #IMPLIED', 'i="x"', more, '<b j="y"/><b j="x"/>'))).toEqual([ErrorCode.VC_ID]);
  });
});

describe('VC: One ID per Element Type (§3.3.1)', () => {
  it('reports an element type with two ID attributes, in one declaration or two', () => {
    expect(validity(attributes('i ID #IMPLIED j ID #IMPLIED', ''))).toEqual([ErrorCode.VC_ONE_ID]);
    expect(validity(attributes('i ID #IMPLIED', '', '<!ATTLIST a j ID #IMPLIED>'))).toEqual([ErrorCode.VC_ONE_ID]);
  });
});

describe('VC: ID Attribute Default (§3.3.1)', () => {
  it.each(['#IMPLIED', '#REQUIRED'])('accepts %s', (mode) => {
    expect(validity(attributes(`i ID ${mode}`, 'i="x"'))).toEqual([]);
  });

  it.each(['"x"', '#FIXED "x"'])('reports the default %s', (mode) => {
    expect(validity(attributes(`i ID ${mode}`, ''))).toEqual([ErrorCode.VC_ID_DEFAULT]);
  });
});

describe('VC: IDREF (§3.3.1)', () => {
  const more = '<!ATTLIST b i ID #IMPLIED r IDREF #IMPLIED rs IDREFS #IMPLIED>';

  it('accepts references to IDs before and after them', () => {
    const body = '<b i="x" r="y"/><b i="y" rs="x  y"/><b r="x"/>';
    expect(validity(attributes('r IDREF #IMPLIED', 'r="y"', more, body))).toEqual([]);
  });

  it('reports a reference no ID matches once the document ends, where the reference is', () => {
    const errors = validityErrors(attributes('r IDREF #IMPLIED', '', more, '\n<b r="nowhere"/>\n'));
    expect(errors).toEqual([expect.objectContaining({ code: ErrorCode.VC_IDREF, line: 2, column: 1 })]);
  });

  it('checks each name of IDREFS', () => {
    expect(validity(attributes('r IDREF #IMPLIED', '', more, '<b i="x" rs="x y"/>'))).toEqual([ErrorCode.VC_IDREF]);
  });

  it.each([
    ['IDREF', '1a'],
    ['IDREFS', 'x 1b'],
  ])('reports a value of %s that is not a Name: %j', (type, value) => {
    expect(validity(attributes(`r ${type} #IMPLIED i ID #IMPLIED`, `i="x" r="${value}"`))).toEqual([
      ErrorCode.VC_IDREF,
    ]);
  });

  it('checks defaulted references too', () => {
    expect(validity(attributes('r IDREF "x"', ''))).toEqual([ErrorCode.VC_IDREF]);
  });
});

describe('VC: Entity Name (§3.3.1)', () => {
  it('accepts the names of unparsed entities', () => {
    expect(validity(attributes('e ENTITY #IMPLIED es ENTITIES #IMPLIED', 'e="u" es="u v"', UNPARSED))).toEqual([]);
  });

  it.each([
    ['a parsed entity', 'p'],
    ['an undeclared entity', 'q'],
    ['no Name', '1u'],
  ])('reports %s', (_, value) => {
    expect(validity(attributes('e ENTITY #IMPLIED', `e="${value}"`, UNPARSED))).toEqual([ErrorCode.VC_ENTITY_NAME]);
  });

  it('checks each name of ENTITIES', () => {
    expect(validity(attributes('es ENTITIES #IMPLIED', 'es="u p v"', UNPARSED))).toEqual([ErrorCode.VC_ENTITY_NAME]);
  });
});

describe('VC: Name Token (§3.3.1)', () => {
  it('accepts name tokens, which may start with any name character', () => {
    expect(validity(attributes('t NMTOKEN #IMPLIED ts NMTOKENS #IMPLIED', 't="-1.x" ts=" a  :b 2 "'))).toEqual([]);
  });

  it.each([
    ['NMTOKEN', 'a b'],
    ['NMTOKEN', 'a?'],
    ['NMTOKENS', 'a ?'],
  ])('reports a value of %s that is not name tokens: %j', (type, value) => {
    expect(validity(attributes(`t ${type} #IMPLIED`, `t="${value}"`))).toEqual([ErrorCode.VC_NAME_TOKEN]);
  });
});

describe('VC: Notation Attributes (§3.3.1)', () => {
  it('accepts a notation the declaration lists', () => {
    expect(validity(attributes('f NOTATION (gif|png) #IMPLIED', 'f="png"', NOTATIONS))).toEqual([]);
  });

  it('reports a value the declaration does not list', () => {
    expect(validity(attributes('f NOTATION (gif) #IMPLIED', 'f="png"', NOTATIONS))).toEqual([
      ErrorCode.VC_NOTATION_ATTRIBUTES,
    ]);
  });

  it('reports a listed notation that is not declared, used or not', () => {
    expect(validity(attributes('f NOTATION (gif|svg) #IMPLIED', '', NOTATIONS))).toEqual([
      ErrorCode.VC_NOTATION_ATTRIBUTES,
    ]);
  });
});

describe('VC: One Notation Per Element Type (§3.3.1)', () => {
  it('reports an element type with two NOTATION attributes', () => {
    const attlist = 'f NOTATION (gif) #IMPLIED g NOTATION (png) #IMPLIED';
    expect(validity(attributes(attlist, '', NOTATIONS))).toEqual([ErrorCode.VC_ONE_NOTATION]);
  });
});

describe('VC: No Notation on Empty Element (§3.3.1)', () => {
  it('reports a NOTATION attribute on an element type declared EMPTY', () => {
    const xml = withSubset('a', `<!ELEMENT a EMPTY><!ATTLIST a f NOTATION (gif) #IMPLIED>${NOTATIONS}`, '<a/>');
    expect(validity(xml)).toEqual([ErrorCode.VC_NOTATION_EMPTY]);
  });
});

describe('VC: No Duplicate Tokens (§3.3.1)', () => {
  it.each([
    ['an enumeration', 'v (x|y|x) #IMPLIED'],
    ['a notation type', 'v NOTATION (gif|gif) #IMPLIED'],
  ])('reports a name listed twice in %s', (_, attlist) => {
    expect(validity(attributes(attlist, '', NOTATIONS))).toEqual([ErrorCode.VC_DUPLICATE_TOKENS]);
  });
});

describe('VC: Enumeration (§3.3.1)', () => {
  it('accepts a listed value, after normalization', () => {
    expect(validity(attributes('v (x|y) #IMPLIED', 'v=" y "'))).toEqual([]);
  });

  it('reports a value not listed', () => {
    expect(validity(attributes('v (x|y) #IMPLIED', 'v="z"'))).toEqual([ErrorCode.VC_ENUMERATION]);
  });
});

describe('VC: Required Attribute (§3.3.2)', () => {
  it('accepts the attribute specified', () => {
    expect(validity(attributes('r CDATA #REQUIRED', 'r=""'))).toEqual([]);
  });

  it('reports it missing', () => {
    expect(validity(attributes('r CDATA #REQUIRED', ''))).toEqual([ErrorCode.VC_REQUIRED_ATTRIBUTE]);
  });
});

describe('VC: Attribute Default Value Syntactically Correct (§3.3.2)', () => {
  /** A document declaring an attribute of an element type it does not use. */
  const unused = (declaration: string): string =>
    withSubset('a', `<!ELEMENT a EMPTY><!ELEMENT e ANY><!ATTLIST e v ${declaration}>${UNPARSED}`, '<a/>');

  it.each([
    'CDATA "any thing"',
    'IDREF "x"',
    'IDREFS "x y"',
    'ENTITY "u"',
    'ENTITIES "u v"',
    'NMTOKEN "-1"',
    'NMTOKENS " a  b "',
    '(x|y) "y"',
    'NOTATION (gif|png) "png"',
    'NMTOKEN #FIXED "x"',
  ])('accepts %s', (declaration) => {
    expect(validity(unused(declaration))).toEqual([]);
  });

  it.each([
    'IDREF "1a"',
    'ENTITY "1a"',
    'IDREFS "x 1b"',
    'IDREFS ""',
    'ENTITIES ""',
    'ENTITIES "u 1v"',
    'NMTOKEN "a b"',
    'NMTOKEN ""',
    'NMTOKENS "a ?"',
    'NMTOKENS ""',
    '(x|y) "z"',
    'NOTATION (gif) "png"',
    'NMTOKEN #FIXED "a b"',
  ])('reports %s', (declaration) => {
    expect(validity(unused(declaration))).toEqual([ErrorCode.VC_DEFAULT_SYNTAX]);
  });
});

describe('VC: Fixed Attribute Default (§3.3.2)', () => {
  it.each([
    ['the fixed value', 'f="v"'],
    ['no value, so that the default applies', ''],
  ])('accepts %s', (_, attrs) => {
    expect(validity(attributes('f CDATA #FIXED "v"', attrs))).toEqual([]);
  });

  it('compares tokenized values after normalization', () => {
    expect(validity(attributes('t NMTOKENS #FIXED "x y"', 't=" x  y "'))).toEqual([]);
  });

  it('reports another value', () => {
    expect(validity(attributes('f CDATA #FIXED "v"', 'f="w"'))).toEqual([ErrorCode.VC_FIXED_DEFAULT]);
  });
});

describe('Namespaces in XML 1.0 §7: no colons in ID, IDREF, ENTITY and NOTATION values', () => {
  it.each([
    ['ID', 'i ID #IMPLIED', 'i="p:q"', []],
    ['IDREF', 'i ID #IMPLIED r IDREF #IMPLIED', 'i="x" r="p:x"', [ErrorCode.VC_IDREF]],
    ['IDREFS', 'i ID #IMPLIED r IDREFS #IMPLIED', 'i="x" r="x p:x"', [ErrorCode.VC_IDREF]],
    ['ENTITY', 'e ENTITY #IMPLIED', 'e="p:u"', [ErrorCode.VC_ENTITY_NAME]],
    ['ENTITIES', 'e ENTITIES #IMPLIED', 'e="u p:u"', [ErrorCode.VC_ENTITY_NAME]],
    ['NOTATION', 'f NOTATION (gif) #IMPLIED', 'f="p:gif"', [ErrorCode.VC_NOTATION_ATTRIBUTES]],
  ])('reports a colon in a value of %s when namespace-aware', (_, attlist, attrs, others) => {
    const xml = attributes(attlist, attrs, UNPARSED);
    expect(validity(xml)).toEqual([ErrorCode.VC_NAMESPACE_COLON, ...others]);
    expect(validity(xml, { namespaceAware: false })).toEqual(others);
  });

  it.each([
    ['NMTOKEN', 't NMTOKEN #IMPLIED', 't="p:q"'],
    ['CDATA', 'c CDATA #IMPLIED', 'c="p:q"'],
  ])('allows a colon in a value of %s', (_, attlist, attrs) => {
    expect(validity(attributes(attlist, attrs))).toEqual([]);
  });
});
