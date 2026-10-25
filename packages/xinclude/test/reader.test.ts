import { type Files, MAIN, XI, errorOf, factory, failure, included, read } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import { SAXParser } from '@exemplarjs/sax';
import { EventType, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { xincludeProcessor } from '@/index.ts';

const FILES: Files = {
  'file:///doc/part.xml':
    '<?xml version="1.0"?>\n<!DOCTYPE part [<!ENTITY e "E">]>\n<!--c-->\n<?pi data?>\n' +
    '<part xml:lang="fr"><p xml:id="a">A&e;</p><p>B</p></part>\n<!--after-->\n',
  'file:///doc/plain.xml': '<plain/>',
  'file:///doc/note.txt': 'Some <text> & more',
  'file:///doc/empty.txt': '',
  'file:///doc/sub/outer.xml': `<outer ${XI}><xi:include href="inner.xml"/></outer>`,
  'file:///doc/sub/inner.xml': '<inner/>',
  'file:///doc/a%20b.xml': '<spaced/>',
  'file:///doc/caf%C3%A9.xml': '<accented/>',
  'file:///doc/bad.xml': '<bad>',
  'file:///base/plain.xml': '<from-base/>',
};

/** The document read from MAIN, without the fix-ups, so that only what is included shows. */
function plain(main: string, files: Files = FILES): string {
  return read(files, main, { settings: { fixupBaseURIs: false, fixupLanguage: false } });
}

describe('xi:include with parse="xml" (XInclude §4.2)', () => {
  it('replaces xi:include with every child of the document but its DOCTYPE (§4.2.1)', () => {
    expect(plain(`<r ${XI}><xi:include href="part.xml"/></r>`)).toBe(
      `<r ${XI}><!--c--><?pi data?><part xml:lang="fr"><p xml:id="a">AE</p><p>B</p></part><!--after--></r>`
    );
  });

  it('takes parse="xml" as the default (§3.1)', () => {
    expect(plain(`<r ${XI}><xi:include href="plain.xml" parse="xml"/></r>`)).toBe(
      plain(`<r ${XI}><xi:include href="plain.xml"/></r>`)
    );
  });

  it('keeps the content around the xi:include in place', () => {
    expect(plain(`<r ${XI}>a<b/><xi:include href="plain.xml"/>c<d/></r>`)).toBe(
      `<r ${XI}>a<b></b><plain></plain>c<d></d></r>`
    );
  });

  it('includes the same document as often as it is referred to, which is no loop (§4.2.7)', () => {
    expect(plain(`<r ${XI}><xi:include href="plain.xml"/><xi:include href="plain.xml"/></r>`)).toBe(
      `<r ${XI}><plain></plain><plain></plain></r>`
    );
  });

  it('processes the inclusions in an included document, against its own base URI (§4.2)', () => {
    expect(plain(`<r ${XI}><xi:include href="sub/outer.xml"/></r>`)).toBe(
      `<r ${XI}><outer ${XI}><inner></inner></outer></r>`
    );
  });

  it('resolves href against the base URI of the xi:include, which xml:base sets (§4.1)', () => {
    expect(plain(`<r ${XI} xml:base="/base/"><xi:include href="plain.xml"/></r>`)).toBe(
      `<r ${XI} xml:base="/base/"><from-base></from-base></r>`
    );
    expect(plain(`<r ${XI}><xi:include xml:base="/base/x" href="plain.xml"/></r>`)).toBe(
      `<r ${XI}><from-base></from-base></r>`
    );
  });

  it.each([
    ['a space', 'a b.xml', '<spaced></spaced>'],
    ['a non-ASCII character', 'café.xml', '<accented></accented>'],
  ])('escapes %s in href before resolving it (§4.1.1)', (_what, href, content) => {
    expect(plain(`<r ${XI}><xi:include href="${href}"/></r>`)).toBe(`<r ${XI}>${content}</r>`);
  });

  it('ignores the encoding attribute when parse="xml" (§3.1)', () => {
    expect(plain(`<r ${XI}><xi:include href="plain.xml" encoding="x-none"/></r>`)).toBe(`<r ${XI}><plain></plain></r>`);
  });

  it('accepts an href that escapes a character itself', () => {
    expect(plain(`<r ${XI}><xi:include href="a%20b.xml"/></r>`)).toBe(`<r ${XI}><spaced></spaced></r>`);
  });

  it('ignores unknown attributes, with a prefix or without (§3.1)', () => {
    const main = `<r ${XI} xmlns:o="urn:o"><xi:include href="plain.xml" future="x" o:other="y"/></r>`;
    expect(plain(main)).toBe(`<r ${XI} xmlns:o="urn:o"><plain></plain></r>`);
  });

  it('passes other elements in the XInclude namespace through outside xi:include', () => {
    expect(plain(`<r ${XI}><xi:other a="1">x</xi:other></r>`)).toBe(`<r ${XI}><xi:other a="1">x</xi:other></r>`);
  });

  it('ignores content of xi:include outside the XInclude namespace, and descendants of its children (§3.1)', () => {
    const main = `<r ${XI}><xi:include href="plain.xml">text<!--c--><?p?><x><xi:fallback/><xi:include/></x></xi:include></r>`;
    expect(plain(main)).toBe(`<r ${XI}><plain></plain></r>`);
  });

  it('gives what an included document holds through the cursor, event by event', () => {
    const reader = factory(FILES).createStreamReader({
      text: `<r ${XI}><xi:include href="part.xml"/></r>`,
      systemId: MAIN,
    });
    const seen: string[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      expect(reader.eventType()).toBe(e);
      expect(reader.hasNext()).toBe(true);
      if (e === EventType.PROCESSING_INSTRUCTION) seen.push(`pi ${reader.piTarget()} ${reader.piData()}`);
      if (e === EventType.START_ELEMENT) seen.push(`${reader.prefix()}|${reader.localName()}|${reader.namespaceURI()}`);
      if (e === EventType.CHARACTERS) seen.push(`${reader.text()} ${reader.isWhitespace()}`);
    }
    expect(reader.hasNext()).toBe(false);
    expect(seen).toEqual(['|r|', 'pi pi data', '|part|', '|p|', 'A false', 'E false', '|p|', 'B false']);
  });

  it('fails as the included document does when it is not well-formed (§4.2)', () => {
    const error = errorOf(() => read(FILES, `<r ${XI}><xi:include href="bad.xml"/></r>`));
    expect(error.code).toBe('WF_UNCLOSED_ELEMENT');
    expect(error.systemId).toBe('file:///doc/bad.xml');
  });
});

describe('xi:include with parse="text" (XInclude §4.3)', () => {
  it('includes a resource as character data', () => {
    expect(included(FILES, `<r ${XI}><xi:include href="note.txt" parse="text"/></r>`)).toBe(
      '<r>Some &lt;text&gt; &amp; more</r>'
    );
  });

  it('gives the text event no name or target, as the cursor gives a CHARACTERS event none', () => {
    const reader = factory(FILES).createStreamReader({
      text: `<r ${XI}><xi:include href="note.txt" parse="text"/></r>`,
      systemId: MAIN,
    });
    let event = reader.next();
    while (event !== EventType.CHARACTERS) event = reader.next();
    expect([
      reader.name(),
      reader.localName(),
      reader.prefix(),
      reader.namespaceURI(),
      reader.piTarget(),
      reader.piData(),
    ]).toEqual(['', '', '', '', '', '']);
  });

  it('reports the text as one CHARACTERS event, white space or not', () => {
    const files = { ...FILES, 'file:///doc/ws.txt': ' \n' };
    const reader = factory(files).createStreamReader({
      text: `<r ${XI}><xi:include href="ws.txt" parse="text"/><xi:include href="note.txt" parse="text"/></r>`,
      systemId: MAIN,
    });
    const texts: [string, boolean][] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      if (e === EventType.CHARACTERS) texts.push([reader.text(), reader.isWhitespace()]);
    }
    expect(texts).toEqual([
      [' \n', true],
      ['Some <text> & more', false],
    ]);
  });

  it('includes nothing for an empty resource', () => {
    expect(plain(`<r ${XI}>a<xi:include href="empty.txt" parse="text"/>b</r>`)).toBe(`<r ${XI}>ab</r>`);
  });

  it('includes the document itself as text for an empty or missing href, which is no loop (§4.3)', () => {
    const main = `<r ${XI}><xi:include parse="text"/></r>`;
    expect(included(FILES, main)).toBe(`<r>${main.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</r>`);
    const empty = `<r ${XI}><xi:include href="" parse="text"/></r>`;
    expect(included(FILES, empty)).toBe(`<r>${empty.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</r>`);
  });

  it('decodes bytes in the encoding the encoding attribute names (§4.3)', () => {
    const files = { 'file:///doc/latin1.txt': new Uint8Array([0x63, 0x61, 0x66, 0xe9]) };
    expect(included(files, `<r ${XI}><xi:include href="latin1.txt" parse="text" encoding="ISO-8859-1"/></r>`)).toBe(
      '<r>café</r>'
    );
  });

  it('fails with XINCLUDE_TEXT on bytes illegal in the encoding (§4.3)', () => {
    const files = { 'file:///doc/bad.txt': new Uint8Array([0x61, 0xff]) };
    expect(failure(files, `<r ${XI}><xi:include href="bad.txt" parse="text"/></r>`)).toBe('XINCLUDE_TEXT');
  });

  it('fails with XINCLUDE_TEXT on a character XML does not allow, even with a fallback (§4.3)', () => {
    const files = { 'file:///doc/ctl.txt': 'a\u0001b' };
    const main = `<r ${XI}><xi:include href="ctl.txt" parse="text"><xi:fallback/></xi:include></r>`;
    expect(failure(files, main)).toBe('XINCLUDE_TEXT');
  });

  it('allows the characters XML 1.1 allows in an XML 1.1 document', () => {
    const files = { 'file:///doc/ctl.txt': 'a\u0001b' };
    const main = `<?xml version="1.1"?><r ${XI}><xi:include href="ctl.txt" parse="text"/></r>`;
    expect(plain(main, files)).toBe(`<r ${XI}>a\u0001b</r>`);
  });

  it.each([
    [
      'decoding',
      {
        'x-broken': () => ({
          decode: (): string => {
            throw new RangeError('broken');
          },
        }),
      },
    ],
    [
      'being made',
      {
        'x-broken': () => {
          throw new RangeError('no decoder');
        },
      },
    ],
  ])('fails with XINCLUDE_TEXT when a registered decoder throws on %s', (_when, decoders) => {
    const files = { 'file:///doc/note.txt': new Uint8Array([0x61]) };
    const main = `<r ${XI}><xi:include href="note.txt" parse="text" encoding="x-broken"/></r>`;
    expect(failure(files, main, { options: { decoders } })).toBe('XINCLUDE_TEXT');
  });

  it('treats an encoding it cannot decode as a resource error, which a fallback replaces (§4.4)', () => {
    const main = `<r ${XI}><xi:include href="note.txt" parse="text" encoding="x-none"><xi:fallback>F</xi:fallback></xi:include></r>`;
    const files = { 'file:///doc/note.txt': new Uint8Array([0x61]) };
    expect(plain(main, files)).toBe(`<r ${XI}>F</r>`);
  });
});

