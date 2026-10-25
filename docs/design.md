# exemplar design

exemplar reads, validates, transforms and writes XML in JavaScript. It aims to be:

- the most conformant XML library for JavaScript;
- the fastest;
- as capable as the Java XML stack, with pluggable parsers, resolvers, handlers, filters, a tree model and writers.

It is benchmarked continuously against the other JavaScript XML libraries.

[development.md](development.md#performance) says how changes are measured, and what V8 rewards.

## Terms

| Term                     | Meaning                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fatal error              | An error the processor must detect and report, after which it must not continue normal processing (XML 1.0 §1.2). Every well-formedness violation is one, and so are the encoding errors of §4.3.3. exemplar stops at the first, and every later `next()` throws it again. |
| Error                    | A violation of a validity rule, or another recoverable error. exemplar reports it to the error handler and parsing continues; without an `error` handler it is thrown and parsing ends, as in the JDK.                                                                     |
| Warning                  | Something the specification says a processor may report, such as an attribute declared twice.                                                                                                                                                                              |
| Well-formed (WF)         | Free of fatal errors.                                                                                                                                                                                                                                                      |
| Valid                    | Well-formed and matching its DTD. Only checked when validation is switched on.                                                                                                                                                                                             |
| DOCTYPE, internal subset | `<!DOCTYPE root [ … ]>`. The part between the brackets is the internal subset.                                                                                                                                                                                             |
| External subset          | DTD declarations in a separate entity named by the DOCTYPE's system identifier.                                                                                                                                                                                            |
| General entity           | Declared with `<!ENTITY name "…">`, used as `&name;`.                                                                                                                                                                                                                      |
| Parameter entity         | Declared with `<!ENTITY % name "…">`, used as `%name;` inside the DTD.                                                                                                                                                                                                     |
| Unparsed entity          | An entity with an `NDATA` notation, such as an image. It is only ever named in an attribute of type ENTITY, never expanded.                                                                                                                                                |
| Skipped entity           | A reference to an entity the parser does not read: its declaration was not read, or it is external and no resolver supplies it. It is reported, not expanded, as SAX's `skippedEntity` reports it; a parameter entity that is not read is reported there too, as `%name`.  |
| NCName, QName            | An NCName is an XML name without a colon. A QName is an optional prefix and a local name, both NCNames, joined by a colon.                                                                                                                                                 |
| Resolver                 | A caller-supplied object that turns a public identifier, system identifier or URI into content.                                                                                                                                                                            |
| Catalog                  | A file mapping public and system identifiers and URIs to local copies (OASIS XML Catalogs).                                                                                                                                                                                |
| Handler                  | A caller-supplied object that receives push events, errors or declarations.                                                                                                                                                                                                |
| Filter                   | An object between the parser and the caller that may drop, change or add events.                                                                                                                                                                                           |
| Cursor                   | The pull reader. `next()` moves to the next event, and accessors read it.                                                                                                                                                                                                  |
| XInclude                 | `<xi:include href="…"/>` elements that pull in another document, or part of one, while parsing.                                                                                                                                                                            |
| Base URI                 | The URI that relative references are resolved against: the entity's location, changed by `xml:base`.                                                                                                                                                                       |
| Scanner                  | The loops that look at every character: they find where markup starts, count lines, spot CR and check characters.                                                                                                                                                          |
| Tokenizer                | Turns what the scanner finds into tokens: tag names, attributes, text and the rest, as offsets. The scanner runs inside it, in one pass.                                                                                                                                   |
| Sliced string            | V8's representation of `s.slice(a, b)` of 13 or more characters: a view that keeps all of `s` alive.                                                                                                                                                                       |

## Conformance

exemplar implements:

- XML 1.0 fifth edition and XML 1.1 second edition;
- Namespaces in XML 1.0 third edition and 1.1 second edition;
- XML Base second edition and `xml:id` 1.0;
- XInclude 1.0 second edition, with the XPointer framework, the `element()` scheme and shorthand pointers;
- OASIS XML Catalogs 1.1;
- DOM Level 3 Core, for the tree model;
- Canonical XML 1.0 and 1.1, and Exclusive XML Canonicalization 1.0.

It is a **non-validating processor by default**, and a **validating processor** when the caller sets a DTD validator from `@exemplarjs/validation`. Either way it checks the whole internal subset for well-formedness. It applies the declarations it reads, from the internal subset and from any external subset or parameter entity a resolver supplies, up to the first parameter-entity reference it does not read (§5.1).

External entities are read only through a resolver, and only for the protocols the caller allows. A validating processor must read the whole DTD and every external parsed entity the document refers to (§5.1), but exemplar does not stop when no resolver can supply one. A validating reader skips it, as a non-validating one does, and validates against the declarations it has read, so what the unread part declares shows up as validity errors. Canonicalization alone fails on an entity or subset it cannot read, with `C14N_UNREAD`.

Errors follow the specification's three levels:

| Level       | What exemplar does                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Fatal error | Calls the error handler's `fatalError()`, if it has one, then throws `XMLError` and stops. Nothing more is delivered. |
| Error       | Calls the error handler's `error()`. Without an `error` handler it is thrown, and parsing ends.                       |
| Warning     | Calls the error handler's `warning()`. The default handler ignores it.                                                |

exemplar also stops with an `XMLError` for a reason of its own that the specification does not name: an exceeded [limit](#entities-entities).

Every error carries a line, a column, an offset and the system identifier of the entity it occurred in. The W3C conformance suites run on every change ([testing.md](testing.md)).

exemplar has no XML Schema validation or XPath. A schema validator would plug in as a filter, as `javax.xml.validation` does, and the tree model leaves room for schema type information, so neither would need this design to change.

## Architecture

```
                       ┌──────────── input ─────────────┐
 Uint8Array / stream ─►│ encoding detection ─► decoder  │──► decoded text chunks ───────┐
 string ───────────────┼────────────────────────────────┼──────────────────────────────►┤
                       └────────────────────────────────┘                               │
                                                                                        ▼
                                      tokenizer: one pass of per-character loops behind the scanner
                                      interface (lines, CR, characters; tokens as offsets, no strings)
                                                                                        │
             catalogs ─► resolvers ◄──► entity manager ◄──► DTD processor ◄─────────────┤
                                                                                        │
                                                        namespaces ──► validator (when validating)
                                                                                        │
                                                                    cursor (pull, one shared state)
                                                                                        │
                                                   filters: XInclude, user filters (intercept next())
                          ┌──────────────────┬──────────────────┬───────────────────────┴─┬──────────────┐
                     cursor API         event reader       push (SAX-style)          async iterators,   tree builder
                                                           handlers, filters          web streams        (DOM)
```

Writing:

```
 stream writer / event writer / tree ─► serializer (escaping, namespaces, indent) ─► [canonicalizer] ─► sink
                                                                                           (string chunks or bytes)
```

## Run-time structure

Each concern is its own source module, but at run time a document has one cursor. Entity boundaries, coalescing, the validator and user filters each intercept the cursor's `next()`, once per event, and may drop, change or add events; XInclude overrides it in a subclass. Namespaces and DTD defaults are worked out inside the cursor as it reads each start tag. Accessors such as `name()` and `attributeValue(i)` are the cursor's own methods and read its state directly, never through a chain of readers that forward to one another.

**Inside the cursor.** The cursor is made of parts, each holding one concern's state and the code that changes it. The cursor owns its parts and calls them directly; no part forwards another's accessors, so each call site sees one class, which V8 inlines. `StreamReader` answers the public API. Its `EventCore` turns tokens into events and keeps what the accessors read on every event: the current event, its token and its text. The entity stack tracks which tokenizer is being read; the event core keeps its own reference to it, renewed whenever an entity starts or ends.

| Part                 | File                     | Holds                                                                                   |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `EventCore`          | `event-core.ts`          | Turning tokens into events, and the current event: its token, offset and text           |
| `ElementStack`       | `element-stack.ts`       | The open elements: where each name is, the name once sliced, and whether the root ended |
| `NamespaceScopes`    | `namespace-scopes.ts`    | The namespaces in scope, each element's declarations, and the binding of its prefix     |
| `AttributeCollector` | `attribute-collector.ts` | The current start tag's attributes: their checks, namespaces, DTD defaults and `xml:id` |
| `EntityStack`        | `entity-stack.ts`        | The document and the entities expanded in it, the one being read, and locations in them |
| `EntityExpander`     | `entity-expander.ts`     | Expanding references in content and attribute values, its limits, and external entities |
| `ErrorReporter`      | `error-reporter.ts`      | Errors as the error handler receives them, some held back while a DTD is read again     |
| `DtdLoader`          | `dtd-loader.ts`          | Reading the DOCTYPE's internal and external subsets                                     |
| `AsyncInput`         | `async-input.ts`         | What an asynchronous reader waits for and is fed                                        |
| `EventProcessing`    | `event-processing.ts`    | The optional steps after the tokens: entity boundaries, coalescing, validation, filters |

The helpers `nextTag()`, `elementText()` and `forEachEvent()` are built on the public methods, in `navigation.ts`, and the current token's values, such as normalized text and a PI's data, are worked out in `token-values.ts`. Event processing makes each event current on the event core, so that filters and the validator read the cursor as callers do. The validator is made last, as making it may read the cursor, and is given to event processing with the core.

**Why one cursor.** V8 inlines a call only while its call site has seen at most four object shapes, and library code that serves many reader types sees more than that. So no layer wraps the cursor and forwards its accessors, which would make each accessor a real call through every layer, on every event.

**Hidden classes.** exemplar keeps two small readers alive, one over a string and one over bytes, so that a garbage collection between documents does not discard the optimized code for readers ([development.md](development.md#hidden-classes)).

Besides filters that intercept `next()`, two other forms are offered:

- **Push filter chains in the SAX `XMLFilterImpl` style**, for SAX-style code (see [Measured costs](#measured-costs)).
- **A full forwarding delegate**, for callers who need to override accessors.

**Private members.** Private state and methods are `#private` by default. Calling a `#private` method costs a check that the object is of the right class, and on the hottest paths that check stops V8 inlining. So the private methods of `Tokenizer`, `EventCore` and `StreamReader` are keyed by symbols each module declares and keeps to itself, as `SplicingReader`'s state is in XInclude. A symbol stays private at run time, so `SplicingReader` and `XIncludeReader`, which extend `StreamReader`, cannot clash with it. Other classes keep `#` methods, and every class keeps `#` fields. Members that other classes read, such as the DOM nodes' links, are named with `_` and tagged `@internal`. The DOM nodes' fields are not keyed by symbols, which would stop V8 inlining the node constructors.

## Configuration

Every option lives on a factory, as in JAXP, and parsers made from it share the configuration. Options are typed properties, not SAX feature URIs or JAXP property strings, and use Java names where an equivalent exists; the limits, whose JDK names read awkwardly inside `limits`, have plain names, and [Entities](#entities-entities) gives each one's JDK property.

| Option                                        | Default                  | Java equivalent                                                                                                                                    |
| --------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `namespaceAware`                              | `true`                   | StAX `IS_NAMESPACE_AWARE`, SAX `namespaces`                                                                                                        |
| `namespacePrefixes`                           | `false`                  | SAX `namespace-prefixes`: report `xmlns` attributes among the attributes                                                                           |
| `validator`                                   | none                     | JAXP `setValidating(true)`, StAX `IS_VALIDATING`, SAX `validation`. A DTD validator from `@exemplarjs/validation`.                                 |
| `checkWellFormedness`                         | `true`                   | (none) Off skips the structural checks for trusted input and is not conformant.                                                                    |
| `checkNormalization`                          | `false`                  | DOM `check-character-normalization`: report whether an XML 1.1 document is fully normalized                                                        |
| `replaceEntityReferences`                     | `true`                   | StAX `IS_REPLACING_ENTITY_REFERENCES`                                                                                                              |
| `supportExternalEntities`                     | `true`                   | StAX `IS_SUPPORTING_EXTERNAL_ENTITIES`, SAX `external-general-entities`                                                                            |
| `accessExternalDTD`, `accessExternalEntities` | `[]` (none)              | `XMLConstants.ACCESS_EXTERNAL_DTD` and its JDK siblings; a list of protocols, or `'all'`                                                           |
| `disallowDoctype`                             | `false`                  | Xerces `disallow-doctype-decl`                                                                                                                     |
| `coalescing`                                  | `false`                  | StAX `IS_COALESCING`                                                                                                                               |
| `reportPrologWhitespace`                      | `false`                  | Woodstox `P_REPORT_PROLOG_WHITESPACE`                                                                                                              |
| `reportEntityBoundaries`                      | `false`                  | SAX `LexicalHandler.startEntity` and `endEntity`; StAX has none. The cursor reports `START_ENTITY` and `END_ENTITY` events, numbered beyond StAX's |
| `copyStrings`                                 | `false`                  | (none) When on, the cursor copies values instead of slicing the input.                                                                             |
| `xinclude`                                    | none                     | JAXP `setXIncludeAware(true)`. An XInclude processor from `@exemplarjs/xinclude`.                                                                  |
| `entityResolver`                              | none                     | SAX `EntityResolver2`, StAX `XMLResolver`                                                                                                          |
| `uriResolver`                                 | none                     | JAXP `URIResolver`                                                                                                                                 |
| `catalog`                                     | none                     | `javax.xml.catalog`'s `CatalogManager.catalogResolver`. A catalog resolver from `@exemplarjs/catalog`.                                             |
| `entities`                                    | none                     | Woodstox `P_CUSTOM_INTERNAL_ENTITIES`: entities known in advance                                                                                   |
| `errorHandler`                                | throw on error and fatal | SAX `ErrorHandler`, StAX `XMLReporter`                                                                                                             |
| `decoders`                                    | built-in registry        | `Charset` providers                                                                                                                                |
| `limits`                                      | JDK 24 defaults          | `jdk.xml.*` limits; see [Entities](#entities-entities)                                                                                             |

## Modules

exemplar is published as these packages and subpaths, all at one version:

| Import                           | Holds                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| `@exemplarjs/xml`                | Factories, the readers, events, errors and the built-in decoders |
| `@exemplarjs/sax`                | The push API                                                     |
| `@exemplarjs/dom`                | The DOM tree, its builder, `DOMParser` and `XMLSerializer`       |
| `@exemplarjs/writer`             | The writers and sinks                                            |
| `@exemplarjs/xml/filters`        | Pull filters and delegates                                       |
| `@exemplarjs/canonical`          | Canonicalization                                                 |
| `@exemplarjs/validation`         | The DTD validator                                                |
| `@exemplarjs/xinclude`           | The XInclude processor                                           |
| `@exemplarjs/catalog`            | The catalog resolver                                             |
| `@exemplarjs/xml/resolvers`      | The fetch resolver                                               |
| `@exemplarjs/xml/resolvers/file` | The file resolver                                                |
| `@exemplarjs/encodings-cjk`      | The Japanese, Chinese and Korean decoders                        |

A feature with its own package or subpath loads only when the caller imports it and passes it to the factory, so code that does not use it never loads it. exemplar runs on Node, Deno, Bun and modern browsers, and uses only web-standard APIs, except in `@exemplarjs/xml/resolvers/file` and the catalog's default `read`, which read files on Node, Deno and Bun.

Every other package builds on `@exemplarjs/xml`, and lists it and any other `@exemplarjs` package it uses as peer dependencies, so an application holds one copy of each. They reach the reader's internals through `@exemplarjs/xml/internal`: symbol-keyed hooks such as `CREATE_READER`, and the shared helpers in `util`, such as `isXmlName`. It is not public API. Two copies of `@exemplarjs/xml` would not share those symbols, which is why the packages are released together.

The repository's workspace, build and tooling are described in [development.md](development.md).

The library's modules:

| Module       | Responsibility                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`     | Factories, options and their defaults                                                                                                                                                        |
| `encodings`  | The built-in UTF-16, UTF-32 and single-byte decoders, and the single-byte tables the writer also encodes with                                                                                |
| `input`      | Input sources (bytes, strings, iterables, streams, plus system and public ids), encoding detection, the decoder registry                                                                     |
| `scan`       | The per-character loops behind the scanner interface                                                                                                                                         |
| `tokenizer`  | Tokens as offsets, resuming across chunks of any size                                                                                                                                        |
| `util`       | Helpers every module and package shares: characters, names, namespaces, URIs, references, whitespace, bytes, errors, line-end and attribute-value normalization, and the parts of a DOM node |
| `dtd`        | Parses the internal and external subsets, expands parameter entities, keeps declarations                                                                                                     |
| `entities`   | Entity limits, resolver calls and expansion in attribute values; the cursor expands references in content                                                                                    |
| `namespaces` | The namespace bindings in scope; the cursor's namespace scopes and attribute collector make the namespace checks                                                                             |
| `validation` | The DTD validator: content models, ID/IDREF, attribute types, `standalone` checks                                                                                                            |
| `cursor`     | The pull reader at the core of every API                                                                                                                                                     |
| `events`     | Event objects, the event reader, async iterators and web streams                                                                                                                             |
| `sax`        | Push API: content, lexical, declaration, DTD and error handlers; a locator; filter chains                                                                                                    |
| `filters`    | Pull filters and delegates                                                                                                                                                                   |
| `xinclude`   | XInclude processing, as a filter, with XPointer                                                                                                                                              |
| `resolvers`  | Resolver interfaces and the ready-made file and fetch resolvers; `util` resolves base URIs (XML Base)                                                                                        |
| `catalog`    | An XML Catalogs 1.1 resolver                                                                                                                                                                 |
| `dom`        | The DOM Level 3 Core tree, its builder, and browser-style `DOMParser` and `XMLSerializer`                                                                                                    |
| `writer`     | Stream and event writers, escaping, namespace repair, indentation, sinks and encoders                                                                                                        |
| `canonical`  | Canonical XML 1.0 and 1.1, Exclusive C14N, and the W3C suite's canonical forms                                                                                                               |
| `errors`     | `XMLError` and its codes, locations                                                                                                                                                          |

## Input (`input`)

### Sources

A source is one of:

- a string;
- a `Uint8Array`;
- an `Iterable` or `AsyncIterable` of `Uint8Array`;
- a `ReadableStream`.

It may also carry:

- a system identifier and a public identifier;
- a base URI;
- an encoding supplied from outside, such as an HTTP charset.

This mirrors SAX's `InputSource` and StAX's `Source`.

### Encoding detection

Detection follows XML 1.0 §4.3.3 and Appendix F, and RFC 7303 for encodings supplied from outside:

1. A byte-order mark wins.
2. Then an encoding supplied from outside.
3. Then the first four bytes and the `encoding` in the XML declaration.
4. If none of these applies, the document is UTF-8.

An encoding supplied from outside that disagrees with the declaration is not an error: the outside encoding wins, and exemplar reports a warning (RFC 7303 §3.2).

These are fatal errors, as the specification requires:

- an encoding exemplar cannot decode;
- any byte sequence illegal in the encoding. For UTF-8 that means any ill-formed sequence as defined in Unicode §3.9;
- when no encoding is supplied from outside: an entity in an encoding other than the one it declares, and an entity that has neither a BOM nor an encoding declaration and is not UTF-8;
- a text declaration anywhere but at the start of an external entity.

UTF-16 without a BOM depends on what names the encoding:

- with no declaration and no encoding from outside, it is a fatal error, like any other entity that is not UTF-8;
- declared as `UTF-16`, it breaks a MUST that the specification does not call fatal, so it is reported as an error and decoded as Appendix F detects it. Supplied from outside as `UTF-16`, it is decoded in the byte order its first bytes show;
- declared or supplied as `UTF-16LE` or `UTF-16BE`, it is correct.

exemplar strips the BOM itself and decodes with `ignoreBOM: true`. It names UTF-16 decoders explicitly as `utf-16le` or `utf-16be`, because `TextDecoder` reads the bare label `utf-16` as little-endian.

## Scanning (`scan`)

Every conforming parser has to look at every character. It must find where markup starts, count lines, spot CR for line-ending normalization, and reject the characters XML forbids. exemplar does this the way Xerces, Woodstox and Aalto do: in one pass, inside the tokenizer's own loops, in plain JavaScript.

**The loops.** Each loop reads characters with `charCodeAt` and looks each one up in a class table, a `Uint8Array` indexed by code unit for ASCII. A character above U+007F takes one branch, which checks surrogate pairs, U+FFFE and U+FFFF, and the fifth-edition name ranges. XML 1.1 documents use their own class table, which also rejects U+007F. Above U+007F their branch also rejects U+0080–U+0084 and U+0086–U+009F, and stops at NEL (U+0085) and LS (U+2028), which are line ends there.

The text and attribute-value loops first test an ASCII character against one constant table: the characters every table set classes as ordinary. Only the rest are looked up in the document's own table, so the common test reads no per-document state. The loops read their constants from module-local copies, which TurboFan folds; an imported binding is reloaded on every use. Text that starts with spaces, tabs and line feeds, the indentation pretty-printed documents put between tags, is skipped by a tight loop first, and only what follows is scanned.

| Loop                  | Stops at                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Text                  | `<`, `&`, `]` (for `]]>`), CR, invalid characters and, in XML 1.1, NEL and LS. A line feed is an ordinary character. |
| Attribute value       | The closing quote, `<` (an error), `&`, and tab, LF, CR and, in XML 1.1, NEL and LS, which need normalization.       |
| Name                  | The first character that is not a name character.                                                                    |
| Comment, PI and CDATA | The first character of the terminator.                                                                               |

As each loop goes, it records what the rest of the parser needs: whether a value contains CR or a reference, and where references are. Lines are not counted while scanning; [Locations](#readers-cursor-events-sax-filters) counts them when one is asked for.

**Plain runs.** In an XML 1.0 document, text and attribute values are scanned with sticky regular expressions, one call for each run. Each matches the characters that need no check: in text, anything but `<`, `&`, `]`, CR and what XML forbids or pairs (surrogates, U+FFFE, U+FFFF and the C0 controls but tab and LF); in an attribute value, anything but its quote, `<`, `&`, tab, LF, CR and the same characters. Where a run stops at anything else, the character loop takes that one code unit and the expression goes on after it. V8 runs these expressions more slowly on one-byte strings, so in a buffer whose chunks have held no character above U+00FF, text is found natively instead: `indexOf` finds the next `<`, `&` and `]]>`, each position cached until the scan passes it, and one regular expression checks the run for what XML forbids and surrogates. A CR found the same way only sets the flag. A run that holds `]]>` or a forbidden character goes through the expression and the character loop for the rest of its length, so no search covers it twice, and the character loop reports the exact error. Comments, PIs and CDATA sections are always finished natively. XML 1.1 documents use the loops throughout.

**The scanner interface.** The loops sit behind a small scanner interface. Each operation takes the buffer and a start offset, returns where it stopped, and updates the shared flag state. The operations are: scan text, scan an attribute value, scan a name, and scan to a terminator.

- The tokenizer calls only these operations.
- There is one scanner implementation, so the calls stay monomorphic and V8 inlines them.

## Tokenizer (`tokenizer`)

The tokenizer reads the decoded text through the scanner's loops. It records each token as offsets: kind, name span, attribute name and value spans in reused typed arrays, and text span. It creates no strings, decodes no references and knows nothing of namespaces.

The token's record and the buffer stay on the `Tokenizer` itself, as every scanning loop reads them. What is self-contained sits beside it:

- `ChunkReader` reads chunks from the source and decides when enough has arrived to rescan an unfinished token.
- `LineCounter` counts lines from a checkpoint that only moves forward, and records line starts for event objects.
- `DoctypeToken` scans a DOCTYPE's external identifier and finds the end of its internal subset.
- `SearchCache` remembers where the native searches last found each needle.
- `syntax.ts` holds the steps every kind of markup shares: names within the length limit, whitespace, and running out of text.

The hot paths of the tokenizer and the cursor stay small, and what is rare sits in functions of its own, so that V8 inlines them ([development.md](development.md#inlining)).

Chunks of any size work, from one byte upwards. When a token is unfinished at the end of the buffer, the tokenizer rescans it once at least twice as much text is buffered, which keeps the cost O(n). The text before the token is dropped only when more text has actually arrived.

- The test suite feeds every document at many chunk sizes and requires identical events.

**Start tags without attributes**, most of them in most documents, end as soon as their name is followed by `>` or `/>`, without the attribute loop.

## Line endings (`tokenizer`)

XML 1.0 §2.11 turns CRLF, and a CR not followed by LF, into LF before anything else. XML 1.1 also turns CR followed by NEL into one LF, and NEL (U+0085) and LS (U+2028) into LF; a CR there is lone only when neither LF nor NEL follows it. In XML 1.1, a NEL or LS inside the XML or text declaration is a fatal error.

Attribute-value normalization (§3.3.3) then makes each whitespace character a space, including those in an entity's replacement text. Only a character reference keeps a tab, LF or CR. So `a="x` CR LF `y"` becomes `x y` with one space: the CRLF counts as a single character.

**What the Java parsers do.** All three normalize while scanning, in the same per-character loop that finds delimiters, and all three handle attribute values in that same step, so CRLF becomes one space:

- the JDK's Xerces rewrites the decoded `char[]` in place;
- Woodstox rewrites a lone CR in place and copies text that contains a CRLF;
- Aalto copies text out and normalizes as it copies.

At a buffer boundary:

- Xerces keeps one character of lookahead;
- Woodstox reads ahead into the next buffer;
- Aalto's non-blocking parser stores a pending CR and resolves it when the next chunk arrives.

**What exemplar does.** JavaScript strings are immutable and exemplar's values are slices, so there is nothing to rewrite in place. Instead:

- The scanning loops stop at CR, as they stop at every character that needs attention, and mark the value they are in. Values without CR pay nothing.
- A marked value is normalized when it is read.
- Offsets and columns stay true to the source, as in Woodstox and Aalto.
- When text is delivered in pieces, a token that ends at a CR at the end of one piece is rescanned once the next arrives, so a CR LF split between pieces still counts once. In XML 1.1 it waits for a possible NEL too.

The same CR handling applies to attribute values, comments, PI data and CDATA.

## Well-formedness

Checking is on by default. `checkWellFormedness: false` turns off the structural checks for trusted input:

- names;
- end-tag matching;
- duplicate attributes;
- references;
- `]]>`, `--` and PI targets;
- prolog order.

The character checks stay on either way: they are the same class-table lookups that find delimiters, so they cost almost nothing.

Names follow the fifth-edition `NameStartChar` and `NameChar` ranges, astral planes included. The JDK, Woodstox and Aalto still use the older Appendix B classes for XML 1.0 documents; for example, they reject U+0132 in a name.

The techniques that keep the checks cheap:

- `]]>` is looked for only when the text loop stops at `]`;
- an end tag is compared with the open tag's span character by character, with no string. The tokenizer knows that span when it read the start tag, so `</name>` is matched in the same pass that finds its end; any other end tag is scanned, then compared;
- duplicate attributes are found by comparing the names' spans pair by pair, and by a hash of the names in a tag with more than 16.

Namespace checks live in the cursor's namespace scopes and attribute collector, DTD checks in `dtd`.

## XML 1.1 (`input`, `scan`, `tokenizer`, `namespaces`)

exemplar processes both XML 1.0 and XML 1.1 documents (XML 1.1 §5.1).

- A document is XML 1.1 only when its XML declaration says `version="1.1"`. Any other `1.x` is processed as 1.0 (XML 1.0 §2.8), and a document with no declaration is 1.0.
- The document entity's version governs the whole document. A 1.1 document applies 1.1 rules to the 1.0 external entities it includes (XML 1.1 §4.3.4), and an external entity with no version is 1.0.
- An external entity whose version is later than the document's is a fatal error, as the W3C 1.1 tests expect.

In XML 1.1 documents:

- the line ends of [Line endings](#line-endings-tokenizer) apply;
- RestrictedChar (U+0001–0008, U+000B–000C, U+000E–001F, U+007F–0084 and U+0086–009F) is a fatal error when it appears literally, and legal through a character reference;
- name characters are the same as in XML 1.0 fifth edition;
- Namespaces 1.1 applies.

**Normalization checking.** XML 1.1 §2.13 asks processors to offer a check that a document is fully normalized. `checkNormalization` turns it on. It reports a document that is not fully normalized through the error handler's `warning()`, ignores denormalization caused by entities it did not read, and never changes the text.

## DTD (`dtd`)

The DTD processor:

- parses the internal subset, and the external subset when a resolver supplies it;
- expands parameter entities;
- keeps every declaration: elements with their content models, attribute lists, entities and notations.

Its output feeds three consumers:

- **the entity manager:** entity declarations;
- **the attribute pipeline:** defaults, and normalization for attributes declared with a type other than CDATA. An attribute whose declaration was not read is treated as CDATA (§3.3.3);
- **the validator:** content models, ID/IDREF and the rest.

**Modules.** `DtdParser` (`parser.ts`) reads each kind of declaration, comments, PIs and conditional sections. It reads through `DtdInput` (`input.ts`), which keeps a stack of frames, one for each subset or parameter entity being read. `DtdInput` reads characters, names, keywords and literals across those frames, expands parameter-entity references, and counts them against the limits. `content-model.ts` reads content models, `entity-value.ts` builds an entity's replacement text, and `DeclarationStore` (`store.ts`) keeps what was declared.

The declarations also reach the caller through a SAX-style declaration handler and DTD handler, and through the `DTD` event. On the cursor, `doctype()` gives the general entities and notations declared, and the processing instructions in the DTD, which StAX has no event for; the second canonical form needs both.

After a reference to a parameter entity it does not read, the processor stops applying entity and attribute-list declarations, unless the document is `standalone="yes"` (§5.1). A parameter entity that is not read reads as a space, so a declaration that needs its text to be complete, such as `<!ELEMENT a %m;>`, or a conditional section whose keyword it holds, is a fatal error, as in Xerces and libxml2.

Each attribute reports whether it was specified in the tag or defaulted from the DTD (the Infoset `[specified]` property), and its declared type; an enumeration reports `NMTOKEN`, as SAX does. A start tag whose element has declared attributes, or whose values refer to entities, is read into a list of strings; any other start tag is read from spans of the buffer.

An entity's replacement text is tokenized again at each reference, by a tokenizer kept from the last entity that ended, so a reference allocates almost nothing. Replacement text without `<` or `&` is not tokenized at all: it becomes one CHARACTERS event. The boundaries are kept for limits, locations and `reportEntityBoundaries`.

**Speed.** Reading the DocBook 4.5 DTD, about 12,000 lines in nine modules plus its entity sets, takes about 9 ms. A location needs the start of its line, so the parser finds one only for an error, and finds an external entity's line starts once, the first time. The parser keeps the frame being read in a field, and builds each attribute declaration in the order of `AttributeDeclaration`'s properties, so that every one shares a hidden class.

**Entity boundaries.** With `reportEntityBoundaries`, the cursor reports each expansion in content between a `START_ENTITY` and an `END_ENTITY` event, whose `name()` is the entity's. They are numbered 258 and 259, beyond StAX's constants and beside `NEED_INPUT`. The cursor queues each start and end where it tells SAX's listener of them, and reports them before the event that follows, or before the error that follows. An `END_ENTITY` is located where its reference ends, in the text that referred to the entity. Coalescing does not merge text across them. Entities in attribute values are not reported, as in SAX. SAX, the DOM and canonicalization turn the option off for the cursors they read, since SAX's `startEntity` and `endEntity` and the DOM's entity reference nodes already show the same. The event writer passes over the two events and writes what the entity expanded to. With the option off, the cursor checks one field per event.

## Entities (`entities`)

**Expansion.** When `replaceEntityReferences` is on, the entity manager expands general entities. When it is off, each reference becomes an entity-reference event, as in StAX.

**Undeclared and unread entities.**

- The WFC "Entity Declared" (§4.1) makes a reference to an undeclared entity a fatal error in a document with no DTD, with only an internal subset that has no parameter-entity references, or with `standalone="yes"`. It covers references outside the external subset and parameter entities. Under `standalone="yes"`, a declaration that sits in the external subset or a parameter entity does not count. The five predefined entities need no declaration.
- Elsewhere an undeclared reference is a validity error (VC "Entity Declared"). exemplar reports it to the error handler and reports the reference as a skipped entity.
- A declared external entity that no resolver supplies is also reported as a skipped entity, because a non-validating processor must tell the application it recognized the entity but did not read it (§4.4.3). When validating, it is skipped the same way, as [Conformance](#conformance) says.
- In attribute values, a reference to an entity whose declaration was not read is an error (§3.3.3), and a reference to an external entity is a fatal error (WFC "No External Entity References"). A reference to an unparsed entity is a fatal error anywhere (WFC "Parsed Entity").

**Resolvers.** These are called with the entity's name, public id, system id and base URI, as SAX's `EntityResolver2.resolveEntity` is.

- Another resolver call supplies an external subset to a document that has none, as `EntityResolver2.getExternalSubset` does.
- Resolvers may return bytes, a string or a stream. In async readers they may return a promise; the sync readers need a resolver that answers at once, so the fetch resolver works only with async readers.
- The caller's entity or URI resolver is asked first. If it returns nothing, the [catalog resolver](#catalogs-catalog) is asked, as in the JDK.
- `@exemplarjs/xml/resolvers` provides a fetch resolver, and `@exemplarjs/xml/resolvers/file` a file resolver confined to a root directory (Node, Deno and Bun).
- A URI resolver, as in JAXP, resolves XInclude targets and other URIs. The catalog resolver serves as both kinds.
- Relative system ids and URIs resolve against the base URI defined by XML Base.
- A map of name to replacement text covers entities known in advance, such as ISO entity sets.

**Access control.** `accessExternalDTD` and `accessExternalEntities` list the protocols external reads may use, such as `'file'` or `'https'`. The default is none, so nothing is fetched that the caller has not allowed.

- The caller's resolver is asked first, whatever the lists say, as the JDK uses what an `EntityResolver` supplies: a resolver that answers from its own store needs no access. The request carries the list that applies as `access`, and the bundled `fileResolver` and `fetchResolver` keep to it, as any resolver that reads by URI should.
- What exemplar reads itself, through a catalog, is checked against the URI the catalog maps the reference to, since that is what is read.
- A read the list refuses is an `ACCESS_REFUSED` error. It is recoverable: without an error handler it throws and ends the document, as the JDK's refusal does, and with one the document goes on without what was refused. An XInclude target that is refused is a resource error, which a fallback answers.
- A system id that cannot be made absolute passes only `'all'`.
- External parameter entities belong to the DTD, so `accessExternalDTD` governs them, as in the JDK. `accessExternalEntities` governs external general entities and XInclude targets.
- What is not read is skipped: an external subset, a parameter entity, which stops later declarations as §5.1 says, and a general entity, which is reported as a skipped entity.

**Limits** take their defaults from the JDK, whose defaults JDK 24 tightened (JDK-8343004), and are named for what they count. The limits are checked as expansion happens, not afterwards.

| Limit                  | JDK property                          | Default | JDK 21 default | Counts                                      |
| ---------------------- | ------------------------------------- | ------- | -------------- | ------------------------------------------- |
| `entityExpansions`     | `jdk.xml.entityExpansionLimit`        | 2,500   | 64,000         | Entity expansions per document              |
| `totalEntitySize`      | `jdk.xml.totalEntitySizeLimit`        | 100,000 | 50,000,000     | Characters expansions produce, as below     |
| `generalEntitySize`    | `jdk.xml.maxGeneralEntitySizeLimit`   | 100,000 | no limit       | Characters in one general entity            |
| `parameterEntitySize`  | `jdk.xml.maxParameterEntitySizeLimit` | 15,000  | 1,000,000      | Characters in one internal parameter entity |
| `entityReferenceNodes` | `jdk.xml.entityReplacementLimit`      | 100,000 | 3,000,000      | Events produced inside entities             |
| `attributesPerElement` | `jdk.xml.elementAttributeLimit`       | 200     | 10,000         | Attributes on one element                   |
| `elementDepth`         | `jdk.xml.maxElementDepth`             | 100     | no limit       | Element nesting                             |
| `nameLength`           | `jdk.xml.maxXMLNameLimit`             | 1,000   | 1,000          | Characters in one name                      |

The entity limits count what JDK 24 counts:

- every expansion counts toward `entityExpansions`, external entities included;
- an external parameter entity, such as a DTD module, counts only there;
- an external general entity counts toward `generalEntitySize` as it is read, and toward `totalEntitySize` at each reference;
- a parameter entity referred to inside a declaration counts toward `parameterEntitySize` but not `totalEntitySize`. One between declarations or in an entity value counts toward both.

So reading the DocBook 4.5 DTD needs only `entityExpansions` raised, as in JDK 24. Inside declarations, `entityExpansions` and `parameterEntitySize` together bound the text expanded: by default, 2,500 expansions of up to 15,000 characters each, as in the JDK.

Exceeding a limit throws `XMLError` and stops parsing, as a fatal error does. The specification sets no limits; these are exemplar's, as in the JDK.

## Namespaces (`namespaces`)

Namespace processing is on by default. Namespaces 1.0 applies to XML 1.0 documents, and Namespaces 1.1 to XML 1.1 documents.

- **When on:**
  - element and attribute names, including those in DTD declarations, must be QNames;
  - entity names, PI targets and notation names must contain no colon;
  - every prefix used must be bound, except `xml` and `xmlns`;
  - `xml` may be bound only to its own namespace name, which no other prefix may use and which cannot be the default namespace. `xmlns` may not be declared, its namespace name may not be bound, and no element may have the prefix `xmlns`. Other names beginning with `xml` are accepted;
  - Namespaces 1.0 forbids undeclaring a prefix (`xmlns:p=""`), and 1.1 allows it;
  - namespace names compare as exact strings, and attributes must be unique by expanded name.
- **When off**, names are plain XML names, so several colons are allowed and no prefix checks run.

When validating, the validator also reports colons in values of type ID, IDREF, IDREFS, ENTITY, ENTITIES and NOTATION.

Each element and attribute exposes its prefix, local name and namespace URI separately.

Namespace declarations reach the caller in two ways:

- as namespace accessors on the cursor, StAX's `getNamespaceCount`, `getNamespacePrefix` and `getNamespaceURI`;
- as start- and end-prefix-mapping events in the push API.

`xmlns` attributes appear among the attributes only when `namespacePrefixes` is on, as with SAX's `namespace-prefixes` feature. The cursor puts them in `http://www.w3.org/2000/xmlns/`. SAX, as SAX2 and the JDK do, gives them no namespace URI and no local name unless its `xmlns-uris` feature is on.

