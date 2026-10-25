import { verdict } from '@test/helpers/lexical.ts';
import { errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { ScanError } from '@/scan/scanner.ts';
import {
  couldStartDeclaration,
  type Declaration,
  type DeclarationKind,
  DECLARATION_START_LENGTH,
  DeclarationParser,
  startsWithDeclaration,
} from '@/tokenizer/declaration.ts';

/** Parses a declaration at the start of text: what it says and where it ends, or the error's code and index. */
function parse(text: string, kind: DeclarationKind = 'xml'): (Declaration & { end: number }) | string {
  const parser = new DeclarationParser(text, 0);
  try {
    return { ...parser.parse(kind), end: parser.end };
  } catch (error) {
    if (error instanceof ScanError) return `${error.code} @${error.index}`;
    throw error;
  }
}

describe('the XML declaration (§2.8 [23]–[32])', () => {
  it('reads version, encoding and standalone, and where the declaration ends', () => {
    expect(parse('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a/>')).toEqual({
      version: '1.0',
      encoding: 'UTF-8',
      standalone: true,
      end: 55,
    });
    expect(parse("<?xml version='1.1' standalone='no'?>")).toEqual({ version: '1.1', standalone: false, end: 37 });
    expect(parse('<?xml version="1.0"?>')).toEqual({ version: '1.0', end: 21 });
  });

  it('allows whitespace around = and before ?>, and any of space, tab, LF and CR (§2.3 [3], [25])', () => {
    expect(parse('<?xml\tversion = "1.0"\nencoding\r=\'x\' \t?>')).toEqual({ version: '1.0', encoding: 'x', end: 39 });
  });

  it('starts where it is told and reports the index after ?>', () => {
    const parser = new DeclarationParser('xx<?xml version="1.0"?>', 2);
    expect(parser.end).toBe(2);
    parser.parse('xml');
    expect(parser.end).toBe(23);
  });

  it.each([
    ['no version', '<?xml?>', 5],
    ['the encoding first', '<?xml encoding="UTF-8"?>', 6],
    ['standalone before the encoding', '<?xml version="1.0" standalone="no" encoding="UTF-8"?>', 36],
    ['an unknown pseudo-attribute', '<?xml version="1.0" other="x"?>', 20],
    ['version twice', '<?xml version="1.0" version="1.0"?>', 20],
    ['no whitespace before a pseudo-attribute', '<?xml version="1.0"encoding="UTF-8"?>', 19],
    ['no =', '<?xml version "1.0"?>', 14],
    ['no quotes', '<?xml version=1.0?>', 14],
    ['an unterminated value', '<?xml version="1.0?>', 14],
    ['mismatched quotes', '<?xml version="1.0\'?>', 14],
    ['no ?>', '<?xml version="1.0" >', 20],
    ['the end of the text', '<?xml version="1.0"', 19],
    ['a no-break space, which is not S', '<?xml version="1.0"\u00A0?>', 19],
  ])('rejects %s', (_, text, index) => {
    expect(parse(text)).toBe(`WF_XML_DECLARATION @${index}`);
  });

  it.each(['1.0', '1.1', '1.10', '1.999'])('accepts version %s ([26] VersionNum)', (version) => {
    expect(parse(`<?xml version="${version}"?>`)).toMatchObject({ version });
  });

  it.each(['', '1.', '2.0', '1.0a', ' 1.0', '1,0', '01.0'])('rejects version %j ([26] VersionNum)', (version) => {
    expect(parse(`<?xml version="${version}"?>`)).toBe('WF_XML_DECLARATION @14');
  });

  it.each(['UTF-8', 'x', 'ISO_8859-1', 'a.b_c-d9'])('accepts encoding %s ([81] EncName)', (encoding) => {
    expect(parse(`<?xml version="1.0" encoding="${encoding}"?>`)).toMatchObject({ encoding });
  });

  it.each(['', '8bit', '-x', 'a b', 'ISO-8859-1:1987', 'é'])('rejects encoding %j ([81] EncName)', (encoding) => {
    expect(parse(`<?xml version="1.0" encoding="${encoding}"?>`)).toBe('WF_XML_DECLARATION @29');
  });

  it.each(['YES', 'true', '', 'yes '])('rejects standalone %j ([32] SDDecl)', (value) => {
    expect(parse(`<?xml version="1.0" standalone="${value}"?>`)).toBe('WF_XML_DECLARATION @31');
  });

  it('rejects NEL and LS where whitespace may go, as XML 1.1 §2.11 requires', () => {
    expect(parse('<?xml\u0085version="1.0"?>')).toBe('WF_LINE_END_IN_DECLARATION @5');
    expect(parse('<?xml version="1.0"\u2028?>')).toBe('WF_LINE_END_IN_DECLARATION @19');
    expect(parse('<?xml version\u0085="1.0"?>')).toBe('WF_LINE_END_IN_DECLARATION @13');
  });
});

describe('the text declaration (§4.3.1 [77])', () => {
  it('needs the encoding, and allows the version', () => {
    expect(parse('<?xml encoding="UTF-8"?>', 'text')).toEqual({ encoding: 'UTF-8', end: 24 });
    expect(parse('<?xml version="1.1" encoding="UTF-8"?>', 'text')).toEqual({
      version: '1.1',
      encoding: 'UTF-8',
      end: 38,
    });
    expect(parse('<?xml version="1.0"?>', 'text')).toBe('WF_TEXT_DECLARATION @19');
    expect(parse('<?xml?>', 'text')).toBe('WF_TEXT_DECLARATION @5');
  });

  it('does not allow standalone', () => {
    expect(parse('<?xml encoding="UTF-8" standalone="yes"?>', 'text')).toBe('WF_TEXT_DECLARATION @23');
  });

  it('reports a malformed text declaration as one, not as an XML declaration', () => {
    expect(parse('<?xml version="1.0" encoding="8bit"?>', 'text')).toBe('WF_TEXT_DECLARATION @29');
    expect(parse('<?xml encoding="UTF-8"', 'text')).toBe('WF_TEXT_DECLARATION @22');
  });
});

describe('spotting a declaration', () => {
  it('takes <?xml followed by whitespace or ? as a declaration, and no other PI', () => {
    for (const text of ['<?xml version="1.0"?>', '<?xml\tversion', '<?xml\n', '<?xml\r', '<?xml?>']) {
      expect(startsWithDeclaration(text)).toBe(true);
    }
    for (const text of ['<?xml-stylesheet?>', '<?xmlns?>', '<?XML ?>', ' <?xml ?>', '<?xml']) {
      expect(startsWithDeclaration(text)).toBe(false);
    }
  });

  it('waits on text too short to tell that could still become <?xml and one more character', () => {
    for (const text of ['', '<', '<?', '<?x', '<?xml']) expect(couldStartDeclaration(text)).toBe(true);
    for (const text of ['a', '<a', '<?a', '<?xml ', '<?xml-']) expect(couldStartDeclaration(text)).toBe(false);
    expect(DECLARATION_START_LENGTH).toBe(6);
  });
});

describe('the XML declaration in documents', () => {
  it('reads version, encoding and standalone', () => {
    const r = reader('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a/>');
    expect([r.version(), r.encoding(), r.standalone()]).toEqual(['1.0', 'UTF-8', true]);
    const no = reader('<?xml version="1.0" standalone="no"?><a/>');
    expect(no.standalone()).toBe(false);
  });

  it('reports no version or standalone when there is no declaration', () => {
    const r = reader('<a/>');
    expect([r.version(), r.standalone()]).toEqual([undefined, undefined]);
  });

  it('requires the version first', () => {
    expect(errorOf('<?xml encoding="UTF-8"?><a/>')).toMatchObject({ code: 'WF_XML_DECLARATION', column: 7 });
  });

  it('requires the pseudo-attributes in order', () => {
    expect(errorOf('<?xml version="1.0" standalone="no" encoding="UTF-8"?><a/>').code).toBe('WF_XML_DECLARATION');
  });

  it('allows standalone only as yes or no', () => {
    expect(errorOf('<?xml version="1.0" standalone="true"?><a/>').code).toBe('WF_XML_DECLARATION');
  });

  it('checks the syntax of the encoding name (§4.3.3 [81])', () => {
    expect(errorOf('<?xml version="1.0" encoding="8bit"?><a/>').code).toBe('WF_XML_DECLARATION');
  });

  it('accepts any 1.x version, and single quotes', () => {
    expect(parseEveryWay("<?xml version='1.7'?><a/>")).toBe('<a></a>');
  });

  it('requires a version (§2.8 [23])', () => {
    expect(errorOf('<?xml?><r/>')).toMatchObject({ code: 'WF_XML_DECLARATION', column: 6 });
  });

  it('requires whitespace between pseudo-attributes', () => {
    expect(errorOf('<?xml version="1.0"encoding="UTF-8"?><a/>').code).toBe('WF_XML_DECLARATION');
  });

  it('allows whitespace before ?> and before the root, which is not text', () => {
    expect(parseEveryWay('<?xml version="1.0" encoding="UTF-8" ?>\n\t <root/>')).toBe('<root></root>');
  });

  it('rejects a no-break space in the declaration, which is not whitespace (§2.3 [3])', () => {
    expect(errorOf('<?xml version="1.0"\u00A0?><r/>').code).toBe('WF_XML_DECLARATION');
  });

  it('rejects NEL and LS in the declaration of an XML 1.1 document (§2.11)', () => {
    expect(errorOf('<?xml version="1.1"\u0085?><a/>').code).toBe('WF_LINE_END_IN_DECLARATION');
    expect(errorOf('<?xml version="1.1"\u2028?><a/>').code).toBe('WF_LINE_END_IN_DECLARATION');
  });

  it('rejects an XML declaration that is not at the very start', () => {
    expect(errorOf(' <?xml version="1.0"?><a/>')).toMatchObject({ code: 'WF_XML_DECLARATION_MISPLACED', column: 2 });
    expect(errorOf('<!--c--><?xml version="1.0"?><r/>').code).toBe('WF_XML_DECLARATION_MISPLACED');
    expect(errorOf('<a><?xml version="1.0"?></a>').code).toBe('WF_XML_DECLARATION_MISPLACED');
  });

  it('rejects a PI target that matches xml in another case, even at the start (§2.6)', () => {
    expect(errorOf('<?XML version="1.0"?><r/>').code).toBe('WF_PI_TARGET_XML');
  });

  it('takes a PI whose target only starts with xml as a PI', () => {
    expect(parseEveryWay('<?xml-stylesheet href="a.xsl"?><r/>')).toBe('<?xml-stylesheet href="a.xsl"?><r></r>');
  });

  it('reads a declaration split anywhere, as with stax-xml after <?xml', () => {
    expect(parseEveryWay('<?xml version="1.0"?><root a = "x"></root   >')).toBe('<root a="x"></root>');
  });

  it('switches to XML 1.1 rules only for version 1.1 (§2.8, XML 1.1 §4.3.4)', () => {
    expect(verdict('<?xml version="1.1"?><a>\u0085</a>')).toBe('accepted <a>&#10;</a>');
    expect(verdict('<?xml version="1.2"?><a>\u0085</a>')).toBe('accepted <a>\u0085</a>');
    expect(verdict('<?xml version="1.1"?><a>&#x1;</a>')).toBe('accepted <a>\u0001</a>');
    expect(verdict('<?xml version="1.0"?><a>&#x1;</a>')).toBe('WF_CHARACTER_REFERENCE 1:25');
  });
});
