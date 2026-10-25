import { describe, expect, it } from 'vitest';
import { DocumentBuilder } from '@exemplarjs/dom';
import { xincludeProcessor } from '@exemplarjs/xinclude';
import { XMLInputFactory } from '@exemplarjs/xml';
import { catalogResolver } from '@/index.ts';

// The default reader reads catalog files from the file system, so these tests run on Node only.
const CATALOG = new URL('../fixtures/catalogs/catalog.xml', import.meta.url).href;

/** A factory reading through the fixtures' catalog with the default reader, file: access only. */
function withCatalog(defer = true): XMLInputFactory {
  return new XMLInputFactory({
    catalog: catalogResolver({ files: [CATALOG], defer }),
    xinclude: xincludeProcessor({ fixupBaseURIs: false }),
    accessExternalDTD: ['file'],
    accessExternalEntities: ['file'],
  });
}

describe('catalog files on the file system', () => {
  it.each([true, false])('maps a DTD by public identifier, and an entity through nextCatalog (defer: %s)', (defer) => {
    const xml = '<!DOCTYPE doc PUBLIC "-//EX//DTD Doc V1//EN" "http://example.com/doc.dtd"><doc>&greeting; &ext;</doc>';
    const doc = new DocumentBuilder(withCatalog(defer)).parse({ text: xml, systemId: 'http://example.com/main.xml' });
    expect(doc.documentElement?.textContent).toBe('hello from a file external');
  });

  it('maps a DTD through a delegated catalog', () => {
    const xml = '<!DOCTYPE doc SYSTEM "http://example.com/delegated/x/other.dtd"><doc>&other;</doc>';
    const doc = new DocumentBuilder(withCatalog()).parse({ text: xml, systemId: 'http://example.com/main.xml' });
    expect(doc.documentElement?.textContent).toBe('other DTD');
  });

  it('maps an XInclude target through a rewriteURI entry', () => {
    const xml =
      '<doc xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="http://example.com/parts/part.xml"/></doc>';
    const doc = new DocumentBuilder(withCatalog()).parse({ text: xml, systemId: 'http://example.com/main.xml' });
    expect(doc.documentElement?.textContent).toBe('from a file');
  });

  it('reads the files it maps to with the default reader', () => {
    const c = catalogResolver({ files: [CATALOG] });
    const mapped = c.matchURI('http://example.com/parts/part.xml');
    expect(mapped).toBe(new URL('parts/part.xml', CATALOG).href);
    expect(new TextDecoder().decode(c.read(mapped as string)?.bytes)).toBe('<part>from a file</part>\n');
    expect(c.read(new URL('parts/missing.xml', CATALOG).href)).toBeUndefined();
  });
});