**Scopes.** A start tag with no attributes and no prefix needs no namespace work: its namespace is the default one in force. The cursor saves the scope only for an element that declares namespaces, and restores it when that element ends.

## Validation (`validation`)

A DTD validator comes from `@exemplarjs/validation` and is passed to the factory as `validator`. It checks every validity constraint in XML 1.0 and 1.1:

- content models, compiled to automata;
- attribute types and defaults;
- ID, IDREF and IDREFS;
- ENTITY and NOTATION attributes;
- the `standalone` constraints;
- the declarations themselves: unique element types and notations, one ID and one NOTATION attribute per element type, defaults that fit their types, `xml:space` declared only as an enumeration of `default` and `preserve` (§2.10), and declarations, groups and conditional sections that start and end in the same parameter entity;
- under Namespaces, no colons in ID, IDREF, ENTITY and NOTATION values.

**How it runs.** The cursor calls the validator inside its own `next()`, before any filter, with a context that gives it the declarations, the start tag's attributes and the document's `standalone` value. The cursor knows the validator only by this interface, so the validator loads only when imported. With `replaceEntityReferences` off, the cursor still expands each reference for the validator alone, which sees its content as if it were expanded, while the caller sees only the entity-reference event. With one present, the cursor lists every start tag's attributes, namespace declarations included, as it does for elements the DTD declares attributes for. The DTD parser reports the constraints that need its view of parameter entities as it reads; the validator checks the rest of the declarations once the DTD has been read, and IDREFs once the document ends.

