import { defaultClientConditions, defaultServerConditions } from 'vite';
import { type ViteUserConfig, defineConfig, mergeConfig } from 'vitest/config';

/** The export condition naming each @exemplarjs package's sources. */
export const SOURCE_CONDITION = 'exemplar-source';

/** Shared Vitest settings for a package: tests in `test/`, run on every @exemplarjs package's sources. */
export function createVitestConfig(options: ViteUserConfig = {}): ViteUserConfig {
  const base = defineConfig({
    resolve: { tsconfigPaths: true, conditions: [SOURCE_CONDITION, ...defaultClientConditions] },
    ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
    test: {
      include: ['test/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary'],
        include: ['src/**/*.ts'],
      },
    },
  });
  return mergeConfig(base, options);
}
