import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/** The library packages, whose tests run in Chromium, Firefox and WebKit too. */
const PACKAGES = ['xml', 'sax', 'writer', 'dom', 'canonical', 'validation', 'xinclude', 'catalog', 'encodings-cjk'];

export default defineConfig({
  test: {
    projects: PACKAGES.map((name) => ({
      extends: `./packages/${name}/vitest.config.ts`,
      test: {
        name,
        root: `./packages/${name}`,
        // Tests named `.node.test.ts` need a file system.
        exclude: ['test/**/*.node.test.ts'],
        browser: {
          enabled: true,
          headless: true,
          provider: playwright(),
          instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
        },
      },
    })),
  },
});
