import { existsSync } from 'node:fs';
import path from 'node:path';
import { type UserConfig, defineConfig } from 'tsdown';

/** The workspace's `LICENSE`, `NOTICE` and `THIRD_PARTY_LICENSES`, copied into the package being built; in CI only, since only CI publishes. */
function legalFiles(): { from: string[]; to: string }[] {
  if (!process.env['CI']) return [];
  let dir = process.cwd();
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml above ${process.cwd()}, so no LICENSE to copy`);
    dir = parent;
  }
  return [{ from: ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES'].map((name) => path.join(dir, name)), to: '.' }];
}

/** Shared tsdown settings for a library package: ES modules and declarations, one file per source module. */
export function createLibraryConfig(options: UserConfig = {}): UserConfig {
  return defineConfig({
    // Every module is an entry, so that each keeps all its exports.
    entry: ['src/**/*.ts'],
    outDir: 'dist',
    format: ['esm'],
    // The library runs in browsers as well as on Node, Deno and Bun.
    platform: 'neutral',
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    fixedExtension: false,
    tsconfig: true,
    // Keeps the source's module boundaries, so each module stays as V8 sees it in development.
    unbundle: true,
    deps: { neverBundle: true },
    ...options,
    copy: [...legalFiles(), ...(Array.isArray(options.copy) ? options.copy : [])],
  });
}
