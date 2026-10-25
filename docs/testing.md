# exemplar testing

exemplar's tests have four jobs:

- prove conformance to the W3C recommendations automatically, on every change;
- catch regressions in every module;
- keep results identical at every chunk size, through every API and on every runtime;
- keep speed visible.

[design.md](design.md) describes what is being tested, and [guide.md](guide.md) the API.

Each library package keeps its tests in `test/`. The W3C suites, the consistency checks, the differential tests against libxml2 and Xerces, and the benchmarks live in the [exemplar-tests](https://github.com/io-timeout/exemplar-tests) repository, which runs them on the build of an exemplar checkout beside it; its [`docs/testing.md`](https://github.com/io-timeout/exemplar-tests/blob/main/docs/testing.md) and [`docs/benchmarking.md`](https://github.com/io-timeout/exemplar-tests/blob/main/docs/benchmarking.md) describe them.

## Layers

| Layer       | Tool                                     | Runs                                       | Proves                                           |
| ----------- | ---------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| Unit        | vitest, in each package's `test/`        | Every change                               | Each module against the rules it implements      |
| Property    | vitest with fast-check                   | Briefly on every change, at length nightly | No crash or hang on any input; round trips       |
| Browsers    | vitest browser mode                      | Every change                               | The same results in Chromium, Firefox and WebKit |
| Conformance | exemplar-tests, on this checkout's build | Every change; differentials nightly        | The W3C suites, consistency and differentials    |
| Performance | exemplar-tests                           | Locally against `main`; nightly            | No regressions; comparisons with other libraries |

The commands run through Turborepo from the repository root:

| Command              | Runs                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `pnpm test`          | Each package's unit, integration and property tests                  |
| `pnpm test:coverage` | Every package's tests in one Vitest run, with one V8 coverage report |
| `pnpm test:browser`  | Every package's tests in Chromium, Firefox and WebKit                |
| `pnpm typecheck`     | The type check of every package                                      |

## Unit tests

Unit tests use vitest 5, with explicit imports and no globals. Each package keeps them in `test/`, mirroring `src/`: the tests for `packages/xml/src/scan/scanner.ts` are in `packages/xml/test/scan/scanner.test.ts`. Tests that cross modules sit in `test/integration/`, and tests that need a file system are named `*.node.test.ts`. A test imports its own package's sources through `@/`, its helpers through `@test/`, and other packages by name, which their `exemplar-source` condition resolves to their sources. A package's tests use only the packages it depends on, or lists as development dependencies, so the dependency graph has no cycles: SAX's agreement with the cursor is therefore checked in `packages/sax`, not in `packages/xml`.

**One test per rule.** Each test checks one rule of the specification it implements, and names it with the production, constraint or section, so a failing test points at the spec:

```ts
it('rejects ]]> in character data (§2.4)', () => {
  expect(errorOf('<a>]]></a>')).toMatchObject({ code: 'WF_CDATA_END_IN_TEXT', line: 1, column: 4 });
});
```

**Bug fixes.** Each one comes with a unit test that fails before the fix.

**Shared helpers** sit in each package's `test/helpers/`; the reader's are:

- `parseEveryWay(xml)` parses a document as one string, as bytes whole and at several chunk sizes, fed to an async reader a chunk at a time, and as event objects, and checks that every result is the same;
- `parseAtEverySplit(xml)` does the same with the bytes split in two at every offset, and `parseAsyncEveryWay(xml)` through streams, async iterables and the async event APIs;
- `eventsEveryWay(xml)` compares every event between the start and end of the document in full, with its details, line and column, read whole, in chunks, split at every offset and fed, where the others compare the canonical form, which leaves out comments, the DOCTYPE, entity boundaries, namespace URIs and locations;
- `canonical(source)` returns the suite's canonical form;
- `errorOf(xml)` returns the `XMLError` a document raises, read every way.

**Coverage** is measured with V8. `pnpm test:coverage` runs every package's tests in one Vitest run, a project per package, from the root `vitest.config.js`, and reports coverage across all of them.

## Property tests

fast-check, with its vitest integration, generates inputs:

- **Well-formed documents** from a grammar-based generator. They must read back as the generator wrote them, identically at every chunk size, split at any byte, fed, and as event objects.
- **Entity bombs, quadratic blowups and deep nesting.** Expansion within the limits must give the right text, and beyond them must stop with a limit's error code, quickly. Nesting deeper than `elementDepth`, written out or coming from an entity, must stop with `LIMIT_ELEMENT_DEPTH`.

A short run is part of `pnpm test`, and a long run is nightly: `EXEMPLAR_FUZZ_SCALE` multiplies the number of runs. A failure prints its seed and path, which fast-check's `seed` and `path` parameters replay.

## Runtimes

- **Browsers:** vitest's browser mode runs the unit tests in Chromium, Firefox and WebKit through Playwright, on every change: `pnpm test:browser`. Tests named `*.node.test.ts` need a file system, so they run on Node only.
- **Deno and Bun:** exemplar-tests runs the XML suite on both nightly.
- **Node:** runs everything.
