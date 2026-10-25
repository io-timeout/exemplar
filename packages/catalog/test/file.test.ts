import { describe, expect, it } from 'vitest';
import { type CatalogFile, readCatalogFile } from '@/file.ts';

const NS = 'xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog"';
const URI = 'file:///c/catalog.xml';

/** The file a catalog of the given entries gives, read with public identifiers preferred unless asked otherwise. */
function read(entries: string, preferPublic = true, attributes = ''): CatalogFile {
  const file = readCatalogFile(
    { text: `<catalog ${NS} ${attributes}>${entries}</catalog>`, systemId: URI },
    URI,
    preferPublic
  );
  if (file === undefined) throw new Error('Not read as a catalog');
  return file;
}

/** A catalog file's entries as plain data, leaving out the kinds that are empty. */
function entries(file: CatalogFile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [kind, value] of Object.entries(file)) {
    const plain = value instanceof Map ? Object.fromEntries(value) : value;
    if ((value instanceof Map ? value.size : (value as unknown[]).length) > 0) out[kind] = plain;
  }
  return out;
}

describe('readCatalogFile: entry types (§6.5)', () => {
  it.each([
    [
      'public',
      '<public publicId=" -//A//DTD  One//EN " uri="one.dtd"/>',
      {
        publicAny: { '-//A//DTD One//EN': 'file:///c/one.dtd' },
        publicPreferred: { '-//A//DTD One//EN': 'file:///c/one.dtd' },
      },
    ],
    [
      'system',
      '<system systemId="http://x/a b.dtd" uri="a.dtd"/>',
      { system: { 'http://x/a%20b.dtd': 'file:///c/a.dtd' } },
    ],
    [
      'rewriteSystem',
      '<rewriteSystem systemIdStartString="http://x/ é/" rewritePrefix="local/"/>',
      {
        rewriteSystem: [{ startString: 'http://x/%20%C3%A9/', rewritePrefix: 'file:///c/local/' }],
      },
    ],
    [
      'systemSuffix',
      '<systemSuffix systemIdSuffix="a b.dtd" uri="a.dtd"/>',
      { systemSuffix: [{ suffix: 'a%20b.dtd', uri: 'file:///c/a.dtd' }] },
    ],
    [
      'delegatePublic',
      '<delegatePublic publicIdStartString="-//A  B//" catalog="d.xml"/>',
      {
        delegatePublic: [{ startString: '-//A B//', catalog: 'file:///c/d.xml', preferPublic: true }],
      },
    ],
    [
      'delegateSystem',
      '<delegateSystem systemIdStartString="http://x/ y/" catalog="d.xml"/>',
      {
        delegateSystem: [{ startString: 'http://x/%20y/', catalog: 'file:///c/d.xml', preferPublic: true }],
      },
    ],
    ['uri', '<uri name="http://x/u v.xml" uri="u.xml"/>', { uri: { 'http://x/u%20v.xml': 'file:///c/u.xml' } }],
    [
      'rewriteURI',
      '<rewriteURI uriStartString="http://x/r/" rewritePrefix="http://mirror/r/"/>',
      {
        rewriteURI: [{ startString: 'http://x/r/', rewritePrefix: 'http://mirror/r/' }],
      },
    ],
    [
      'uriSuffix',
      '<uriSuffix uriSuffix="/s.xml" uri="s.xml"/>',
      { uriSuffix: [{ suffix: '/s.xml', uri: 'file:///c/s.xml' }] },
    ],
    [
      'delegateURI',
      '<delegateURI uriStartString="http://d/" catalog="../d.xml"/>',
      {
        delegateURI: [{ startString: 'http://d/', catalog: 'file:///d.xml', preferPublic: true }],
      },
    ],
    [
      'nextCatalog',
      '<nextCatalog catalog="next.xml"/><nextCatalog catalog="http://x/n.xml"/>',
      { nextCatalogs: ['file:///c/next.xml', 'http://x/n.xml'] },
    ],
  ])('records a %s entry, normalized, with its URI made absolute', (_kind, xml, expected) => {
    expect(entries(read(xml))).toEqual(expected);
  });

  it('keeps the first system, public and uri entry for an identifier (§6.5)', () => {
    const file = read(
      '<system systemId="http://x/a" uri="first"/><system systemId="http://x/a" uri="second"/>' +
        '<public publicId="-//A//EN" uri="first"/><public publicId="-//A//EN" uri="second"/>' +
        '<uri name="http://x/u" uri="first"/><uri name="http://x/u" uri="second"/>'
    );
    expect([file.system.get('http://x/a'), file.publicAny.get('-//A//EN'), file.uri.get('http://x/u')]).toEqual([
      'file:///c/first',
      'file:///c/first',
      'file:///c/first',
    ]);
  });

  it('keeps every rewrite, suffix and delegate entry in document order', () => {
    const file = read('<uriSuffix uriSuffix="b" uri="1"/><uriSuffix uriSuffix="b" uri="2"/>');
    expect(file.uriSuffix.map((entry) => entry.uri)).toEqual(['file:///c/1', 'file:///c/2']);
  });

  it.each([
    '<public uri="x"/>',
    '<public publicId="-//A//EN"/>',
    '<system uri="x"/>',
    '<system systemId="http://x/a"/>',
    '<rewriteSystem rewritePrefix="x"/>',
    '<rewriteSystem systemIdStartString="http://x/"/>',
    '<systemSuffix uri="x"/>',
    '<systemSuffix systemIdSuffix="a"/>',
    '<delegatePublic catalog="x"/>',
    '<delegatePublic publicIdStartString="-//A"/>',
    '<delegateSystem catalog="x"/>',
    '<delegateSystem systemIdStartString="http://x/"/>',
    '<uri uri="x"/>',
    '<uri name="http://x/a"/>',
    '<rewriteURI rewritePrefix="x"/>',
    '<rewriteURI uriStartString="http://x/"/>',
    '<uriSuffix uri="x"/>',
    '<uriSuffix uriSuffix="a"/>',
    '<delegateURI catalog="x"/>',
    '<delegateURI uriStartString="http://x/"/>',
    '<nextCatalog/>',
  ])('ignores %s, which lacks a required attribute', (xml) => {
    expect(entries(read(xml))).toEqual({});
  });
});

