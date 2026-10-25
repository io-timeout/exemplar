# exemplar development

How the repository is built and worked on, and how to measure a change. The [README](../README.md#the-repository) lists the packages and the commands, and [testing.md](testing.md) the tests.

## Workspace

The repository is a pnpm workspace run by Turborepo:

- `packages/` holds the library, one directory per published package;
- `configs/build-config` holds the settings every package shares.

`@exemplarjs/build-config` is private and never published, so its dependencies never reach exemplar's users. The conformance runner and the benchmarks live in the [exemplar-tests](https://github.com/io-timeout/exemplar-tests) repository, which reads this checkout's built `dist` when it sits beside it.

## Dependencies

Every external dependency takes its version from the catalog in `pnpm-workspace.yaml`; a package lists it as `catalog:`. `catalogMode: strict` makes `pnpm add` put new ones there too, at exact versions. The workspace also sets pnpm's supply-chain checks:

- `minimumReleaseAge` installs no version published less than a week ago;
- `trustPolicy: no-downgrade` refuses a version published with weaker provenance than an earlier one, which is why lefthook stays at 2.2.1: 2.2.2 lost its provenance;
- `blockExoticSubdeps` refuses git and tarball dependencies below the top level;
- `strictDepBuilds` fails an install when a package not listed in `allowBuilds` has a build script.

All packages share one version, which `pnpm set-version <version>` sets.

Each package's `clean:output` script removes the output folders it creates, with rimraf so that it runs on Windows as well as Linux and macOS. The root's runs them all and removes its own. A new package that writes elsewhere lists those folders in its own script.

The root `LICENSE`, `NOTICE` and `THIRD_PARTY_LICENSES` are the only copies in git. npm ships only the files inside a package, so `createLibraryConfig` copies all three into each package when CI builds it; a local build leaves them out. `LICENSE` is Apache's text unchanged; the licences and attributions of the data the decoding tables derive from are in `THIRD_PARTY_LICENSES`.

## Build

Each library package builds the same way, from `@exemplarjs/build-config`:

- its `tsconfig.json` extends `tsconfig.lib.json`, which checks `src/` and `test/` together, with `@/` and `@test/` path aliases. `tsconfig.node.json` is for tools Node runs from their TypeScript, which live in exemplar-tests;
- its `tsdown.config.ts` calls `createLibraryConfig`, which emits ES modules and declarations into `dist/`, one file per source module, with every dependency left external. Every source module is an entry, so each keeps all its exports, including those nothing imports, such as `RESIDENT_READERS` ([Hidden classes](#hidden-classes));
- its `vitest.config.ts` calls `createVitestConfig`, which runs `test/` against the sources of every `@exemplarjs` package.

Each package's exports also name its sources under an `exemplar-source` condition. The tests and TypeDoc resolve with it, so they run on the sources without a build. Node and bundlers ignore it; the name is the project's own so that no consumer's tooling turns it on by chance.

Turborepo orders and caches the tasks:

- `typecheck` needs the declarations its dependencies' `compile` emits;
- `compile` runs after the package's own `typecheck` and caches `dist/`;
- `test` and `lint` run after the dependencies' `compile`.

exemplar-tests reads the built `dist`, so its suites and benchmarks measure what was last compiled here: compile before running them.

## Conventions

- **Web-standard APIs only** in the library's sources, so it runs on Node, Deno, Bun and in browsers. The lint configuration forbids Node's modules and globals there; `@exemplarjs/xml/resolvers/file` alone may import Node's modules.
- **TypeScript** is strict, with `erasableSyntaxOnly`: no `enum`, so constants are `const` objects. Sources import each other with their `.ts` extensions.
- **Comments** are short: a one- or two-line JSDoc on each function, and brief inline comments where they help. Rationale and measurements go in these documents, not in the source.
- **No bare numbers.** Characters are compared by name, from `Char` and `Unicode` in `@exemplarjs/xml`'s `util/chars.ts`, which other packages reach through `@exemplarjs/xml/internal`; hot modules copy the names they test into module-local constants ([Constants](#constants)). Byte layouts, limits and markup lengths get names of their own, such as `'<!--'.length`. Code point ranges quoted from a spec production stay as the spec writes them, citing the production.
- **Shared helpers.** Helpers more than one package needs live in `@exemplarjs/xml`'s `src/util`, one file per theme: `bytes`, `chars`, `errors`, `names`, `namespaces`, `nodes`, `uri` and `whitespace`; `arrays`, `normalize` and `references` beside them serve the reader alone. Look there before writing one, and add a new helper there rather than to the package that first needs it.
- **Internal entry point.** `@exemplarjs/xml/internal` shares the cursor's hooks and the helpers in `src/util` between exemplar's packages. It is not public API, which is why the packages are released together at one version ([design.md](design.md#modules)).
- **Frozen tables.** The encoding and alias tables were generated once and are no longer regenerated.
- **Formatting.** oxfmt formats code and Markdown, padding tables and wrapping code blocks; run `pnpm format` after editing the documents. The pre-commit hook formats, then lints, the staged files.

## Performance

How to measure a change, and what V8 rewards. [design.md](design.md) records the measurements behind each module's choices, and exemplar-tests' [`docs/benchmarking.md`](https://github.com/io-timeout/exemplar-tests/blob/main/docs/benchmarking.md) describes the benchmarks.

| Term         | Meaning                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| A/B          | Timing two builds of exemplar side by side on the same work, to see whether a change is faster.                          |
| Round        | One timed pass over a dataset, after a warm-up pass.                                                                     |
| Noise        | The spread between rounds of one variant. A difference smaller than the noise is not a difference.                       |
| Hot path     | The code that runs for every character, token or event.                                                                  |
| Inlining     | V8 copying a called function into its caller when it optimizes the caller, which removes the call.                       |
| Hidden class | The shape V8 gives objects with the same properties in the same order. Optimized code checks for it.                     |
| Monomorphic  | A call site that has seen one hidden class. Up to four is polymorphic; more is megamorphic, and V8 stops inlining there. |

### Measuring

- **Measure the real path.** Run the code exemplar ships, from its build, and time it on the wall clock. Do not infer speed from types, from a smaller copy of the code, or from a probe that reimplements it, and trust an A/B over a microbenchmark.
- **A/B on whole datasets, in fresh processes.** Compare two builds with each round in a fresh process and the rounds interleaved. exemplar-tests' bench does this against another built checkout that `EXEMPLAR_BASELINE` names, timed beside this one as `exemplar@main`. An in-process comparison favours the build loaded first, so run one in both orders and trust only a difference that holds in both.
- **Report the best and the median** of three or four rounds.
- **Isolate a small difference.** When a difference sits inside the noise, time the one component it concerns in its own script, alternating the two builds in fresh processes.
- **Collect garbage before timing**, as happens between documents in real use; see [Hidden classes](#hidden-classes).
- **Measure the build you ship.** A change to the build, such as a bundler setting, is measured like a change to the code.
- **Time decoders in fresh processes.** `TextDecoder` timings vary between processes.
- **Read settings once.** `process.env` is a slow getter. Read it at module level, not in a loop.

### Inlining

V8 inlines a function only below a size limit, and only up to a budget of inlined code for each function it optimizes. So:

- hot functions stay small, and a throw site in one is a single short call, such as `scanError(code, index, message)`;
- what is rare moves into functions of its own: errors and their messages, markup after `<!`, end tags that do not simply repeat the open element's name, text outside the root, and the less common events;
- a fast path is a short test at the top of a function that handles the common case and returns, with the general case in a separate function;
- on the hottest paths, private methods are keyed by module-local symbols, as a `#private` method's class check stops V8 inlining it ([design.md](design.md#run-time-structure)).

### Call sites

A call through a site that has seen more than four hidden classes is a real call every time. So a document has one cursor, with every layer intercepting its `next()`, rather than one object per layer forwarding every accessor, and there is one scanner implementation, so the tokenizer's calls to it stay monomorphic.

### Hidden classes

V8 holds the hidden classes of finished objects weakly. A full collection while no reader exists, as between documents, collects the reader's hidden classes and discards the optimized code that checks for them. `config/factory.ts` therefore keeps two small readers alive in `RESIDENT_READERS`, one over a string and one over bytes. Nothing imports it, so a bundler that drops unused exports would drop the readers: tsdown builds every source module as an entry for this reason ([Build](#build)).

Keep an object's properties to one set in one order, so that every instance shares one hidden class: event objects have one class for every kind of event. Do not key the fields a hot constructor adds by symbols, which stops V8 inlining the constructor.

### Constants

TurboFan folds a module-local `const` into the code, but an imported binding is a live binding, reloaded on every use. Hot modules copy the constants they test against into module-local constants, such as `const EventType = events.EventType` in the DOM builder.

### Strings

- **Slices keep their source alive.** A slice of 13 characters or more points into its parent string. To copy one, append a character and slice it off again, which makes V8 flatten the string into memory of its own.
- **`+=` builds ropes,** which hold far more memory until flattened. Gather pieces in an array and join them once.
- **Reading an appended string flattens it.** Code that checks new text after each small append looks at the new chunk, not the whole buffer.
- **`startsWith` with a position is slow.** Use `holdsAt` from `scan/scanner.ts`.

### Native calls, Proxies and promises

- A call into native code costs 15–25 ns, so on a hot path the cost per call matters more than the cost per character. Time a regular expression against a `charCodeAt` loop for the same test, on real documents, before choosing.
- A read through a Proxy costs tens of times more than an own property, so nothing read per node or per event goes through one.
- A promise per event is expensive; a callback per event is cheap. Async readers wait only at chunk boundaries.

## Tooling notes

- **TypeScript 7** is the Go compiler and has no JavaScript API, so `pnpm docs:api` runs TypeDoc with TypeScript 6 through `pnpm dlx`. Incremental type checking is off, because TypeScript 7 has reused stale results after options changed.
- **tsdown** emits declarations with TypeScript 7's own compiler. `isolatedDeclarations` stays off, because members keyed by imported symbols, such as the cursor's hooks, cannot be declared in isolation.
- **oxlint.** An override must declare a plugin to switch its rules off, and an override that gives only a severity replaces the rule's options. Type-aware rules read dependencies' declarations, which is why `lint` runs after `compile`.
- **oxfmt** leaves `**/fixtures/` alone, so whitespace-sensitive XML fixtures stay byte for byte as written.
- **Turborepo** hashes files directly, without git. Declare a task's outputs exactly: a cache restore can leave stale files in `dist`.
- **JSON with comments.** `.oxlintrc.json`, `.oxfmtrc.json` and `turbo.json` hold comments, so a plain JSON parser cannot read them.
- **Escapes.** `\uXXXX` escapes have turned into literal characters on the way to disk when tools wrote sources. Check new sources for invisible and control characters.
