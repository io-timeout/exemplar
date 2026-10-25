import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { type Locator, SAXParser, type SAXHandler } from '@/index.ts';

/** A handler that notes, at each element start and end, the locator's line and column. */
function positions(): { handler: SAXHandler; seen: string[] } {
  const seen: string[] = [];
  let locator: Locator | undefined;
  const at = (what: string) => seen.push(`${what} ${locator?.lineNumber}:${locator?.columnNumber}`);
  return {
    seen,
    handler: {
      setDocumentLocator: (l) => {
        locator = l;
      },
      startElement: (_uri, _localName, qName) => at(qName),
      endElement: (_uri, _localName, qName) => at(`/${qName}`),
      characters: (text) => at(JSON.stringify(text)),
      endDocument: () => at('end'),
    },
  };
}

/** Reads the locator's identifiers at the root element's start. */
function identifiers(source: Parameters<SAXParser['parse']>[0]): Omit<Locator, 'lineNumber' | 'columnNumber'> {
  let locator: Locator | undefined;
  let found: Omit<Locator, 'lineNumber' | 'columnNumber'> | undefined;
  new SAXParser().parse(source, {
    setDocumentLocator: (l) => {
      locator = l;
    },
    startElement: () => {
      const l = locator as Locator;
      found = { systemId: l.systemId, publicId: l.publicId, xmlVersion: l.xmlVersion, encoding: l.encoding };
    },
  });
  return found as Omit<Locator, 'lineNumber' | 'columnNumber'>;
}

describe('the SAX locator (Locator2)', () => {
  it('is given before startDocument', () => {
    const order: string[] = [];
    new SAXParser().parse('<a/>', {
      setDocumentLocator: () => order.push('setDocumentLocator'),
      startDocument: () => order.push('startDocument'),
    });
    expect(order).toEqual(['setDocumentLocator', 'startDocument']);
  });

  it('gives where each event starts, with CR, LF and CRLF each ending a line (§2.11)', () => {
    const { handler, seen } = positions();
    new SAXParser().parse('<r a="1"\r\n b="2">\r  <c/>\n</r>', handler);
    expect(seen).toEqual([
      'r 1:1',
      String.raw`"\n  " 2:8`,
      'c 3:3',
      '/c 3:3',
      String.raw`"\n" 3:7`,
      '/r 4:1',
      'end 4:5',
    ]);
  });

  it('gives an empty element the same position at its start and its end', () => {
    const { handler, seen } = positions();
    new SAXParser().parse('<a>\n  <b x="1"/></a>', handler);
    expect(seen.slice(2, 4)).toEqual(['b 2:3', '/b 2:3']);
  });

  it('counts columns in UTF-16 code units, as JavaScript strings do', () => {
    const { handler, seen } = positions();
    new SAXParser().parse('<a>\u{10000}<b/></a>', handler);
    expect(seen.slice(1, 3)).toEqual(['"\u{10000}" 1:4', 'b 1:6']);
  });

  it('counts NEL and LS as line ends in an XML 1.1 document (XML 1.1 §2.11)', () => {
    const { handler, seen } = positions();
    new SAXParser().parse('<?xml version="1.1"?><a>\u0085<b/>\u2028<c/></a>', handler);
    expect(seen.filter((s) => !s.startsWith('"'))).toEqual([
      'a 1:22',
      'b 2:1',
      '/b 2:1',
      'c 3:1',
      '/c 3:1',
      '/a 3:5',
      'end 3:9',
    ]);
  });

  it('gives the same positions when the document arrives in chunks', async () => {
    const xml = '<r>\n  <a x="1">text</a>\n  <b/>\n</r>';
    const whole = positions();
    new SAXParser().parse(xml, whole.handler);
    const fed = positions();
    const bytes = new TextEncoder().encode(xml);
    const chunks = async function* () {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
    };
    await new SAXParser().parseAsync(chunks(), fed.handler);
    expect(fed.seen).toEqual(whole.seen);
  });

  it('gives the declared version and encoding when the declaration arrives split', async () => {
    const bytes = new TextEncoder().encode('<?xml version="1.1" encoding="UTF-8" standalone="yes"?><a/>');
    const seen: string[] = [];
    let locator: Locator | undefined;
    const chunks = async function* () {
      yield bytes.subarray(0, 24);
      yield bytes.subarray(24);
    };
    await new SAXParser().parseAsync(chunks(), {
      setDocumentLocator: (l) => {
        locator = l;
      },
      startElement: () => seen.push(`${locator?.xmlVersion} ${locator?.encoding?.toUpperCase()}`),
    });
    expect(seen).toEqual(['1.1 UTF-8']);
  });

  it('gives the system and public ids the source carries', () => {
    expect(identifiers({ systemId: 'file:///d/doc.xml', publicId: '-//D//EN', text: '<a/>' })).toEqual({
      systemId: 'file:///d/doc.xml',
      publicId: '-//D//EN',
      xmlVersion: '1.0',
      encoding: undefined,
    });
  });

  it('gives no ids for a source without them', () => {
    expect(identifiers('<a/>')).toMatchObject({ systemId: undefined, publicId: undefined });
    expect(identifiers(new TextEncoder().encode('<a/>'))).toMatchObject({ systemId: undefined, publicId: undefined });
  });

  it("gives an external entity's system id while its content is read", () => {
    let locator: Locator | undefined;
    const ids: (string | undefined)[] = [];
    const factory = new XMLInputFactory({
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'http://example.org/e.xml', text: '<b/>' }) },
    });
    new SAXParser(factory).parse(
      { systemId: 'http://example.org/d.xml', text: '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;<c/></a>' },
      {
        setDocumentLocator: (l) => {
          locator = l;
        },
        startElement: () => ids.push(locator?.systemId),
      }
    );
    expect(ids).toEqual(['http://example.org/d.xml', 'http://example.org/e.xml', 'http://example.org/d.xml']);
  });

  it.each([
    ['no XML declaration', '<a/>', '1.0'],
    ['version 1.0', '<?xml version="1.0"?><a/>', '1.0'],
    ['version 1.1', '<?xml version="1.1"?><a/>', '1.1'],
  ])('gives the XML version for %s', (_case, xml, version) => {
    expect(identifiers(xml).xmlVersion).toBe(version);
  });

  it('gives the encoding the declaration names, or the one detected from bytes', () => {
    expect(identifiers('<?xml version="1.0" encoding="ISO-8859-1"?><a/>').encoding).toBe('ISO-8859-1');
    expect(identifiers('<a/>').encoding).toBeUndefined();
    expect(identifiers(new TextEncoder().encode('<a/>')).encoding?.toUpperCase()).toBe('UTF-8');
    const utf16 = new Uint8Array([0xfe, 0xff, 0, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e]);
    expect(identifiers(utf16).encoding?.toUpperCase()).toBe('UTF-16BE');
  });
});

