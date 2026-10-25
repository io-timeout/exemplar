# @exemplarjs/validation

DTD validation for JavaScript: every validity constraint of XML 1.0 and 1.1, checked as you read.

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
| [`@exemplarjs/xml`](../xml/README.md)                     | The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters |
| [`@exemplarjs/sax`](../sax/README.md)                     | SAX: push handlers, lexical and declaration events, and filter chains                        |
| [`@exemplarjs/dom`](../dom/README.md)                     | A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`                  |
| [`@exemplarjs/writer`](../writer/README.md)               | Stream and event writers, to strings, bytes and web streams                                  |
| `@exemplarjs/validation`                                  | Validation against a DTD                                                                     |
| [`@exemplarjs/catalog`](../catalog/README.md)             | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/validation` turns `@exemplarjs/xml` into a validating processor. Give its validator to a factory and every reader made from it, cursor, events, SAX and DOM alike, checks the document against its DTD as it reads: content models, attribute types and defaults, ID, IDREF and IDREFS, ENTITY and NOTATION attributes, the `standalone` rules, and the declarations themselves. It is checked against the W3C XML Conformance Test Suite's valid and invalid documents on every change.

exemplar is the only pure-JavaScript XML library that validates against a DTD.

```bash
npm install @exemplarjs/xml @exemplarjs/validation
```

### Validate

```ts
import { dtdValidator } from '@exemplarjs/validation';
import { EventType, type XMLError, XMLInputFactory } from '@exemplarjs/xml';

const problems: XMLError[] = [];
const validating = new XMLInputFactory({
  validator: dtdValidator(),
  errorHandler: { error: (e) => problems.push(e) }, // validity errors; well-formedness errors still throw
});

const doc = `<!DOCTYPE order [
  <!ELEMENT order (item+)>
  <!ELEMENT item (#PCDATA)>
  <!ATTLIST item sku ID #REQUIRED>
]><order><item sku="a1">Tea</item><item>Milk</item></order>`;

const reader = validating.createStreamReader(doc);
while (reader.next() !== EventType.END_DOCUMENT);
console.log(problems.map((e) => `${e.code} at ${e.line}:${e.column}`)); // [ 'VC_REQUIRED_ATTRIBUTE at 5:35' ]
```

Without an `error` handler, the first validity error throws and ends the document. Each error carries a `VC_` code that names the constraint, with its line, column and system id.

### External DTDs

Validation reads the external subset and parameter entities through the factory's resolvers, `fileResolver` and `fetchResolver` included, or through an XML catalog from `@exemplarjs/catalog`, and only for the protocols `accessExternalDTD` allows.

### What it checks

- Content models, compiled to deterministic automata as children arrive.
- Attribute types, enumerations, `#REQUIRED` and `#FIXED`, and defaults that fit their types.
- Unique IDs and IDREFs that point at one, checked once the document ends.
- Unique element types and notations, one ID attribute per element, `xml:space` declared as XML says, and declarations that start and end in the same parameter entity.
- Under namespaces, no colons in ID, IDREF, ENTITY and NOTATION values.

The validator also marks whitespace in element content, which the readers report as ignorable whitespace.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/dom`](../dom/README.md): A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`
- [`@exemplarjs/writer`](../writer/README.md): Stream and event writers, to strings, bytes and web streams
- [`@exemplarjs/catalog`](../catalog/README.md): OASIS XML Catalogs 1.1
- [`@exemplarjs/xinclude`](../xinclude/README.md): XInclude 1.0, with XPointer
- [`@exemplarjs/canonical`](../canonical/README.md): Canonical XML 1.0 and 1.1, and Exclusive Canonicalization
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