describe('xi:fallback (XInclude §3.2, §4.4)', () => {
  it('replaces a resource that cannot be read with the fallback’s content', () => {
    const main = `<r ${XI}><xi:include href="missing.xml"><xi:fallback>t<f a="1"><g/></f><!--c--><?p d?></xi:fallback></xi:include></r>`;
    expect(plain(main)).toBe(`<r ${XI}>t<f a="1"><g></g></f><!--c--><?p d?></r>`);
  });

  it('replaces it with nothing when the fallback is empty', () => {
    expect(plain(`<r ${XI}>a<xi:include href="missing.xml"><xi:fallback/></xi:include>b</r>`)).toBe(`<r ${XI}>ab</r>`);
  });

  it('leaves the fallback out when the inclusion succeeds', () => {
    const main = `<r ${XI}><xi:include href="plain.xml"><xi:fallback><f/></xi:fallback></xi:include></r>`;
    expect(plain(main)).toBe(`<r ${XI}><plain></plain></r>`);
  });

  it('ignores what sits beside the fallback in the xi:include (§3.1)', () => {
    const main = `<r ${XI}><xi:include href="missing.xml">x<y/><xi:fallback>F</xi:fallback><z/></xi:include></r>`;
    expect(plain(main)).toBe(`<r ${XI}>F</r>`);
  });

  it('processes inclusions in a fallback, falling back again in turn (§4.4)', () => {
    const main =
      `<r ${XI}><xi:include href="missing.xml"><xi:fallback>` +
      '<xi:include href="also-missing.xml"><xi:fallback><xi:include href="plain.xml"/></xi:fallback></xi:include>' +
      '</xi:fallback></xi:include></r>';
    expect(plain(main)).toBe(`<r ${XI}><plain></plain></r>`);
  });

  it('does not report errors inside a fallback that is not used', () => {
    const main = `<r ${XI}><xi:include href="plain.xml"><xi:fallback><xi:fallback/><xi:include/></xi:fallback></xi:include></r>`;
    expect(plain(main)).toBe(`<r ${XI}><plain></plain></r>`);
  });

  it('fails with XINCLUDE_RESOURCE on a resource error without a fallback (§4.4)', () => {
    const error = errorOf(() => read(FILES, `<r ${XI}>\n  <xi:include href="missing.xml"/></r>`));
    expect([error.code, error.line, error.systemId]).toEqual(['XINCLUDE_RESOURCE', 2, MAIN]);
  });

  it('tells the error handler of a fatal error before throwing it', () => {
    const fatal: string[] = [];
    const setup = { options: { errorHandler: { fatalError: (e: XMLError) => fatal.push(e.code) } } };
    expect(failure(FILES, `<r ${XI}><xi:include href="missing.xml"/></r>`, setup)).toBe('XINCLUDE_RESOURCE');
    expect(fatal).toEqual(['XINCLUDE_RESOURCE']);
  });
});

