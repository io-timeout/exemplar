# @exemplarjs/dom

A W3C DOM Level 3 Core tree for JavaScript, built by the most conformant XML reader there is for the language.

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
| `@exemplarjs/dom`                                         | A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`                  |
| [`@exemplarjs/writer`](../writer/README.md)               | Stream and event writers, to strings, bytes and web streams                                  |
| [`@exemplarjs/validation`](../validation/README.md)       | Validation against a DTD                                                                     |
| [`@exemplarjs/catalog`](../catalog/README.md)             | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/dom` is the DOM the JDK's `org.w3c.dom` implements: every node type, entity references and the document type's entities and notations, attribute types and ID-ness from the DTD, `normalizeDocument()` with `domConfig`, and base URIs. It passes 1,405 of the 1,532 pages of the W3C DOM Conformance Test Suite; 87 more need XML Schema. Browser-style `DOMParser` and `XMLSerializer` let code written for browsers run unchanged on Node, Deno and Bun.

It is fast and lean: on an Apple M3 Max it builds trees at up to 314 MB/s, from nodes that keep their fields few.

```bash
npm install @exemplarjs/xml @exemplarjs/writer @exemplarjs/dom
```

### Build a tree

`DocumentBuilder` plays the part of JAXP's: it builds from any source, with every option of the factory you give it, so validation, DTDs, resolvers, catalogs and XInclude all apply.

```ts
import { DocumentBuilder } from '@exemplarjs/dom';
import { XMLInputFactory } from '@exemplarjs/xml';

const builder = new DocumentBuilder(new XMLInputFactory());
const doc = builder.parse('<library xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Dune</dc:title></library>');

for (const title of doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title'))
  console.log(title.textContent);
doc.documentElement?.setAttribute('checked', 'yes');
```

`await builder.parseAsync(stream)` builds from a stream. The builder adds JAXP's `ignoringComments` and `ignoringElementContentWhitespace`, and with the factory's `replaceEntityReferences: false` entity references stay in the tree as read-only nodes holding their expansion.

### Code written for browsers

```ts
import { DOMParser, XMLSerializer } from '@exemplarjs/dom';

const parsed = new DOMParser().parseFromString('<note><to>Ana</to></note>', 'application/xml');
const back = new XMLSerializer().serializeToString(parsed);
```

As in browsers, a document that is not well-formed comes back holding a `parsererror` element instead of throwing. Nodes have `remove()` beside `removeChild`, and lists answer to `list[i]`, `length`, `item()` and `for...of`.

### Level 3

`doc.normalizeDocument()` does what `doc.domConfig` says: it fixes up namespaces as Appendix B.1 of the recommendation describes, and, for example, turns CDATA sections into text after `doc.domConfig.setParameter('cdata-sections', false)`. Where the recommendations leave behaviour open, the tree does what the JDK's does.

To write a tree or any part of it, use `writeNode` on a stream writer from `@exemplarjs/writer`.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/writer`](../writer/README.md): Stream and event writers, to strings, bytes and web streams
- [`@exemplarjs/validation`](../validation/README.md): Validation against a DTD
- [`@exemplarjs/catalog`](../catalog/README.md): OASIS XML Catalogs 1.1
- [`@exemplarjs/xinclude`](../xinclude/README.md): XInclude 1.0, with XPointer
- [`@exemplarjs/canonical`](../canonical/README.md): Canonical XML 1.0 and 1.1, and Exclusive Canonicalization
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
