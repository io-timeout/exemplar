# exemplar

A fast, W3C-conformant XML library for TypeScript, with what Java's JAXP, StAX, SAX and DOM offer. [packages/xml](packages/xml/README.md) introduces the library itself.

## The repository

| Package                                                                                            | What it holds                                                  |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/xml`                                                                                     | The reader, published as `@exemplarjs/xml`                     |
| `packages/sax`, `writer`, `dom`, `canonical`, `validation`, `xinclude`, `catalog`, `encodings-cjk` | The rest of the library, one `@exemplarjs` package each        |
| `configs/build-config`                                                                             | The tsconfigs, tsdown and Vitest settings every package shares |

## Commands

| Command                                      | What it does                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm install`                               | Installs everything                                                         |
| `pnpm compile`                               | Type-checks and builds every package with tsdown                            |
| `pnpm typecheck`, `pnpm lint`, `pnpm format` | Type-checks, lints and formats                                              |
| `pnpm test`                                  | Runs each package's unit, integration and property tests                    |
| `pnpm test:coverage`                         | Runs every package's tests in one Vitest run, with one coverage report      |
| `pnpm test:browser`                          | Runs every package's tests in Chromium, Firefox and WebKit                  |
| `pnpm docs:api`                              | Generates the API reference with TypeDoc                                    |
| `pnpm set-version 0.2.0`                     | Sets every package to one version                                           |
| `pnpm clean:output`                          | Runs each package's `clean:output`, which removes its build and test output |
| `pnpm reset`                                 | Runs `clean:output`, then pnpm's own `clean` on every package               |

The browser tests need Playwright's browsers, from `pnpm exec playwright install`.

The W3C suites, the consistency checks, the differential and fuzz tests against libxml2 and Xerces, and the benchmarks live in the [exemplar-tests](https://github.com/io-timeout/exemplar-tests) repository. Checked out beside this one, it runs them on this checkout's build, so compile here first.

## Documentation

- [docs/guide.md](docs/guide.md): how to use exemplar.
- [docs/design.md](docs/design.md): how it works, and why.
- [docs/development.md](docs/development.md): how the repository is built, its conventions, how to measure a change, and tooling notes.
- [docs/testing.md](docs/testing.md): the unit and property tests, and where the suites and benchmarks run.

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions are in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES). Every package ships all three.