describe('XInclude structure errors (XInclude §3.1, §3.2)', () => {
  it.each([
    ['at the top of an element', `<r ${XI}><xi:fallback/></r>`],
    ['as the document element', `<xi:fallback ${XI}/>`],
    [
      'inside a fallback in use',
      `<r ${XI}><xi:include href="missing.xml"><xi:fallback><xi:fallback/></xi:fallback></xi:include></r>`,
    ],
    [
      'in an element in a fallback',
      `<r ${XI}><xi:include href="missing.xml"><xi:fallback><f><xi:fallback/></f></xi:fallback></xi:include></r>`,
    ],
  ])('rejects xi:fallback that is not a child of xi:include, %s', (_where, main) => {
    expect(failure(FILES, main)).toBe('XINCLUDE_STRUCTURE');
  });

  it.each([
    ['two xi:fallback children', `<xi:include href="plain.xml"><xi:fallback/><xi:fallback/></xi:include>`],
    ['an xi:include child', `<xi:include href="plain.xml"><xi:include href="plain.xml"/></xi:include>`],
    ['another XInclude element', `<xi:include href="plain.xml"><xi:other/></xi:include>`],
  ])('rejects an xi:include holding %s', (_what, include) => {
    expect(failure(FILES, `<r ${XI}>${include}</r>`)).toBe('XINCLUDE_STRUCTURE');
  });
});

