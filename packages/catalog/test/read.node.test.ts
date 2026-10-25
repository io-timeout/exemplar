import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLocalFile } from '@/read.ts';

// Reading real files needs a file system, so these tests run on Node only.
describe('readLocalFile on Node', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'exemplar-catalog-'));
  writeFileSync(path.join(root, 'a b.xml'), '<a/>');

  it('reads a file by its file: URI', () => {
    const uri = pathToFileURL(path.join(root, 'a b.xml')).href;
    const source = readLocalFile(uri);
    expect(source?.systemId).toBe(uri);
    expect(new TextDecoder().decode(source?.bytes)).toBe('<a/>');
  });

  it('reads nothing for a file that does not exist, or a directory', () => {
    const missing = pathToFileURL(path.join(root, 'missing.xml')).href;
    expect(readLocalFile(missing)).toBeUndefined();
    expect(readLocalFile(pathToFileURL(root).href)).toBeUndefined();
  });

  it('reads nothing for a file: URI that names no local file', () => {
    expect(readLocalFile('file://remote-host/share/catalog.xml')).toBeUndefined();
  });
});
