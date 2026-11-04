import { defineConfig } from 'vitest/config';

/** Every library package's tests in one run, with one coverage report across them. */
export default defineConfig({
  test: {
    projects: ['./packages/*'],
    coverage: {
      provider: 'v8',
      // lcov for SonarQube Cloud.
      reporter: ['text', 'json', 'json-summary', 'lcovonly'],
      reportOnFailure: true,
      include: ['packages/*/src/**/*.ts'],
      thresholds: { statements: 99, branches: 98, functions: 99, lines: 99 },
    },
  },
});