describe('xi:include attribute errors (XInclude §3.1)', () => {
  it.each([
    ['a fragment identifier in href', 'href="plain.xml#x"'],
    ['a % that begins no escape in href', 'href="a%zz.xml"'],
    ['a % at the end of href', 'href="a%"'],
    ['neither href nor xpointer', ''],
    ['an empty href and no xpointer', 'href=""'],
    ['xpointer with parse="text"', 'href="note.txt" parse="text" xpointer="a"'],
    ['a parse value other than xml or text', 'href="plain.xml" parse="html"'],
    ['a parse value differing in case', 'href="plain.xml" parse="XML"'],
    ['accept outside printable ASCII', 'href="plain.xml" accept="text/plain&#9;"'],
    ['accept-language outside printable ASCII', 'href="plain.xml" accept-language="fr-é"'],
  ])('rejects %s with XINCLUDE_ATTRIBUTE, even with a fallback', (_what, attributes) => {
    const main = `<r ${XI}><xi:include ${attributes}><xi:fallback/></xi:include></r>`;
    expect(failure(FILES, main)).toBe('XINCLUDE_ATTRIBUTE');
  });

  it('reports the attribute error at the xi:include', () => {
    const error = errorOf(() => read(FILES, `<r ${XI}>\n<xi:include href="a#b"/></r>`));
    expect([error.line, error.column]).toEqual([2, 1]);
  });
});

