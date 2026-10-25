import { memoryReader } from '@test/helpers/catalog.ts';
import { describe, expect, it } from 'vitest';
import { CATALOG_NAMESPACE, CatalogResolver, catalogResolver } from '@/index.ts';

const NS = 'xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog"';
const FILES = {
  'file:///c/catalog.xml': `<catalog ${NS}><public publicId="-//P//EN" uri="p.dtd"/><nextCatalog catalog="next.xml"/></catalog>`,
  'file:///c/next.xml': `<catalog ${NS}/>`,
};

describe('catalogResolver', () => {
  it('makes a CatalogResolver', () => {
    expect(catalogResolver({ files: [] })).toBeInstanceOf(CatalogResolver);
  });

  it('exports the catalog namespace', () => {
    expect(CATALOG_NAMESPACE).toBe('urn:oasis:names:tc:entity:xmlns:xml:catalog');
  });

  it.each(['catalog.xml', '/etc/xml/catalog', './c.xml', ''])(
    'rejects the catalog file %j, which is not an absolute URI',
    (uri) => {
      expect(() => catalogResolver({ files: ['file:///c/catalog.xml', uri] })).toThrow(TypeError);
    }
  );

  it('rejects a prefer setting other than public or system', () => {
    expect(() => catalogResolver({ files: [], prefer: 'both' as 'public' })).toThrow(TypeError);
  });

  it('rejects a resolve setting other than strict, continue or ignore', () => {
    expect(() => catalogResolver({ files: [], resolve: 'lenient' as 'strict' })).toThrow(TypeError);
  });

  it('fails when nothing matches by default, as resolve is strict', () => {
    const c = catalogResolver({ files: [] });
    expect(c.resolution).toBe('strict');
    expect(() => c.resolveEntity({ name: 'e', systemId: 'http://x/e' })).toThrow(
      expect.objectContaining({ code: 'CATALOG_NO_MATCH' })
    );
  });

  it.each(['strict', 'continue', 'ignore'] as const)('takes resolve: %s', (resolve) => {
    expect(catalogResolver({ files: [], resolve }).resolution).toBe(resolve);
  });

  it('prefers public identifiers by default, and system ones when told to', () => {
    const { read } = memoryReader(FILES);
    expect(catalogResolver({ files: ['file:///c/catalog.xml'], read }).matchEntity('-//P//EN', 'http://x/p.dtd')).toBe(
      'file:///c/p.dtd'
    );
    const system = catalogResolver({ files: ['file:///c/catalog.xml'], read, prefer: 'system' });
    expect(system.matchEntity('-//P//EN', 'http://x/p.dtd')).toBeUndefined();
    expect(system.matchEntity('-//P//EN', undefined)).toBe('file:///c/p.dtd');
  });

  it('defers reading catalog files by default, and reads them all at once when told not to', () => {
    const lazy = memoryReader(FILES);
    catalogResolver({ files: ['file:///c/catalog.xml'], read: lazy.read });
    expect(lazy.asked).toEqual([]);
    const eager = memoryReader(FILES);
    catalogResolver({ files: ['file:///c/catalog.xml'], read: eager.read, defer: false });
    expect(eager.asked).toEqual(['file:///c/catalog.xml', 'file:///c/next.xml']);
    const deferred = memoryReader(FILES);
    catalogResolver({ files: ['file:///c/catalog.xml'], read: deferred.read, defer: true });
    expect(deferred.asked).toEqual([]);
  });

  it('accepts catalog files in any scheme', () => {
    const { read, asked } = memoryReader({});
    catalogResolver({ files: ['http://example.com/catalog.xml', 'urn:x:catalog'], read, defer: false });
    expect(asked).toEqual(['http://example.com/catalog.xml', 'urn:x:catalog']);
  });
});
