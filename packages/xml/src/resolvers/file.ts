/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveURI } from '../util/uri.ts';
import { type EntityResolver, type ResolvedSource, checkAccess } from './resolver.ts';

/** Settings for `fileResolver`. */
export interface FileResolverOptions {
  /** The directory the resolver reads below; nothing outside it is read. */
  readonly root: string;
}

/** Reads `file:` entities and DTDs below a root directory, as the access list allows, for Node, Deno and Bun. */
export function fileResolver(options: FileResolverOptions): EntityResolver {
  const root = path.resolve(options.root);
  return {
    resolveEntity(request): ResolvedSource | undefined {
      const uri = resolveURI(request.systemId, request.baseURI);
      if (!uri?.startsWith('file:')) return;
      checkAccess(request, uri);
      let file: string;
      try {
        file = path.resolve(fileURLToPath(uri));
      } catch {
        // A URI with an escape that is not UTF-8 names no file.
        return;
      }
      if (file !== root && !file.startsWith(root + path.sep)) return;
      try {
        return { systemId: pathToFileURL(file).href, bytes: readFileSync(file) };
      } catch {
        return;
      }
    },
  };
}