describe('the SAX locator during an error', () => {
  /** Where the locator is when each error method is called, and where the error says it is, read whole and in chunks. */
  async function atErrors(xml: string): Promise<string[]> {
    const factory = new XMLInputFactory();
    const ways: string[][] = [];
    const bytes = new TextEncoder().encode(xml);
    // eslint-disable-next-line require-await -- an async source, so the parser takes its asynchronous path
    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1);
    }
    for (const parse of [
      (h: SAXHandler) =>
        new Promise<void>((resolve) => {
          new SAXParser(factory).parse(bytes, h);
          resolve();
        }),
      (h: SAXHandler) => new SAXParser(factory).parseAsync(chunks(), h),
    ]) {
      const seen: string[] = [];
      let locator: Locator | undefined;
      const at = (what: string) => (e: { line: number; column: number }) =>
        seen.push(`${what} ${locator?.lineNumber}:${locator?.columnNumber} ${e.line}:${e.column}`);
      await parse({
        setDocumentLocator: (l) => {
          locator = l;
        },
        error: at('error'),
        fatalError: at('fatalError'),
      }).catch(() => undefined);
      ways.push(seen);
    }
    expect(ways[1]).toEqual(ways[0]);
    return ways[0] as string[];
  }

  it.each([
    ['a malformed comment', '<r><!-- -- --></r>', 'fatalError 1:9 1:9'],
    ['a duplicate attribute', '<r>text<a b="1" b="2"/></r>', 'fatalError 1:17 1:17'],
    ['a mismatched end tag', '<r><a></b></r>', 'fatalError 1:9 1:9'],
  ])('gives where %s is, as the error does', async (_, xml, expected) => {
    expect(await atErrors(xml)).toEqual([expected]);
  });

  it('gives where a recoverable error is', async () => {
    expect(await atErrors('<!DOCTYPE r [<!ENTITY % p SYSTEM "p.ent">%p;]>\n<r a="&u;"/>')).toEqual(['error 2:7 2:7']);
  });
});
