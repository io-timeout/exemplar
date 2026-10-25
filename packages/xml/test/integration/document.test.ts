import { errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, XMLInputFactory } from '@/index.ts';

const encoder = new TextEncoder();
const BOM = [0xef, 0xbb, 0xbf];

/** The error code and location a source raises, as `code@line:column`. */
function failure(source: string | Uint8Array): string {
  try {
    const r = new XMLInputFactory().createStreamReader(source);
    while (r.next() !== EventType.END_DOCUMENT);
  } catch (error) {
    const { code, line, column } = error as { code: string; line: number; column: number };
    return `${code}@${line}:${column}`;
  }
  return 'accepted';
}

/** UTF-16LE bytes of a string, after a byte-order mark. */
function utf16le(text: string): Uint8Array {
  const units = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  return new Uint8Array([0xff, 0xfe, ...units.flatMap((unit) => [unit & 0xff, unit >> 8])]);
}

describe('the document (§2.1 [1]: prolog element Misc*)', () => {
  it.each([
    ['<a/><b/>', 'WF_SECOND_ROOT', 1, 5],
    ['<doc/><!--c--><e/>', 'WF_SECOND_ROOT', 1, 15],
    ['<a/>\n<b>x</b>', 'WF_SECOND_ROOT', 2, 1],
  ])('has one root element: %j', (xml, code, line, column) => {
    expect(errorOf(xml)).toMatchObject({ code, line, column });
  });

  it.each([
    ['', 1, 1],
    ['   ', 1, 4],
    ['\n\t \r\n', 3, 1],
    ['<!-- HELLO -->', 1, 15],
    ['<?p?>', 1, 6],
    ['<?xml version="1.0"?>', 1, 22],
    ['<!DOCTYPE a>', 1, 13],
  ])('must have a root element: %j', (xml, line, column) => {
    expect(errorOf(xml)).toMatchObject({ code: 'WF_EMPTY_DOCUMENT', line, column });
  });

  it.each([
    ['x<root/>', 1, 1],
    ['<?xml version="1.0"?>\na\n<root/>', 1, 22],
    ['<root/>a', 1, 8],
    ['<root>abc</root>de<f', 1, 17],
    ['<span>Welcome,</span> to monkey land', 1, 22],
    ['&#x20;<r/>', 1, 1],
    ['<r/>&#xA;', 1, 5],
    ['<r/>&amp;', 1, 5],
    ['<![CDATA[x]]><root/>', 1, 1],
    ['<r/><![CDATA[x]]>', 1, 5],
    ['<!DOCTYPE r>x<r/>', 1, 13],
    ['<!DOCTYPE r [<!ENTITY e "<x/>">]><r/>&e;', 1, 38],
  ])('allows only whitespace, comments and PIs outside the root element: %j', (xml, line, column) => {
    expect(errorOf(xml)).toMatchObject({ code: 'WF_CONTENT_OUTSIDE_ROOT', line, column });
  });

  it('allows comments, PIs and whitespace before and after the root element', () => {
    const xml = '<?xml version="1.0"?>\n<!--a-->\n<?p d?>\n<!DOCTYPE r>\n<!--b-->\n<r/>\n<!--c-->\n<?q?>\n';
    expect(parseEveryWay(xml)).toBe('<?p d?><r></r><?q ?>');
    expect(parseEveryWay(' \t\r\n<r/>')).toBe('<r></r>');
  });

  it('reads deep nesting and long tags within raised limits', () => {
    const depth = 1100;
    const nested = `${'<x>'.repeat(depth)}${'</x>'.repeat(depth)}`;
    expect(failure(nested)).toBe('LIMIT_ELEMENT_DEPTH@1:301');
    expect(parseEveryWay(nested, { limits: { elementDepth: depth } })).toBe(nested);
    expect(parseEveryWay(`<r${' '.repeat(16_384)}/>`)).toBe('<r></r>');
  });

  it('accepts a root element named xml, which is reserved but allowed', () => {
    expect(parseEveryWay('<?has unbalanced "quotes?><xml>body</xml>')).toBe(
      '<?has unbalanced "quotes?><xml>body</xml>'
    );
  });

  it.each([
    ['<root>', 'WF_UNCLOSED_ELEMENT@1:7'],
    ['<root><foo>', 'WF_UNCLOSED_ELEMENT@1:12'],
    ['<root><child/>', 'WF_UNCLOSED_ELEMENT@1:15'],
    ['</a>', 'WF_END_TAG_MISMATCH@1:1'],
    ['<r/></r>', 'WF_END_TAG_MISMATCH@1:5'],
    ['<a></A>', 'WF_END_TAG_MISMATCH@1:6'],
    ['<a><b></c></b></a>', 'WF_END_TAG_MISMATCH@1:9'],
  ])('closes every element it opens (WFC: Element Type Match): %j', (xml, outcome) => {
    expect(failure(xml)).toBe(outcome);
  });
});