**Content models** become Glushkov position automata, made deterministic as children arrive: each state is a set of positions, and each transition by element name is worked out once and kept.

Violations go to the error handler as errors with `VC_` codes. The validator also marks whitespace in element content, which the event APIs report as ignorable whitespace (StAX `SPACE`, SAX `ignorableWhitespace`).

## `xml:id` (`cursor`)

An `xml:id` attribute is always treated as type ID. Its value is normalized as an ID value is, with leading and trailing spaces removed and runs of spaces collapsed, even when it is undeclared, and the normalized value is what the caller reads.

- The value must be an NCName for the document's XML version, and a declaration of `xml:id` must give type ID. Duplicate values break the recommendation's uniqueness rule, which covers every ID: an `xml:id` that repeats a declared ID is an error, either way round. Declared IDs that repeat each other are left to validation, so that a non-validating parser still accepts invalid documents.
- Each violation is an `xml:id` error. Such errors are not fatal: they go to the error handler's `error()`, as validity errors do, so the default handler throws and a caller's handler can let parsing continue.
- IDs reach the caller as attributes of type ID, so the DOM's `getElementById` and XInclude's shorthand pointers find them.
- `xml:id` is the `id` attribute in the XML namespace, so a reader that is not namespace-aware treats it as an ordinary attribute.
- The cursor finds `xml:id` while it sorts out a start tag's namespaces, and keeps its normalized value beside the tag's other attributes, so a document full of IDs is read as fast as one without.