describe('readCatalogFile: prefer (§4.1.1)', () => {
  it('records public entries as preferred under prefer="public"', () => {
    const file = read('<public publicId="-//A//EN" uri="a"/>');
    expect([file.publicAny.has('-//A//EN'), file.publicPreferred.has('-//A//EN')]).toEqual([true, true]);
  });

  it('records them for public identifiers alone under prefer="system"', () => {
    const file = read('<public publicId="-//A//EN" uri="a"/>', false);
    expect([file.publicAny.has('-//A//EN'), file.publicPreferred.has('-//A//EN')]).toEqual([true, false]);
  });

  it('takes prefer from the catalog element, then the group, over the resolver’s setting', () => {
    const file = read(
      '<public publicId="-//C//EN" uri="c"/><group prefer="public"><public publicId="-//G//EN" uri="g"/>' +
        '<delegatePublic publicIdStartString="-//D" catalog="d.xml"/></group>',
      true,
      'prefer="system"'
    );
    expect([...file.publicPreferred.keys()]).toEqual(['-//G//EN']);
    expect(file.delegatePublic.map((entry) => entry.preferPublic)).toEqual([true]);
    const system = read('<group prefer="system"><delegatePublic publicIdStartString="-//D" catalog="d.xml"/></group>');
    expect(system.delegatePublic.map((entry) => entry.preferPublic)).toEqual([false]);
  });

  it('inherits the setting in force for any other prefer value', () => {
    const file = read('<group prefer="neither"><public publicId="-//A//EN" uri="a"/></group>', false);
    expect(file.publicPreferred.size).toBe(0);
  });

  it('goes back to the outer setting after a group', () => {
    const file = read('<group prefer="system"/><public publicId="-//A//EN" uri="a"/>');
    expect(file.publicPreferred.size).toBe(1);
  });
});

describe('readCatalogFile: xml:base (§6.1)', () => {
  it('makes URIs absolute against the xml:base of the catalog, a group or the entry itself', () => {
    const file = read(
      '<system systemId="http://x/1" uri="1.dtd"/><group xml:base="http://mirror/g/"><system systemId="http://x/2" uri="2.dtd"/>' +
        '<system systemId="http://x/3" uri="3.dtd" xml:base="../e/"/></group><system systemId="http://x/4" uri="4.dtd"/>',
      true,
      'xml:base="http://mirror/c/"'
    );
    expect(Object.fromEntries(file.system)).toEqual({
      'http://x/1': 'http://mirror/c/1.dtd',
      'http://x/2': 'http://mirror/g/2.dtd',
      'http://x/3': 'http://mirror/e/3.dtd',
      'http://x/4': 'http://mirror/c/4.dtd',
    });
  });

  it('escapes an xml:base before resolving it', () => {
    expect(
      read('<system systemId="http://x/1" uri="1.dtd"/>', true, 'xml:base="dir with space/"').system.get('http://x/1')
    ).toBe('file:///c/dir%20with%20space/1.dtd');
  });

  it('takes the URI the source gives as the catalog’s base', () => {
    const file = readCatalogFile(
      {
        text: `<catalog ${NS}><system systemId="http://x/a" uri="a.dtd"/></catalog>`,
        systemId: 'http://moved/catalog.xml',
      },
      URI,
      true
    );
    expect(file?.system.get('http://x/a')).toBe('http://moved/a.dtd');
    const unnamed = readCatalogFile(
      { text: `<catalog ${NS}><system systemId="http://x/a" uri="a.dtd"/></catalog>` },
      URI,
      true
    );
    expect(unnamed?.system.get('http://x/a')).toBe('file:///c/a.dtd');
  });

  it('keeps the base in force when an xml:base is not a URI it can resolve', () => {
    expect(
      read('<system systemId="http://x/a" uri="a.dtd"/>', true, 'xml:base="http://[bad/"').system.get('http://x/a')
    ).toBe('file:///c/a.dtd');
  });

  it('drops an entry whose URI cannot be made absolute', () => {
    expect(
      entries(read('<system systemId="http://x/a" uri="http://[bad/a.dtd"/><nextCatalog catalog="http://[bad/"/>'))
    ).toEqual({});
  });
});