describe('inclusion loops (XInclude §4.2.7)', () => {
  it('rejects a document that includes itself', () => {
    expect(failure(FILES, `<r ${XI}><xi:include href="main.xml"/></r>`)).toBe('XINCLUDE_LOOP');
  });

  it('rejects a loop through other documents', () => {
    const files = {
      'file:///doc/a.xml': `<a ${XI}><xi:include href="b.xml"/></a>`,
      'file:///doc/b.xml': `<b ${XI}><xi:include href="a.xml"/></b>`,
    };
    expect(failure(files, `<r ${XI}><xi:include href="a.xml"/></r>`)).toBe('XINCLUDE_LOOP');
  });

  it('rejects a loop back to the including document through another one, whatever the pointer', () => {
    const files = { 'file:///doc/a.xml': `<a ${XI}><xi:include href="main.xml" xpointer="element(/1/2)"/></a>` };
    expect(failure(files, `<r ${XI}><xi:include href="a.xml"/><s/></r>`)).toBe('XINCLUDE_LOOP');
  });

  it('rejects a loop even when the xi:include has a fallback', () => {
    expect(failure(FILES, `<r ${XI}><xi:include href="main.xml"><xi:fallback/></xi:include></r>`)).toBe(
      'XINCLUDE_LOOP'
    );
  });

  it('rejects a loop the resolver reveals by the URI it answers with', () => {
    const files = { 'file:///doc/alias.xml': { text: `<a ${XI}><xi:include href="alias.xml"/></a>`, systemId: MAIN } };
    expect(failure(files, `<r ${XI}><xi:include href="alias.xml"/></r>`)).toBe('XINCLUDE_LOOP');
  });

  it('rejects an intra-document reference to an element holding it (§4.2.7)', () => {
    expect(failure(FILES, `<r ${XI}><s xml:id="s"><xi:include xpointer="s"/></s></r>`)).toBe('XINCLUDE_LOOP');
    expect(failure(FILES, `<r ${XI}><xi:include xpointer="element(/1)"/></r>`)).toBe('XINCLUDE_LOOP');
  });
});