## XML Base (`util`)

Base URIs follow XML Base second edition:

- an entity's base URI is the URI it was read from;
- an element's base URI is its `xml:base` resolved against its parent's, or else its parent's, or else that of the entity it sits in, so content from an external entity takes that entity's URI;
- text, attributes and PIs use the base URI of their element. An `xml:base` value itself resolves against the parent element's;
- `xml:base=""` resolves like any other relative reference, and does not reset to the document's base;
- `xml:base` is a LEIRI: it is escaped before it is resolved, and base URIs are reported unescaped.

Resolvers, XInclude, catalogs and the DOM's `baseURI` resolve relative references this way, through one helper.

## Readers (`cursor`, `events`, `sax`, `filters`)

**The cursor** is the core. Every other API is built on it: push costs the same as pull within 3% when the cursor is asked for what SAX reports, and event objects cost a third more (see [Measured costs](#measured-costs) below).

- It follows StAX's `XMLStreamReader`: `next()`, an event kind, and accessors for names, attributes, text, namespaces, the target and data of PIs, and the declared version, encoding and standalone values.
- Values are sliced on demand: element and attribute names, attribute values, text, and namespace URIs and prefixes, which are kept as spans of the source until asked for. Text is decoded and normalized only when read; plain text, with no line ends to normalize, references or copying, is sliced in `text()` itself. At a start tag, `localName()` slices the local name from the tag the tokenizer still holds. A name or namespace URI whose text the buffer is about to drop is sliced first.
- **Copying.** Slices of 13 or more characters keep their source chunk alive. Event objects therefore copy their values, and `copyStrings` makes the cursor's accessors copy too. A copy appends a character and slices it off again, which makes V8 flatten the string into memory of its own.

**The async cursor** has the same accessors. Its `next()` returns at once while input is buffered. When it needs more input it returns `NEED_INPUT`, and the caller awaits `fill()`, as with Aalto's `EVENT_INCOMPLETE` and Jackson's `NOT_AVAILABLE`.

- **Types.** `createAsyncStreamReader()` returns an `AsyncStreamReader`, with `fill()`, `feed()` and `endOfInput()`. `createStreamReader()` returns a `StreamReader`, whose type has none of them and whose `next()` never returns `NEED_INPUT`. Both are one class at run time, so code that reads either stays monomorphic.
- Its event type starts as `NEED_INPUT`, and `next()` reports `START_DOCUMENT` once the XML declaration has been read, as Aalto's does.
- A reader created without a source is fed by the caller with `feed(chunk)` and `endOfInput()`, like Aalto's non-blocking feeder. Its `fill()` resolves at the next `feed` or `endOfInput`.
- **Waiting.** A second `next()` after `NEED_INPUT`, with no `fill()`, `feed()` or first `endOfInput()` between, throws, rather than return `NEED_INPUT` for ever to a loop that forgot to wait. The check sits where `NEED_INPUT` is returned, so events pay nothing for it.
- **Helpers.** `nextTag()` and `elementText()` cannot wait, so they throw at `NEED_INPUT`; `nextTagAsync()` and `elementTextAsync()` await input as they go, at a promise per call. `forEachEvent(handle)` calls a function for every event and awaits input between chunks, for callers who want one loop without `NEED_INPUT`.
- **Rescanning.** A token cut off by the end of the buffer is scanned again once the buffer has doubled, or once a new chunk brings a character that could end it: `>` for markup, `<`, `&` or `;` for text. Feeding a 200 KB text node a byte at a time therefore stays linear, and events still come out as soon as they are complete. The test looks at each chunk, not the buffer, because reading the buffer would make V8 flatten it on every append.
- **Resolvers.** A resolver may answer with a promise, or with a source that has a stream. `next()` then returns `NEED_INPUT`, `fill()` waits for the answer, which is read in full, and the token is processed again. An answer is kept by request, so no resolver is asked twice. The DTD is read again from its start after each answer, its recoverable errors held back until it has been read in full.
- The async event reader and web `ReadableStream`s of events are built on it. The event reader can be iterated per event, at a promise per event, or per chunk through `batches()`.

**The event reader** follows StAX's `XMLEventReader`: event objects with one hidden class, plus `peek()`, `nextTag()` and `elementText()`.

- One class serves every kind of event; switching on `type` narrows the TypeScript type.
- Element names are shared: one `QName` per name and namespace, and an end tag reuses its start tag's name and namespaces. An `Attribute` is a `QName` itself.
- **Locations** are worked out when asked for. An event keeps its offset and the line segment it falls in. As the tokenizer's line checkpoint moves forward, it records the line starts it passes in the current segment, and a new segment begins whenever the buffer drops text. An event's segment finds its line by binary search, or from the buffer while the buffer still holds the event. A segment the buffer has moved past holds no text. Events inside an entity, merged text and `END_ENTITY` have their locations found when they are built.

**The push API** follows SAX:

- a parser over a factory, whose options include the SAX features that have equivalents, such as `namespaceAware` for `namespaces`. The parser's own options are SAX's `resolve-dtd-uris` and `xmlns-uris`, as `resolveDTDURIs` and `xmlnsURIs`. There are no feature URIs or property strings;
- content, lexical, declaration, DTD and error methods, all on one handler object;
- `Attributes`, which reads the cursor directly and is valid during `startElement`, with values by index, qualified name, or namespace URI and local name;
- a locator;
- `XMLFilter` chains, through `XMLFilterImpl`.

The DTD's declarations, PIs and comments are reported between `startDTD` and `endDTD` in document order, with `startEntity` and `endEntity` around parameter entities and the external subset. The DTD parser records them as it reads. `startEntity` and `endEntity` for general entities come from a hook the cursor calls as it enters and leaves an entity, so they arrive between the events they separate.

**Pull filters** follow StAX's `StreamFilter` and `EventFilter`: a predicate applied to each event. A filter on a cursor runs inside that cursor's `next()`, as described in [Run-time structure](#run-time-structure): `createFilteredReader` adds it to the reader it is given and returns that reader. `StreamReaderDelegate` forwards every call to a parent reader, for code that overrides accessors.

**Text events** follow the source by default: text, CDATA and entity text arrive as separate events, with references already expanded. `coalescing` merges adjacent character data into one CHARACTERS event: the cursor reads one event past the run and holds it back for the next `next()`. In an async reader, a run cut off by `NEED_INPUT` is kept until it ends.

**Other events.** Comments, PIs and the DOCTYPE are events. Whitespace outside the root element is not reported unless `reportPrologWhitespace` is on.

**Locations.** Every event has a location (line, column, offset, system id), computed only when asked for. It is where the event starts, as in Woodstox and Aalto; the JDK reports where it ends. An `END_ENTITY` is where its reference ends.

- Each event records only its offset. Lines are counted when a location is asked for, from a checkpoint that only moves forward, by finding line feeds and lone CRs with `indexOf`; XML 1.1 documents also count NEL and LS, a character at a time.
- Before the buffer drops text, the checkpoint moves past it, so a long stream is counted once in all.
- The column is the distance from the line start.
- Errors always carry the location.

### Measured costs

Each style read every name, attribute and text from 64 KB chunks, measured against the cursor:

| Style                                   | FreeBSD documentation | XMark  |
| --------------------------------------- | --------------------- | ------ |
| The cursor                              | 238 ms                | 734 ms |
| The cursor, asking for what SAX reports | +3%                   | +7%    |
| One filter on the cursor                | +1%                   | +2%    |
| Four filters                            | +1%                   | +2%    |
| A forwarding delegate                   | +1%                   | +2%    |
| SAX                                     | +6%                   | +7%    |
| SAX, one `XMLFilterImpl`                | +16%                  | +12%   |
| SAX, four `XMLFilterImpl`s              | +25%                  | +23%   |
| Event objects                           | +32%                  | +35%   |
| The async cursor                        | 0%                    | −1%    |
| The async cursor, `forEachEvent`        | +2%                   | +3%    |
| Async event objects, per chunk          | +35%                  | +36%   |
| Async event objects, per event          | +50%                  | +81%   |
| Async SAX                               | +6%                   | +8%    |

SAX is measured with a handler that reads what the cursor reads; it is handed the namespace URI, local name and qualified name of every start and end tag besides.

## Tree (`dom`)

The tree model is DOM Level 3 Core, the model the JDK's `org.w3c.dom` implements. It has every node type, including:

- entity-reference nodes, when `replaceEntityReferences` is off;
- a document type holding the DTD's entities and notations;
- the Infoset properties the parser knows: whether an attribute was specified, whether text is whitespace in element content, attribute types, and base URIs.

**Building.** `DocumentBuilder` builds a tree from a cursor of its own, so every reader option applies, XInclude and validation included; pull filters do not. It plays the part of JAXP's `DocumentBuilder`, and adds the two options JAXP's factory has that the reader does not: `ignoringComments` and `ignoringElementContentWhitespace`. The reader options keep their meaning:

- with `replaceEntityReferences` off, each reference becomes a read-only node holding its expansion, as JAXP's `expandEntityReferences: false` does; references the parser does not read stay empty;
- `coalescing` turns CDATA sections into text joined to the text beside them, as JAXP's does.

The DTD fills in the rest:

- an entity node holds its replacement text: text at once, and markup copied from its first expansion;
- attribute declarations give attributes their type and their ID-ness, and give elements their defaults. `createElement` adds the defaults, and removing a defaulted attribute brings back its default;
- element declarations mark whitespace in element content, with or without validation, as Xerces does.

**Level 3.** `domConfig` holds the parameters `normalizeDocument` follows. Its namespace fix-up is the one in Appendix B.1, with generated prefixes `NS1`, `NS2` and so on. Of the optional values it supports `check-character-normalization`, `normalize-characters`, and turning off `element-content-whitespace`, `namespaces` and `well-formed`. It leaves out what needs a schema (`datatype-normalization`, `validate`, `validate-if-schema`), and `canonical-form`, which `@exemplarjs/canonical` covers. The default error handler lets normalization go on past errors.

Base URIs follow XML Base. Elements, processing instructions, documents, entities, notations and entity references have one; other nodes give null. `textContent` leaves out whitespace in element content, as Level 3 says. Names are checked by XML 1.0 Fifth Edition, as the parser checks them.

Where the recommendations leave behaviour open, the tree does what the JDK's does: which exception wins when several apply, how `compareDocumentPosition` orders attributes, entities and notations, where `setAttributeNS` puts an attribute whose qualified name another attribute has, and what `replaceWholeText` may remove.

**Saving.** The writer serializes any tree or subtree, declaring namespaces the tree uses but does not declare.

**Browser-style entry points.** `DOMParser.parseFromString(text, 'application/xml')` and `XMLSerializer.serializeToString(node)` let code written for browsers run unchanged. As in Firefox, `parseFromString` returns a document holding a `parsererror` element when the input is not well-formed, instead of throwing. `XMLSerializer` writes no XML declaration. Nodes also have the WHATWG DOM's `remove()`, beside Level 3's `removeChild`.

**Storage.** Nodes are linked: each holds its parent, siblings and, if it can hold children, its first and last child. The nodes keep their fields few, as Node runs V8 without pointer compression and every field costs 8 bytes:

- fields are declared and set once in the constructor, not as class fields;
- a node's booleans share one field of bits;
- nodes that cannot hold children, such as text, read null child links from their prototype;
- what few nodes have lives in side tables: user data, child arrays and live lists while they are in use, attribute maps, and the base URI of an element read from an external entity;
- an attribute's value stays a string until its children are asked for, and an element's attribute array is created at its final length;
- no node class on the hot path has `#private` methods, as a private brand stops V8 inlining the constructors of the class and its subclasses.

Names are not interned. On the `tree` benchmark:

| Dataset               | Build    | Retained |
| --------------------- | -------- | -------- |
| FreeBSD documentation | 475 ms   | 313 MB   |
| XMark                 | 1,031 ms | 715 MB   |

**Lists.** `childNodes`, `attributes`, and a document type's `entities` and `notations` hold their nodes as their own index properties, so `list[i]` reads as fast as an array. A change at the end of a child list updates it. Any other change drops its index properties and puts a Proxy in its prototype chain, which copies the children back at the next read, so a run of changes copies them once. Until that read, what lists only the list's own keys sees no indexes: `Object.keys`, `Object.values`, `Object.entries`, spreading and `for...in`. `getElementsByTagName` lists sit behind a Proxy and collect again when the document has changed.

**Modules.** `src/nodes` holds one file per node class, beside helpers that use the classes only as types: `lists.ts`, `tree.ts`, `order.ts`, `namespaces.ts` and `features.ts`. Each class's file imports its base class, and `node.ts` imports no subclass, so the files load in any order: a `node.ts` that imported one would run that subclass's `extends Node` before `Node` exists.

**Left out:** mutation events, and the WHATWG DOM's other additions, such as `append()` and `children`.

## XInclude (`xinclude`)

XInclude processing is a filter. The caller creates an XInclude processor with `xincludeProcessor()` from `@exemplarjs/xinclude` and passes it to the factory as `xinclude`, which switches it on as JAXP's `setXIncludeAware` does. It runs in both the pull and push pipelines.

When it meets an `xi:include` element:

- it resolves `href` against the element's base URI, after escaping it as XML 1.1 §4.2.2 describes, through the URI resolver, then the entity resolver, then catalogs, under the same `accessExternal*` rules as entities;
- it parses the target with the same configuration, XInclude included;
- for the duration of the inclusion, the shared cursor carries the included document's events. A whole document contributes every child except its DOCTYPE, so its top-level comments and PIs come too.

A pointer into another document selects from that document after its own inclusions have been processed, as XInclude §4.5.2 requires. A pointer into the including document selects from its source, and the inclusions in what it selects are then processed.

In an asynchronous reader, a resolver may answer with a promise or a stream, and the reader waits for it as it waits for input; a stream is read whole. Included documents are read by asynchronous readers too, so their DTDs and entities may come from such resolvers. A synchronous reader given a promise or a stream throws a `TypeError`, as the cursor does for a DTD or an entity, rather than falling back.

What it supports:

- `parse="xml"` and `parse="text"`. For text, the encoding comes from an encoding supplied from outside, such as an HTTP charset, then from XML's rules when the bytes begin as an XML document does, then from the `encoding` attribute, and otherwise is UTF-8, or UTF-16 after a UTF-16 BOM. UTF-16 takes its byte order from the BOM. A leading BOM is dropped, unless the encoding's name gives its byte order, as `UTF-16LE` does, where U+FEFF is a character. Bytes illegal in the encoding, and characters XML does not allow, are fatal errors;
- `xi:fallback`;
- the `accept` and `accept-language` attributes, passed to the resolver in the `ResolveRequest` as `accept` and `acceptLanguage`. `fetchResolver` sends them as the HTTP `Accept` and `Accept-Language` headers;
- pointers through the XPointer framework, with the `element()` scheme and shorthand pointers. Parts are tried left to right, and the first that identifies something wins; a part in a scheme exemplar does not support is skipped. Shorthand pointers find IDs from the DTD declarations exemplar has read and from `xml:id`.

The `xpointer()` scheme needs XPath, which exemplar does not have.

**Errors.** A resource error falls back to `xi:fallback`, and without a fallback it is fatal. A resource error is a resource that cannot be read, a protocol `accessExternal*` does not allow, an encoding exemplar cannot decode for `parse="text"`, or a pointer that identifies nothing. Every other XInclude error is fatal, including:

- an inclusion loop. Acquiring another document processes all of it, so a reference to any document in the chain of inclusions is a loop, whatever its pointer. A reference into the including document is a loop when the same pointer is already in the chain. The check runs before the resource is read. Including the current document as text is not a loop;
- an included resource that is not well-formed;
- an `href` with a fragment identifier, or with a `%` that does not begin an escape of two hex digits; `parse="xml"` with neither `href` nor `xpointer`; `xpointer` with `parse="text"`; a `parse` value other than `xml` or `text`;
- `accept` or `accept-language` values with characters outside U+0020–U+007E;
- an `xi:include` holding another `xi:include`, more than one `xi:fallback`, or another element in the XInclude namespace, and an `xi:fallback` outside an `xi:include`. Errors inside a fallback that is not used are not reported;
- a pointer that selects an attribute or a namespace node;
- replacing the document element with anything but comments, PIs and exactly one element. Whitespace beside it, a CDATA section of whitespace included, is prolog whitespace, as in Xerces: reported as `SPACE` with `reportPrologWhitespace` and otherwise dropped. A missing text resource at the root falls back like any other; text that is read is the error. An included document's own top-level whitespace is dropped inside elements.

Unknown attributes without a prefix on `xi:include` and `xi:fallback` are ignored.

**Fix-ups.** Unless the caller turns them off with `xincludeProcessor({ fixupBaseURIs: false, fixupLanguage: false })`, included top-level elements get:

- `xml:base` where their base URI differs from the include parent's, replacing any `xml:base` they had;
- `xml:lang` where their language differs from the include parent's, compared case-insensitively. An item with no language under a parent that has one gets `xml:lang=""`.

Included content keeps its in-scope namespaces: a subtree that a pointer selects re-declares the prefixes bound on the ancestors it leaves behind.

A pointer that is not well-formed, and a part in the `element()` scheme whose data is not well-formed, identify nothing, so they are resource errors.

**Entities and IDs.** Unparsed entities and notations that included content names in `ENTITY`, `ENTITIES` and `NOTATION` attributes are added to the result, with duplicates merged. Two declarations with the same name and different public identifiers, system identifiers once resolved against their base URIs, or notations are a fatal error. The DOM adds them to the document type, making one if the document has none. SAX reports them to the DTD handler just before the start tag of the element that names them. Each document's IDs, IDREFs and `xml:id` values are checked within that document, so the result may hold the same ID twice.

**Streaming.** XInclude streams and buffers nothing. A pointer into another document skips that document's events up to its target, then passes the target's subtree through. Two cases need content that has already gone past, so XInclude reads the document again for them:

- an intra-document reference, with no `href` or an empty one, selects from the whole including document. XInclude reads the document again from the text or bytes it was given, or else through the resolvers by its URI. A document that is a stream with no URI cannot be read again, which is a resource error;
- a pointer with several parts, whose later part identifies an element before the point where an earlier part fails. XInclude notes the element's child sequence and reads the document again to give it.

## Catalogs (`catalog`)

The catalog resolver implements OASIS XML Catalogs 1.1. The caller creates one with `catalogResolver({ files, prefer, defer, resolve, read })` from `@exemplarjs/catalog` and passes it to the factory as `catalog`. It handles every entry type:

- `public`, `system`, `rewriteSystem`, `systemSuffix` and `delegatePublic`/`delegateSystem`;
- `uri`, `rewriteURI`, `uriSuffix` and `delegateURI`;
- `nextCatalog` and `group`;
- the `prefer` setting, `xml:base`, and `urn:publicid:` unwrapping.

Matching follows the specification:

- in each catalog file, system entries come before rewrites, rewrites before suffixes, and those before system delegation, then public entries and public delegation. A public entry counts beside a system identifier only where `prefer` is `public`;
- the first matching system, public or uri entry wins, and the longest matching rewrite or suffix, the first of equals;
- delegation searches every matching delegated catalog, longest match first, with their nextCatalog files, and only those. A delegation that finds nothing ends the search;
- `nextCatalog` files are searched straight after the file that names them, in order, once that file has no match;
- the result is not resolved again (§5.3);
- public identifiers are normalized, and system identifiers and URIs are %-escaped the same way, on both sides of every comparison. A `urn:publicid:` system identifier or URI stands for the public identifier it unwraps to, and one that differs from a public identifier also given is dropped;
- a relative system identifier or URI is tried as written, then made absolute against the base URI, as §7.1.1 and §7.2.1 suggest. For an external identifier, the try as written looks only at system entries, so a matching system entry wins over a public one whichever way it matches. A URI's fragment identifier takes no part in matching (§4.3);
- a catalog file that cannot be read, is not well-formed, or is not a catalog is ignored (§8). So are elements in other namespaces, with their content, unknown elements in the catalog namespace, and entries missing a required attribute;
- a lookup that finds nothing in its own kind of entry, in any catalog file, then tries the other kind, as the JDK does: a URI the system entries, and a system identifier the uri entries. Every answer the specification gives therefore stands;
- a catalog file that leads back to itself through nextCatalog or delegation is a fatal error, `CATALOG_CIRCULAR`.

Its configuration follows `javax.xml.catalog`:

| Setting   | Default     | Meaning                                                                                                                                                                                                                                    |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `files`   | none        | The catalog files to search, as absolute URIs                                                                                                                                                                                              |
| `prefer`  | `public`    | Whether public entries are consulted when the document also gives a system identifier. A matching system entry always wins.                                                                                                                |
| `defer`   | `true`      | Read a delegated or next catalog only when it is needed. With `false`, every catalog the files lead to is read when the resolver is created.                                                                                               |
| `resolve` | `strict`    | What happens when nothing matches: a fatal error, `CATALOG_NO_MATCH`, at the reference under `strict`; under `continue` the parser carries on as if no catalog were set; under `ignore` an entity resolves to empty content, as in the JDK |
| `read`    | local files | Reads catalog files and the resources they map to. The default reads `file:` URIs where the runtime has a file system, as Node, Deno and Bun do                                                                                            |

It is asked after the caller's own entity or URI resolver, as in the JDK. When it maps a reference:

- the access list is checked against the URI it maps to;
- the caller's resolver is asked again, for that URI, and the catalog's `read` reads it if the resolver supplies nothing.

It serves:

- DTDs and external entities, through its external-identifier entries;
- XInclude targets, through its URI entries, then its system entries. A target nothing matches is a resource error under `continue` and `ignore`, so the fallback applies.

The resolver can also be passed as `entityResolver` or `uriResolver` itself; then it reads what it maps to with `read` and checks no access list. It reads each catalog file once, and remembers each answer. Catalog files are parsed by exemplar itself, with external access off.

**Left out:** the `<?oasis-xml-catalog?>` processing instruction (§5.1), which the JDK leaves out too.

**The JDK's differences.** The differential found these in `javax.xml.catalog`, each listed in `known-differences.json`:

- it delegates to only the catalog with the longest match, does not search that catalog's nextCatalog files, and goes on to the remaining catalogs when a delegation finds nothing, where §7.1.2 does neither;
- a group's `prefer="public"` cannot override its catalog's `prefer="system"`, against §4.1.1;
- after an element in another namespace, it ignores every later entry in the file, where §6 ignores only that element's content;
- it rejects a relative `xml:base`, which XML Base resolves;
- it tries both kinds of entry in each catalog file before the next, where exemplar tries a lookup's own kind in every file first;
- it fails on unknown elements in the catalog namespace and on entries missing a required attribute, which the recommendation says nothing of and exemplar ignores;
- it tries a relative reference only as written.

## Writer (`writer`)

The writer has two APIs:

- **a stream writer**, following StAX's `XMLStreamWriter`;
- **an event writer**, following `XMLEventWriter`, which also accepts the event reader's events, so a filter pipeline can copy a document.

**Modules.** `StreamWriter` (`stream-writer.ts`) keeps where the document is and writes its markup. `Output` (`output.ts`) gathers what it writes into chunks and encodes them for a byte sink. `NamespaceBindings` (`namespaces.ts`) keeps the bindings in scope, and `ContextNode` (`context-node.ts`) the element whose start tag is being written, with its attributes for the duplicate and binding checks. `escape.ts` escapes text and attribute values and writes CDATA sections, and `names.ts` checks names and builds qualified ones. `EventWriter` (`event-writer.ts`) writes events through a stream writer, and `node.ts` writes DOM nodes.

**Output** goes to a sink:

- string chunks of about 64 K characters, each gathered as an array of pieces and joined once;
- or bytes, through an encoder per chunk: UTF-8, UTF-16 in either byte order (`UTF-16` itself big-endian with a byte order mark), and every single-byte encoding the reader decodes.

A one-string result is a sink that joins at the end. A web `WritableStream` takes the byte chunks as they come, and `close()` resolves once it has taken them all. The writes themselves are synchronous, so `drain()` resolves when the stream has room again, as its writer's `ready` does; a long run of writes awaits it now and then to keep a slow stream from queuing the whole document, and the event writer awaits it after each batch it copies.

**Escaping** is round-trip safe by default: `&`, `<` and `>` in text, `&`, `<` and `"` in attribute values, tab, LF and CR in attribute values, and CR in text, are written as references, so re-parsing returns exactly what was written.

- A minimal mode escapes only what XML requires: `&` and `<`, `]]>` in text, and `"` in attribute values.
- In an XML 1.1 document the restricted characters, and NEL and LS, which re-reading would turn into line ends, are written as references.
- A character the output encoding lacks is written as a reference in text and attribute values, and between CDATA sections inside one. In a name, comment, PI or DOCTYPE it is a `WRITE_ENCODING` error, thrown by the write that holds it.

**Checks** cover names, characters, `--`, `?>` and `]]>` in their places, one root element, text outside it, attributes after content, duplicate attributes and prefix bindings. They are on by default and can be switched off. End tags need no checking: `writeEndElement` closes the innermost open element. An element that ends straight after its start tag is written as an empty-element tag. They also refuse the reserved `xml` and `xmlns` prefixes and namespaces anywhere else, an XML declaration that is not first, an entity reference that is not an NCName, or that names anything but the five predefined entities when no DOCTYPE has been written, and an encoding declaration that differs from a byte sink's encoding. Whatever the checks, a write first closes a start tag left open, and text outside the root element is escaped.

**Namespaces.** The caller declares namespaces, or switches on repairing mode (StAX `IS_REPAIRING_NAMESPACES`), in which the writer adds the declarations that are needed, generating `ns1`, `ns2` and so on for attributes whose URI has no prefix. `setPrefix` binds a prefix for lookups without declaring it, as in StAX. An `xmlns` or `xmlns:p` attribute written with `writeAttribute` is a declaration, as if written with `writeDefaultNamespace` or `writeNamespace`. `writeStartElement(localName)` names no namespace, so the element takes the default namespace in scope once its declarations are written, as in the JDK; `writeStartElement('', localName, '')` puts it in no namespace. Elements and attributes can also be named with a `QName`, as the event API names them, which avoids StAX's differing argument orders: `writeStartElement(prefix, localName, namespaceURI)` but `writeAttribute(prefix, namespaceURI, localName, value)`. With `namespaceAware: false`, names are written as given, colons included, with no namespace bookkeeping, so a document read without namespaces can be copied.

**Indentation** adds whitespace only where it would sit beside no text: once an element holds text, nothing is added inside it or its descendants until it ends, as the XSLT and XQuery serialization rules require.

**Options** live on the output factory and follow the JAXP serializer's output properties:

| Option                           | Default       | Java equivalent                                                                 |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `indent`                         | none          | `OutputKeys.INDENT`, with the indent string                                     |
| `namespaceAware`                 | `true`        | (none) Off writes names as given, with no namespace processing                  |
| `repairNamespaces`               | `false`       | StAX `IS_REPAIRING_NAMESPACES`                                                  |
| `escaping`                       | `'roundTrip'` | (none) `'minimal'` escapes only what XML requires                               |
| `checkWellFormedness`            | `true`        | (none) Off skips the checks above                                               |
| `omitXMLDeclaration`             | `false`       | `OutputKeys.OMIT_XML_DECLARATION`                                               |
| `version`                        | `'1.0'`       | `OutputKeys.VERSION`. XML 1.1 §5.1 asks for 1.0 unless a 1.1 feature is needed. |
| `doctypePublic`, `doctypeSystem` | none          | `OutputKeys.DOCTYPE_PUBLIC`, `OutputKeys.DOCTYPE_SYSTEM`                        |
| `cdataSectionElements`           | `[]`          | `OutputKeys.CDATA_SECTION_ELEMENTS`                                             |
| `encoding`                       | `'UTF-8'`     | `OutputKeys.ENCODING`. A declared encoding must match a byte sink's.            |

## Canonical forms (`canonical`)

The supported forms are:

- Canonical XML 1.0 and 1.1, with and without comments;
- Exclusive XML Canonicalization 1.0, with and without comments, and with an inclusive-namespaces prefix list, in which `#default` names the default namespace;
- the XML suite's first and second canonical forms, and their XML 1.1 variants. The second adds notation declarations.

Each is a method of `canonicalize`: `'c14n'`, `'c14n11'`, `'exc-c14n'`, `'suite-first'` and `'suite-second'`. Each writes from the cursor with its own escaping, ordering and namespace rules. For a whole document Canonical XML 1.0 and 1.1 agree; they differ only on subsets.

**Input.** Canonical XML needs the document as a validating processor sees it: attribute types, defaults and entities from the whole DTD. So canonicalization parses with the DTD, the external subset and external entities read through the caller's resolvers, defaults applied and entities expanded, and fails if it cannot read one of them. As the recommendations require, it also fails on relative namespace URIs, and on XML 1.1 documents, for which Canonical XML is not defined. Text decoded from an encoding that is not a Unicode one is put in Normalization Form C.

**Subsets.** A DOM node is canonicalized as a document subset. Inclusive canonicalization writes the in-scope namespaces of its ancestors on its top element, and carries down `xml:lang` and `xml:space` from them. Canonical XML 1.0 also carries down the other `xml:` attributes, while 1.1 joins `xml:base` values instead, as a string, with the join and dot-segment removal of C14N 1.1 §2.4. A relative namespace URI in scope at the top element is an error, as in a whole document. Exclusive canonicalization writes only the namespaces the subset uses, and carries down no `xml:` attributes. Subsets chosen by XPath are not supported, as exemplar has no XPath.

## Errors and locations (`errors`)

A fatal error throws `XMLError`. It carries:

- a stable `code`;
- the message;
- line and column, both 1-based, with columns in UTF-16 code units, as JavaScript strings count them;
- the offset in the entity's text, counting from 0 in UTF-16 code units;
- the system id of the entity where it happened, with the chain of entity references that led there. An external entity that its resolver gave no system id, and whose own cannot be made absolute, gives none.

Errors and warnings go to the error handler, carrying the same information. A fatal error reaches the error handler's `fatalError()` before it is thrown. An error that is thrown ends the document: every later `next()` throws it again, in every reader, XInclude's included (XML 1.0 §1.2). While the error handler hears of an error, the SAX locator gives the error's position, as the JDK's does.

**No stack traces.** Every error exemplar raises on purpose is built by `ErrorFactory.create`, without a stack trace: `XMLError`, the other packages' own errors, and the `TypeError`, `RangeError` and `DOMException` a misused API gets. A trace would list only exemplar's own frames, and capturing one is costly in documents that raise thousands of recoverable errors. Errors that callers build themselves, such as a resolver's `ResolutionError`, keep theirs, and so does every error on engines without `Error.stackTraceLimit`, such as Firefox's. A `catch` that handles some classes of error passes the rest on with `ErrorFactory.expect`. A test fails on any error built or rethrown another way.
