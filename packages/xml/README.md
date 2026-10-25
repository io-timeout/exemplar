# @exemplarjs/xml

The XML reader at the heart of exemplar: fast, W3C-conformant, and DTD-aware.

## Why exemplar

exemplar is a complete XML stack for JavaScript and TypeScript: the pull, push, tree and writer APIs Java developers know from StAX, SAX, DOM and JAXP, with the DTDs, entities, resolvers, catalogs and standards that real-world XML depends on. It has no dependencies and runs on Node, Deno, Bun and every modern browser.

- **Conformant, and proven.** 6,813 of the 6,816 applicable tests of the [W3C XML Conformance Test Suite](https://github.com/io-timeout/exemplar-tests/blob/main/docs/testing.md) pass, non-validating and validating, with external entities read and without. On that suite exemplar rejects 99.7% of malformed documents and produces 100% of the expected output.
- **Full DTD support.** exemplar is the only pure-JavaScript XML library with full DTD support: internal and external subsets, parameter entities, conditional sections, entity expansion, attribute defaults and types, and validation against every validity constraint, with external DTDs and entities read through your resolvers and OASIS XML Catalogs.
- **Every standard around XML.** Namespaces 1.0 and 1.1, XML 1.1, XML Base, `xml:id`, XInclude with XPointer, Canonical XML 1.0 and 1.1 and Exclusive Canonicalization, and a DOM Level 3 Core tree that passes 1,405 of the 1,532 pages of the W3C DOM Test Suite.
- **The fastest pure-JavaScript XML reader.** It tops [exemplar's benchmarks](https://github.com/io-timeout/exemplar-tests/blob/main/docs/benchmarking.md) while checking everything XML asks of a parser: on an Apple M3 Max it reads at up to 542 MB/s, builds DOM trees at up to 314 MB/s and writes at up to 551 MB/s.
- **Streams of any shape.** Strings, bytes, iterables, async iterables and web streams, in chunks of any size, down to one byte, with identical events. Async readers pay for a promise per chunk, not per event.
- **Safe by default.** External reads happen only where you allow them, entity expansion is bounded by the JDK 24 limits, and untrusted input can be read with DOCTYPEs refused outright.
- **Every encoding.** UTF-8, UTF-16 and UTF-32, GB18030, the ISO-8859 family, the Windows code pages, KOI8, Macintosh and EBCDIC are built in, and Japanese, Chinese and Korean are one import away.
- **Typed and tested.** Written in TypeScript, with over 6,000 unit and property tests at full line coverage, the W3C suites on every change, and nightly differential tests against libxml2 and Xerces.

## The packages

Every package builds on `@exemplarjs/xml` and is released at the same version, so pick the parts you need:

| Package                                                   | What it adds                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@exemplarjs/xml`                                         | The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters |
| [`@exemplarjs/sax`](../sax/README.md)                     | SAX: push handlers, lexical and declaration events, and filter chains                        |
| [`@exemplarjs/dom`](../dom/README.md)                     | A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`                  |
| [`@exemplarjs/writer`](../writer/README.md)               | Stream and event writers, to strings, bytes and web streams                                  |
| [`@exemplarjs/validation`](../validation/README.md)       | Validation against a DTD                                                                     |
| [`@exemplarjs/catalog`](../catalog/README.md)             | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/xml` reads XML in the three styles Java offers: a pull cursor like StAX's `XMLStreamReader`, event objects like StAX's `XMLEventReader`, and the foundation the push, tree and writer packages build on. It reads DTDs, expands entities, resolves external DTDs and entities through resolvers you control, and checks everything the XML recommendation asks a parser to check.

```bash
npm install @exemplarjs/xml
```

### Read with the cursor

```ts
import { EventType, XMLInputFactory } from '@exemplarjs/xml';

const xml = new XMLInputFactory();
const reader = xml.createStreamReader('<book id="b1"><title>Dune</title></book>');

for (let type = reader.next(); type !== EventType.END_DOCUMENT; type = reader.next()) {
  if (type === EventType.START_ELEMENT) console.log(reader.localName(), reader.attributeValue('', 'id'));
  else if (type === EventType.CHARACTERS) console.log(reader.text());
}
```

A source can be a string, a `Uint8Array`, an iterable or async iterable of chunks, a `ReadableStream`, or an object that adds a `systemId`, `publicId`, `baseURI` or `encoding`. Bytes are decoded as the XML specification says: byte-order mark, outside encoding, then the XML declaration.

### Read large files and streams

The async reader returns events at once while input is buffered and waits only between chunks, so a stream costs a promise per chunk, not per event:

```ts
const stream = new Blob(['<log>', '<entry level="warn">disk</entry>'.repeat(3), '</log>']).stream();
const levels: string[] = [];

await xml.createAsyncStreamReader(stream).forEachEvent((type, r) => {
  if (type === EventType.START_ELEMENT && r.localName() === 'entry') levels.push(r.attributeValue('', 'level') ?? '');
});
```

For data that arrives in pieces you don't control, such as socket messages, create the reader without a source and `feed()` it.

### Read events as objects

```ts
for (const event of xml.createEventReader('<a><b>text</b></a>')) {
  if (event.type === EventType.START_ELEMENT) console.log(event.name.localName);
}
```

### DTDs, entities and resolvers

Internal subsets are read and applied: entities expand, attribute defaults appear, and declared types normalize values. External DTDs and entities come through a resolver, and only for the protocols the access lists allow:

```ts
const dtds: Record<string, string> = {
  'http://example.com/book.dtd': '<!ENTITY publisher "ACME"><!ATTLIST book lang CDATA "en">',
};
const factory = new XMLInputFactory({
  entityResolver: { resolveEntity: ({ systemId = '' }) => ({ systemId, text: dtds[systemId] ?? '' }) },
});
const book = factory.createStreamReader('<!DOCTYPE book SYSTEM "http://example.com/book.dtd"><book>&publisher;</book>');

for (let type = book.next(); type !== EventType.END_DOCUMENT; type = book.next()) {
  if (type === EventType.START_ELEMENT) console.log(book.attributeValue('', 'lang')); // en, defaulted by the DTD
  else if (type === EventType.CHARACTERS) console.log(book.text()); // ACME, from the DTD's entity
}
```

`fileResolver({ root })` from `@exemplarjs/xml/resolvers/file` reads files below a root on Node, Deno and Bun, and `fetchResolver()` from `@exemplarjs/xml/resolvers` reads over HTTP in async readers.

### Filters

`createFilteredReader` from `@exemplarjs/xml/filters` passes on only the events a function accepts. It runs inside the reader's own `next()`, so filtering costs almost nothing.

### Untrusted and trusted input

The defaults are safe: no external access, and the entity-expansion limits of JDK 24. Refuse DTDs outright, or tighten a limit, for input from strangers:

```ts
const untrusted = new XMLInputFactory({ disallowDoctype: true, limits: { elementDepth: 64 } });
```

Every error is an `XMLError` with a stable `code`, a line, a column, an offset and a system id.

## Conformance

| Suite                      | Result                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| XML Conformance Test Suite | 6,813 of 6,816 applicable tests pass, under `standalone`, `external` and `validating`; 3 catalogue anomalies are listed       |
| DOM Conformance Test Suite | 1,405 of 1,532 test pages pass; 87 need XML Schema, and 40 are listed with reasons                                            |
| XInclude Test Suite        | 151 of 153 applicable tests pass; 21 need `xpointer()`, a live server, or an unexpanded entity, and 2 are listed with reasons |
| `xml:id` Test Suite        | 11 of 13 pass; 2 need XML Schema                                                                                              |
| Canonical XML              | The recommendations' examples that need no XPath pass under C14N 1.0 and 1.1                                                  |
| XML Catalogs               | Agrees with `javax.xml.catalog` but where the JDK departs from the OASIS specification                                        |

The XML suite also runs on Deno and Bun, and in Chromium, Firefox and WebKit.

## Performance

On an Apple M3 Max with Node 24, reading every name, attribute and text, building a tree, and writing events back out:

| Dataset                                  | `read`   | `tree`                | `write`  |
| ---------------------------------------- | -------- | --------------------- | -------- |
| FreeBSD documentation, entities expanded | 211 MB/s | 122 MB/s, 313 MB held | 172 MB/s |
| PostgreSQL documentation                 | 542 MB/s | 314 MB/s, 15 MB held  | 551 MB/s |
| OpenStack manuals                        | 190 MB/s | 114 MB/s, 46 MB held  | 139 MB/s |
| XMark, factors 0.1 and 1                 | 273 MB/s | 126 MB/s, 715 MB held | 237 MB/s |

The [benchmarks](https://github.com/io-timeout/exemplar-tests/blob/main/docs/benchmarking.md) also run nightly on a fixed Linux machine, on documents as published: internal subsets, entity references, eight encodings and all.

## See also

- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/dom`](../dom/README.md): A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`
- [`@exemplarjs/writer`](../writer/README.md): Stream and event writers, to strings, bytes and web streams
- [`@exemplarjs/validation`](../validation/README.md): Validation against a DTD
- [`@exemplarjs/catalog`](../catalog/README.md): OASIS XML Catalogs 1.1
- [`@exemplarjs/xinclude`](../xinclude/README.md): XInclude 1.0, with XPointer
- [`@exemplarjs/canonical`](../canonical/README.md): Canonical XML 1.0 and 1.1, and Exclusive Canonicalization
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