describe('the XML declaration (§2.8 [23])', () => {
  it.each([
    ['<!--c--><?xml version="1.0"?><r/>', 'WF_XML_DECLARATION_MISPLACED@1:9'],
    [' <?xml version="1.0"?><r/>', 'WF_XML_DECLARATION_MISPLACED@1:2'],
    ['<r/><?xml version="1.0"?>', 'WF_XML_DECLARATION_MISPLACED@1:5'],
    ['<r><?xml version="1.0"?></r>', 'WF_XML_DECLARATION_MISPLACED@1:4'],
    ['<?XML version="1.0"?><r/>', 'WF_PI_TARGET_XML@1:1'],
    ['<?xml?><r/>', 'WF_XML_DECLARATION@1:6'],
    ['<?xml\u00A0version="1.0"?><r/>', 'WF_XML_DECLARATION_MISPLACED@1:1'],
  ])('comes first, or not at all: %j', (xml, outcome) => {
    expect(failure(xml)).toBe(outcome);
  });

  it('may name XML 1.1, which a 1.1 processor reads as 1.1', () => {
    const r = reader('<?xml version="1.1"?><r>\u0085</r>');
    expect([r.version(), r.next(), r.next(), r.text()]).toEqual([
      '1.1',
      EventType.START_ELEMENT,
      EventType.CHARACTERS,
      '\n',
    ]);
  });
});

describe('the DOCTYPE (§2.8 [28])', () => {
  it('comes once, before the root element', () => {
    expect(failure('<!DOCTYPE r><!DOCTYPE r><r/>')).toBe('WF_DOCTYPE_MISPLACED@1:13');
    expect(failure('<r/><!DOCTYPE r>')).toBe('WF_DOCTYPE_MISPLACED@1:5');
    expect(failure('<r><!DOCTYPE r></r>')).toBe('WF_DOCTYPE_MISPLACED@1:4');
  });

  it('may follow the XML declaration, comments and PIs, and be followed by them', () => {
    expect(
      parseEveryWay('<?xml version="1.0"?><!--c--><?p?><!DOCTYPE r [<!ELEMENT r ANY>]><!--note--><?work now?><r/>')
    ).toBe('<?p ?><?work now?><r></r>');
  });

  it('need not name the root element when not validating (VC: Root Element Type)', () => {
    expect(parseEveryWay('<!DOCTYPE expected><actual/>')).toBe('<actual></actual>');
  });

  it('is reported misplaced by a fed reader as soon as it arrives after the root, before the input ends', () => {
    const r = new XMLInputFactory().createAsyncStreamReader();
    r.feed(encoder.encode('<r/><!DOCTYPE r SYSTEM "r.dtd">'));
    expect(() => {
      while (r.next() !== EventType.NEED_INPUT);
    }).toThrow(expect.objectContaining({ code: 'WF_DOCTYPE_MISPLACED' }));
  });

  it.each([
    ['<!DOCTYPE root [', 'WF_UNEXPECTED_END@1:17'],
    ['<!DOCTYPE ><root/>', 'WF_DOCTYPE@1:11'],
    ['<!DOCTYPE root [<X>]><root/>', 'WF_DOCTYPE@1:17'],
    ['<!ENTITY x "y"><r/>', 'WF_MARKUP@1:1'],
    ['<!XXXXX zzzz="eeee"><r/>', 'WF_MARKUP@1:1'],
    ['<doc><! foo="FO\'O" > x</doc>', 'WF_MARKUP@1:6'],
  ])('rejects malformed or unknown markup declarations: %j', (xml, outcome) => {
    expect(failure(xml)).toBe(outcome);
  });

  it('reads a long internal subset of whitespace', () => {
    expect(parseEveryWay(`<!DOCTYPE r [${' '.repeat(16_384)}]><r/>`)).toBe('<r></r>');
  });
});

describe('byte-order marks (§4.3.3, Appendix F)', () => {
  it('skips a byte-order mark before the document, and keeps U+FEFF anywhere else as a character', () => {
    const r = reader(new Uint8Array([...BOM, ...encoder.encode('<?xml version="1.0"?><r a="\uFEFF">\uFEFF</r>')]));
    expect([r.next(), r.attributeValue(0), r.next(), r.text()]).toEqual([
      EventType.START_ELEMENT,
      '\uFEFF',
      EventType.CHARACTERS,
      '\uFEFF',
    ]);
  });

  it('rejects U+FEFF after whitespace, or a second one, as content outside the root', () => {
    expect(failure(encoder.encode(' \uFEFF<r/>'))).toBe('WF_CONTENT_OUTSIDE_ROOT@1:1');
    const twice = new Uint8Array([...BOM, ...BOM, ...encoder.encode('<r/>')]);
    expect(failure(twice)).toBe('WF_CONTENT_OUTSIDE_ROOT@1:1');
  });

  it('reads UTF-16 with a byte-order mark, the line end after the declaration being prolog whitespace', () => {
    const r = reader(utf16le('<?xml version="1.0" encoding="UTF-16"?>\n<person>Hi Jérôme</person>'));
    expect([r.next(), r.next(), r.text(), r.location().line]).toEqual([
      EventType.START_ELEMENT,
      EventType.CHARACTERS,
      'Hi Jérôme',
      2,
    ]);
  });

  it('detects UTF-16 from its byte-order mark without a declaration', () => {
    const r = reader(utf16le('<a>é</a>'));
    expect([r.encoding(), r.next(), r.next(), r.text()]).toEqual([
      'utf-16le',
      EventType.START_ELEMENT,
      EventType.CHARACTERS,
      'é',
    ]);
  });

  it('reads many multi-byte characters the same way however they arrive', () => {
    const text = '한글😀é'.repeat(4096);
    expect(parseEveryWay(`<r a="${text.slice(0, 50)}">${text}</r>`)).toBe(`<r a="${text.slice(0, 50)}">${text}</r>`);
  });

  it('rejects UTF-16 with a byte-order mark that declares UTF-8', () => {
    expect(failure(utf16le('<?xml version="1.0" encoding="UTF-8"?><p/>'))).toBe('ENCODING_MISMATCH@1:1');
  });
});