describe('replacing the document element (XInclude §4.5)', () => {
  it('replaces it with an included document’s element, comments and PIs', () => {
    expect(plain(`<xi:include ${XI} href="part.xml"/>`)).toBe(
      '<!--c--><?pi data?><part xml:lang="fr"><p xml:id="a">AE</p><p>B</p></part><!--after-->'
    );
  });

  it('replaces it with the one element a pointer selects', () => {
    expect(plain(`<xi:include ${XI} href="part.xml" xpointer="a"/>`)).toBe('<p xml:id="a">AE</p>');
  });

  it('replaces it with a fallback holding one element, and comments, PIs and white space', () => {
    expect(
      plain(`<xi:include ${XI} href="missing.xml"><xi:fallback> <!--c--><f/><?p?> </xi:fallback></xi:include>`)
    ).toBe(`<!--c--><f ${XI}></f><?p ?>`);
  });

  it('reports a fallback’s white space around the new document element as the cursor reports the prolog’s', () => {
    const main = `<xi:include ${XI} href="missing.xml"><xi:fallback> <f> </f>\n<![CDATA[ ]]></xi:fallback></xi:include>`;
    const reader = factory(FILES, { options: { reportPrologWhitespace: true } }).createStreamReader({
      text: main,
      systemId: MAIN,
    });
    const seen: string[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next())
      seen.push(`${e}:${e === EventType.START_ELEMENT || e === EventType.END_ELEMENT ? '' : reader.text()}`);
    expect(seen).toEqual([
      `${EventType.SPACE}: `,
      `${EventType.START_ELEMENT}:`,
      `${EventType.CHARACTERS}: `,
      `${EventType.END_ELEMENT}:`,
      `${EventType.SPACE}:\n`,
      `${EventType.SPACE}: `,
    ]);
  });

  it('says the white space it reports as SPACE is white space, a CDATA section’s too (StAX isWhiteSpace)', () => {
    const main = `<xi:include ${XI} href="missing.xml"><xi:fallback> <f/><![CDATA[ ]]></xi:fallback></xi:include>`;
    const reader = factory(FILES, { options: { reportPrologWhitespace: true } }).createStreamReader({
      text: main,
      systemId: MAIN,
    });
    const seen: string[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next())
      if (e === EventType.SPACE) seen.push(`${JSON.stringify(reader.text())} ${reader.isWhitespace()}`);
    expect(seen).toEqual(['" " true', '" " true']);
  });

  it('reports an included document’s white space around its element only where it lies outside the document element', () => {
    const files = { ...FILES, 'file:///doc/spaced.xml': '<!--c-->\n<s/>\n' };
    const setup = { settings: { fixupBaseURIs: false }, options: { reportPrologWhitespace: true } };
    expect(read(files, `<r ${XI}><xi:include href="spaced.xml"/></r>`, setup)).toBe(`<r ${XI}><!--c--><s></s></r>`);
    expect(read(files, `<xi:include ${XI} href="spaced.xml"/>`, setup)).toBe('<!--c-->\n<s></s>\n');
  });

  it('gives SAX no character data outside the document element a fallback replaces it with', () => {
    const seen: string[] = [];
    new SAXParser(factory(FILES)).parse(
      {
        text: `<xi:include ${XI} href="missing.xml"><xi:fallback> <f> </f> </xi:fallback></xi:include>`,
        systemId: MAIN,
      },
      {
        startElement: (_uri, local) => seen.push(`<${local}>`),
        endElement: (_uri, local) => seen.push(`</${local}>`),
        characters: (text) => seen.push(`"${text}"`),
        ignorableWhitespace: (text) => seen.push(`ignorable "${text}"`),
      }
    );
    expect(seen).toEqual(['<f>', '" "', '</f>']);
  });

  it('replaces it with the fallback of a text inclusion whose resource is missing', () => {
    expect(
      plain(`<xi:include ${XI} href="missing.txt" parse="text"><xi:fallback><r/></xi:fallback></xi:include>`)
    ).toBe(`<r ${XI}></r>`);
  });

  it.each([
    ['text', `<xi:include ${XI} href="note.txt" parse="text"/>`],
    ['empty text', `<xi:include ${XI} href="empty.txt" parse="text"/>`],
    [
      'text that a fallback cannot replace',
      `<xi:include ${XI} href="note.txt" parse="text"><xi:fallback><f/></xi:fallback></xi:include>`,
    ],
    [
      'text in a CDATA section of a fallback',
      `<xi:include ${XI} href="missing.xml"><xi:fallback><![CDATA[t]]><f/></xi:fallback></xi:include>`,
    ],
    ['text in a fallback', `<xi:include ${XI} href="missing.xml"><xi:fallback>t<f/></xi:fallback></xi:include>`],
    [
      'two elements of a fallback',
      `<xi:include ${XI} href="missing.xml"><xi:fallback><f/><g/></xi:fallback></xi:include>`,
    ],
    ['an empty fallback', `<xi:include ${XI} href="missing.xml"><xi:fallback/></xi:include>`],
  ])('rejects replacing it with %s, with XINCLUDE_ROOT', (_what, main) => {
    expect(failure(FILES, main)).toBe('XINCLUDE_ROOT');
  });

  it('rejects replacing it with two elements of nested inclusions', () => {
    const files = {
      ...FILES,
      'file:///doc/two.xml': `<xi:include ${XI} href="missing.xml"><xi:fallback><f/><g/></xi:fallback></xi:include>`,
    };
    expect(failure(files, `<r ${XI}><xi:include href="two.xml"/></r>`)).toBe('XINCLUDE_ROOT');
  });

  it('rejects replacing it with two elements of a fallback an intra-document reference selects', () => {
    const inner = '<xi:include xml:id="two" href="missing.xml"><xi:fallback><f/><g/></xi:fallback></xi:include>';
    const main = `<xi:include ${XI} xpointer="two"><xi:fallback>${inner}</xi:fallback></xi:include>`;
    expect(errorOf(() => read(FILES, main))).toMatchObject({
      code: 'XINCLUDE_ROOT',
      message: expect.stringContaining('The document element must be replaced with exactly one element'),
    });
  });
});

