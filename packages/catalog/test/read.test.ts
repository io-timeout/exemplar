import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalFile } from '@/read.ts';

describe('readLocalFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['http://example.com/catalog.xml', 'https://example.com/a.dtd', 'urn:x:y', 'catalog.xml'])(
    'reads nothing but file: URIs, such as %s',
    (uri) => {
      expect(readLocalFile(uri)).toBeUndefined();
    }
  );

  it('reads nothing where the runtime has no file system', () => {
    vi.stubGlobal('process', undefined);
    expect(readLocalFile('file:///etc/hosts')).toBeUndefined();
    vi.stubGlobal('process', {});
    expect(readLocalFile('file:///etc/hosts')).toBeUndefined();
    vi.stubGlobal('process', { getBuiltinModule: () => undefined });
    expect(readLocalFile('file:///etc/hosts')).toBeUndefined();
  });

  it('reads nothing when the file system cannot read the file', () => {
    const fs = {
      readFileSync: () => {
        throw new Error('ENOENT');
      },
    };
    vi.stubGlobal('process', { getBuiltinModule: (id: string) => (id === 'node:fs' ? fs : undefined) });
    expect(readLocalFile('file:///missing/catalog.xml')).toBeUndefined();
  });

  it('reads a file: URI as bytes, with the URI as its system id', () => {
    const bytes = new Uint8Array([0x3c, 0x61, 0x2f, 0x3e]);
    const paths: string[] = [];
    const fs = { readFileSync: (path: URL) => (paths.push(path.href), bytes) };
    vi.stubGlobal('process', { getBuiltinModule: () => fs });
    expect(readLocalFile('file:///c/catalog.xml')).toEqual({ systemId: 'file:///c/catalog.xml', bytes });
    expect(paths).toEqual(['file:///c/catalog.xml']);
  });
});