describe('readCatalogFile: what is ignored (§6, §8)', () => {
  it('ignores elements in other namespaces, with all they hold, but not what follows them', () => {
    const file = read(
      `<ext xmlns="urn:other"><system ${NS} systemId="http://x/in" uri="in"/></ext>` +
        `<o:system xmlns:o="urn:other" systemId="http://x/o" uri="o"/><system systemId="http://x/after" uri="after"/>`
    );
    expect([...file.system.keys()]).toEqual(['http://x/after']);
  });

  it.each([
    ['an unknown element', '<future><system systemId="http://x/in" uri="in"/></future>'],
    ['a nested catalog element', '<catalog><system systemId="http://x/in" uri="in"/></catalog>'],
    [
      'an element named for an Object property',
      '<toString/><constructor><system systemId="http://x/in" uri="in"/></constructor>',
    ],
    ['an entry inside an entry', '<uri name="http://x/u" uri="u"><system systemId="http://x/in" uri="in"/></uri>'],
  ])('ignores %s in the catalog namespace, with all it holds', (_what, xml) => {
    expect(read(`${xml}<system systemId="http://x/after" uri="after"/>`).system.has('http://x/in')).toBe(false);
    expect(read(`${xml}<system systemId="http://x/after" uri="after"/>`).system.has('http://x/after')).toBe(true);
  });

  it('reads groups nested in groups', () => {
    const file = read(
      '<group xml:base="http://a/"><group xml:base="b/"><system systemId="http://x/n" uri="n"/></group></group>'
    );
    expect(file.system.get('http://x/n')).toBe('http://a/b/n');
  });

  it('reads a catalog with the OASIS DOCTYPE without fetching the DTD, and with comments and PIs', () => {
    const doctype =
      '<!DOCTYPE catalog PUBLIC "-//OASIS//DTD XML Catalogs V1.1//EN" "http://www.oasis-open.org/committees/entity/release/1.1/catalog.dtd">';
    const text = `${doctype}<?pi?><!--c--><catalog ${NS}><!--c--><system systemId="http://x/a" uri="a"/></catalog>`;
    expect(readCatalogFile({ text, systemId: URI }, URI, true)?.system.get('http://x/a')).toBe('file:///c/a');
  });

  it('reads a catalog despite a warning, such as an encoding from outside that conflicts with its declaration', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?><catalog ${NS}><system systemId="http://x/a" uri="a"/></catalog>`;
    const source = { bytes: new TextEncoder().encode(text), encoding: 'ISO-8859-1' };
    expect(readCatalogFile(source, URI, true)?.system.get('http://x/a')).toBe('file:///c/a');
  });

  it('reads a catalog despite validity errors, such as an xml:id used twice', () => {
    const text = `<catalog ${NS}><group xml:id="g"/><group xml:id="g"/><system systemId="http://x/a" uri="a"/></catalog>`;
    expect(readCatalogFile({ text }, URI, true)?.system.size).toBe(1);
  });

  it.each([
    ['a document element other than catalog', `<group ${NS}><system systemId="http://x/a" uri="a"/></group>`],
    ['a catalog element in no namespace', '<catalog><system systemId="http://x/a" uri="a"/></catalog>'],
    ['a catalog element in another namespace', '<catalog xmlns="urn:other"/>'],
    ['a document that is not well-formed', `<catalog ${NS}><system systemId="http://x/a" uri="a"></catalog>`],
    ['text that is not XML', 'not XML at all'],
    ['bytes that are not UTF-8', new Uint8Array([0x3c, 0x63, 0xff, 0x2f, 0x3e])],
  ])('gives undefined for %s, which is no catalog', (_what, content) => {
    const source = typeof content === 'string' ? { text: content } : { bytes: content };
    expect(readCatalogFile(source, URI, true)).toBeUndefined();
  });

  it('reads an empty catalog as one with no entries', () => {
    expect(entries(read(''))).toEqual({});
  });
});