describe('entities in content an xi:include ignores (XInclude §3.1)', () => {
  it('reports the expansions of the content the result keeps, and not those of what it ignores', () => {
    const dtd = '<!DOCTYPE r [<!ENTITY e "<b/>"><!ENTITY f "<c/>">]>';
    const ignored = '<xi:include href="plain.xml">&e;</xi:include>';
    const fallback = '<xi:include href="missing.xml"><xi:fallback>&f;</xi:fallback></xi:include>';
    const seen: string[] = [];
    new SAXParser(factory(FILES)).parse(
      { text: `${dtd}<r ${XI}>${ignored}${fallback}</r>`, systemId: MAIN },
      {
        startElement: (_uri, local) => seen.push(`<${local}>`),
        startEntity: (name) => seen.push(`start ${name}`),
        endEntity: (name) => seen.push(`end ${name}`),
      }
    );
    expect(seen).toEqual(['<r>', '<plain>', 'start f', '<c>', 'end f']);
  });
});

describe('XIncludeReader', () => {
  it.each([
    ['a resource error', `<r ${XI}><xi:include href="missing.xml"/>after<a/></r>`, 'XINCLUDE_RESOURCE'],
    [
      'a pointer that identifies nothing',
      `<r ${XI}><xi:include href="plain.xml" xpointer="nope"/>after</r>`,
      'XINCLUDE_POINTER',
    ],
    ['a bad parse attribute', `<r ${XI}><xi:include href="plain.xml" parse="bogus"/>after</r>`, 'XINCLUDE_ATTRIBUTE'],
  ])('ends the document at %s, throwing it again on every later call (§1.2)', (_, main, code) => {
    const reader = factory(FILES).createStreamReader({ text: main, systemId: MAIN });
    const error = errorOf(() => {
      while (reader.next() !== EventType.END_DOCUMENT);
    });
    expect(error.code).toBe(code);
    expect(errorOf(() => reader.next())).toBe(error);
    expect(errorOf(() => reader.next())).toBe(error);
  });

  it('needs a namespace-aware reader', () => {
    const factory = new XMLInputFactory({ xinclude: xincludeProcessor(), namespaceAware: false });
    expect(() => factory.createStreamReader('<r/>')).toThrow(TypeError);
  });

  it('reads documents without xi:include as any reader does', () => {
    expect(plain('<?xml version="1.0"?><!DOCTYPE r><r a="1"><!--c--><s>t</s></r>')).toBe(
      '<r a="1"><!--c--><s>t</s></r>'
    );
  });

  it('can be closed in the middle of an inclusion', () => {
    const reader = factory(FILES).createStreamReader({
      text: `<r ${XI}><xi:include href="part.xml"/></r>`,
      systemId: MAIN,
    });
    while (reader.next() !== EventType.START_ELEMENT || reader.localName() !== 'part');
    expect(() => reader.close()).not.toThrow();
  });
});
