import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalOfAsync } from '@test/helpers/canonical.ts';
import { canonical } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { type ResolvedSource, XMLInputFactory } from '@/index.ts';
import { fileResolver } from '@/resolvers/file.ts';

// The file resolver needs a file system, so these tests run on Node only.
describe('fileResolver', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'exemplar-'));
  const root = path.join(parent, 'root');
  mkdirSync(path.join(root, 'sub'), { recursive: true });
  mkdirSync(path.join(parent, 'root-sibling'));
  writeFileSync(path.join(root, 'a.dtd'), '<!ENTITY e "from a file">');
  writeFileSync(path.join(root, 'sub', 'e.xml'), '<b>from a subdirectory</b>');
  writeFileSync(path.join(parent, 'outside.dtd'), '<!ENTITY e "outside">');
  writeFileSync(path.join(parent, 'root-sibling', 'a.dtd'), '<!ENTITY e "sibling">');
  const document = pathToFileURL(path.join(root, 'doc.xml')).href;
  const resolver = fileResolver({ root });

  it('reads files below its root', () => {
    const options = { accessExternalDTD: ['file'], entityResolver: resolver } as const;
    expect(canonical({ text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', systemId: document }, options)).toBe(
      '<a>from a file</a>'
    );
  });

  it('keeps to the access list a request carries, refusing file: when it is not named', () => {
    const request = { name: '[dtd]', systemId: 'a.dtd', baseURI: document };
    expect(() => resolver.resolveEntity({ ...request, access: ['https'] })).toThrow(
      expect.objectContaining({ code: 'ACCESS_REFUSED' })
    );
    expect(resolver.resolveEntity({ ...request, access: ['file'] })).toBeDefined();
    expect(resolver.resolveEntity({ ...request, access: 'all' })).toBeDefined();
    const refused: string[] = [];
    const options = {
      entityResolver: resolver,
      errorHandler: { error: (e: { code: string }) => void refused.push(e.code) },
    };
    expect(canonical({ text: '<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', systemId: document }, options)).toBe('<a></a>');
    expect(refused).toEqual(['ACCESS_REFUSED']);
  });

  it('gives the file URL it read as the system id, with the bytes', () => {
    const resolved = resolver.resolveEntity({ name: 'x', systemId: 'sub/e.xml', baseURI: document }) as ResolvedSource;
    expect(resolved.systemId).toBe(pathToFileURL(path.join(root, 'sub', 'e.xml')).href);
    expect(new TextDecoder().decode(resolved.bytes)).toBe('<b>from a subdirectory</b>');
  });

  it('reads external entities in subdirectories, through the asynchronous reader too', async () => {
    const factory = new XMLInputFactory({ accessExternalEntities: ['file'], entityResolver: resolver });
    const source = { text: '<!DOCTYPE a [<!ENTITY x SYSTEM "sub/e.xml">]><a>&x;</a>', systemId: document };
    expect(await canonicalOfAsync(factory.createAsyncStreamReader(source))).toBe('<a><b>from a subdirectory</b></a>');
  });

  it('reads nothing outside its root, through .. or a directory whose name starts the same', () => {
    expect(resolver.resolveEntity({ name: '[dtd]', systemId: '../outside.dtd', baseURI: document })).toBeUndefined();
    expect(
      resolver.resolveEntity({ name: '[dtd]', systemId: '../root-sibling/a.dtd', baseURI: document })
    ).toBeUndefined();
    const inner = fileResolver({ root: path.join(root, 'sub') });
    expect(inner.resolveEntity({ name: '[dtd]', systemId: 'a.dtd', baseURI: document })).toBeUndefined();
  });

  it('leaves other protocols, and system ids it cannot make absolute, to the next resolver', () => {
    expect(resolver.resolveEntity({ name: '[dtd]', systemId: 'http://example.org/a.dtd' })).toBeUndefined();
    expect(resolver.resolveEntity({ name: '[dtd]', systemId: 'a.dtd' })).toBeUndefined();
    expect(resolver.resolveEntity({ name: '[dtd]' })).toBeUndefined();
  });

  it('supplies nothing for a file that does not exist, or for the root directory itself', () => {
    expect(resolver.resolveEntity({ name: '[dtd]', systemId: 'missing.dtd', baseURI: document })).toBeUndefined();
    expect(resolver.resolveEntity({ name: '[dtd]', systemId: pathToFileURL(root).href })).toBeUndefined();
  });

  it('supplies nothing for a URI whose escapes are not UTF-8', () => {
    expect(resolver.resolveEntity({ name: '[dtd]', systemId: 'a%dtd', baseURI: document })).toBeUndefined();
  });
});
