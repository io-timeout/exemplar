import type { ResolvedSource } from '@exemplarjs/xml';

/** The part of `node:fs` the default reader uses. */
interface FileSystem {
  readFileSync(path: URL): Uint8Array;
}

/** Reads a `file:` URI where the runtime has a file system, as Node, Deno and Bun do; undefined elsewhere. */
export function readLocalFile(uri: string): ResolvedSource | undefined {
  if (!uri.startsWith('file:')) return undefined;
  const runtime = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } };
  const fs = runtime.process?.getBuiltinModule?.('node:fs') as FileSystem | undefined;
  if (fs === undefined) return undefined;
  try {
    return { systemId: uri, bytes: fs.readFileSync(new URL(uri)) };
  } catch {
    return undefined;
  }
}
