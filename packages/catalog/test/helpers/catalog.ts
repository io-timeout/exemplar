import type { ResolvedSource } from '@exemplarjs/xml';
import { type CatalogOptions, type CatalogResolver, catalogResolver } from '@/index.ts';

/** The catalog namespace, declared as the default namespace. */
export const NS = 'xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog"';

/** The catalog file the helpers start from. */
export const ROOT = 'file:///c/catalog.xml';

/** In-memory files by absolute URI. */
export type Files = Readonly<Record<string, string>>;

/** A reader over in-memory files that records every URI it is asked for. */
export function memoryReader(files: Files): { read: (uri: string) => ResolvedSource | undefined; asked: string[] } {
  const asked: string[] = [];
  const read = (uri: string): ResolvedSource | undefined => {
    asked.push(uri);
    const text = files[uri];
    return text === undefined ? undefined : { systemId: uri, text };
  };
  return { read, asked };
}

/** A catalog over in-memory files, starting from ROOT, that carries on when nothing matches unless told otherwise. */
export function catalog(files: Files, options: Partial<CatalogOptions> = {}): CatalogResolver {
  return catalogResolver({ files: [ROOT], read: memoryReader(files).read, resolve: 'continue', ...options });
}

/** A catalog of one file, ROOT, holding the given entries. */
export function entries(xml: string, options: Partial<CatalogOptions> = {}): CatalogResolver {
  return catalog({ [ROOT]: `<catalog ${NS}>${xml}</catalog>` }, options);
}

/** A catalog file holding the given entries. */
export function file(xml: string, attributes = ''): string {
  return `<catalog ${NS} ${attributes}>${xml}</catalog>`;
}
