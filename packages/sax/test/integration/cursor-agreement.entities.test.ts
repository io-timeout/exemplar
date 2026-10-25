import { readEveryWay, utf16 } from '@test/helpers/agreement.ts';
import { describe, expect, it } from 'vitest';
import type { EntityResolver, InputOptions } from '@exemplarjs/xml';
import { accessAllows, accessRefusedError } from '@exemplarjs/xml/internal';

const BASE = 'http://example.org/docs/';

/** The external files the documents below read. */
const FILES: Readonly<Record<string, string | Uint8Array>> = {
  [`${BASE}ext.xml`]: '<?xml encoding="UTF-8"?><b>external</b>',
  [`${BASE}text.ent`]: 'plain text',
  [`${BASE}sub/outer.xml`]: '<o>&inner;</o>',
  [`${BASE}sub/inner.xml`]: '<i>from sub</i>',
  [`${BASE}utf16.xml`]: utf16('<?xml encoding="UTF-16"?><w>wide é</w>', true),
  [`${BASE}v11.xml`]: '<?xml version="1.1" encoding="UTF-8"?><n>a\u0085b</n>',
  [`${BASE}a.dtd`]:
    '<?xml version="1.0" encoding="UTF-8"?><!ENTITY e "from the DTD"><!ATTLIST a x CDATA "dflt"><!ENTITY % p SYSTEM "p.ent">%p;<![INCLUDE[<!ENTITY inc "included">]]><![IGNORE[<!ENTITY inc "ignored">]]>',
  [`${BASE}p.ent`]: '<!ENTITY f "from a parameter entity">',
  [`${BASE}sub.dtd`]: '<!ENTITY inner SYSTEM "sub/inner.xml"><!ENTITY outer SYSTEM "sub/outer.xml">',
};

/** A resolver serving the files above by absolute URI, keeping to the access list as the bundled resolvers do. */
const RESOLVER: EntityResolver = {
  resolveEntity(request) {
    const uri = new URL(request.systemId ?? '', request.baseURI).href;
    if (request.access !== undefined && !accessAllows(request.access, uri)) throw accessRefusedError(uri);
    const found = FILES[uri];
    if (found === undefined) return undefined;
    return typeof found === 'string' ? { systemId: uri, text: found } : { systemId: uri, bytes: found };
  },
};

/** Options that read every external DTD and entity through the resolver. */
const ALL: InputOptions = { entityResolver: RESOLVER, accessExternalDTD: 'all', accessExternalEntities: 'all' };

/** A document at the base URI. */
function doc(xml: string): { xml: string; systemId: string } {
  return { xml, systemId: `${BASE}doc.xml` };
}

describe('SAX agrees with the cursor on external entities read through a resolver (§4.2.2, §4.4.3)', () => {
  it.each([
    [
      'an external parsed entity with a text declaration',
      '<!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>',
      '<a><b>external</b></a>',
    ],
    [
      'an external entity of text alone',
      '<!DOCTYPE a [<!ENTITY t SYSTEM "text.ent">]><a>[&t;]</a>',
      '<a>[plain text]</a>',
    ],
    [
      'an external entity used twice',
      '<!DOCTYPE a [<!ENTITY t SYSTEM "text.ent">]><a>&t;|&t;</a>',
      '<a>plain text|plain text</a>',
    ],
    ['an external entity in UTF-16', '<!DOCTYPE a [<!ENTITY w SYSTEM "utf16.xml">]><a>&w;</a>', '<a><w>wide é</w></a>'],
    [
      'the external subset, its parameter entities and conditional sections (§3.4)',
      '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;|&f;|&inc;</a>',
      '<a x="dflt">from the DTD|from a parameter entity|included</a>',
    ],
    [
      'the internal subset binding before the external one (§2.8)',
      '<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY e "internal"><!ATTLIST a x CDATA "mine">]><a>&e;</a>',
      '<a x="mine">internal</a>',
    ],
    [
      'an entity from the external subset in an attribute',
      '<!DOCTYPE a SYSTEM "a.dtd"><a y="&e;"/>',
      '<a x="dflt" y="from the DTD"></a>',
    ],
    [
      'relative system ids resolved against the entity that declares them',
      '<!DOCTYPE a SYSTEM "sub.dtd"><a>&outer;</a>',
      '<a><o><i>from sub</i></o></a>',
    ],
    [
      'an external parameter entity in the internal subset',
      '<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent">%p;]><a>&f;</a>',
      '<a>from a parameter entity</a>',
    ],
  ])('%s', async (_title, xml, expected) => {
    expect(await readEveryWay(doc(xml), ALL)).toBe(expected);
  });

  it('reads an XML 1.1 entity in an XML 1.1 document, with its own line ends (§4.3.4)', async () => {
    const xml = '<?xml version="1.1"?><!DOCTYPE a [<!ENTITY n SYSTEM "v11.xml">]><a>&n;</a>';
    expect(await readEveryWay(doc(xml), ALL)).toBe('<a><n>a&#10;b</n></a>');
  });

  it('skips what the access lists do not allow, reporting each refusal as an error', async () => {
    const xml = '<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY x SYSTEM "ext.xml">]><a>&x;&e;</a>';
    const refused = new Set<string>();
    const errorHandler = { error: (e: { code: string }) => void refused.add(e.code) };
    expect(await readEveryWay(doc(xml), { entityResolver: RESOLVER, errorHandler })).toBe('<a></a>');
    expect([...refused]).toEqual(['ACCESS_REFUSED']);
  });

  it('skips external general entities with supportExternalEntities off', async () => {
    const xml = '<!DOCTYPE a [<!ENTITY x SYSTEM "ext.xml">]><a>&x;</a>';
    expect(await readEveryWay(doc(xml), { ...ALL, supportExternalEntities: false })).toBe('<a></a>');
  });

  it('takes an external subset a resolver offers for a document that names none', async () => {
    const offering: EntityResolver = {
      resolveEntity: () => undefined,
      getExternalSubset: ({ name }) => (name === 'a' ? { text: '<!ENTITY e "offered">' } : undefined),
    };
    expect(await readEveryWay('<!DOCTYPE a><a>&e;</a>', { entityResolver: offering })).toBe('<a>offered</a>');
  });
});
