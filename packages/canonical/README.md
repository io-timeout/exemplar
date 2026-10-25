# @exemplarjs/canonical

Canonical XML for JavaScript: C14N 1.0 and 1.1 and Exclusive Canonicalization, for signatures and comparisons.

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
| [`@exemplarjs/validation`](../validation/README.md)       | Validation against a DTD                                                                     |
| [`@exemplarjs/catalog`](../catalog/README.md)             | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| `@exemplarjs/canonical`                                   | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/canonical` writes the canonical form of a document or of a DOM subset, byte for byte as the recommendations define it: Canonical XML 1.0 and 1.1, with and without comments, and Exclusive XML Canonicalization 1.0 with inclusive namespace prefixes. Because canonicalization needs the document as a validating processor sees it, it reads the whole DTD, applies attribute defaults and expands entities, through the resolvers you give it, so the form it writes is exactly the one the recommendations define.

```bash
npm install @exemplarjs/xml @exemplarjs/dom @exemplarjs/writer @exemplarjs/canonical
```

### Canonicalize

```ts
import { canonicalize } from '@exemplarjs/canonical';

const text = canonicalize('<doc b="2"   a="1"><e/></doc>', { method: 'c14n11' });
// <doc a="1" b="2"><e></e></doc>
```

`canonicalize` takes a source, a reader or a DOM node, and returns a string or, with `output: 'bytes'`, UTF-8 bytes. A DOM node is canonicalized as a document subset, carrying its ancestors' namespaces and `xml:` attributes as each method says:

```ts
import { DocumentBuilder } from '@exemplarjs/dom';
import { XMLInputFactory } from '@exemplarjs/xml';

const factory = new XMLInputFactory();
const signed = new DocumentBuilder(factory).parse(
  '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo Id="si"/></ds:Signature>'
);
const signedInfo = signed.documentElement?.firstChild;
if (signedInfo) {
  const bytes = canonicalize(signedInfo, { method: 'exc-c14n', inclusivePrefixes: ['ds'], output: 'bytes' });
}
```

### Methods

| `method`                          | Form                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `'c14n'` (the default)            | Canonical XML 1.0                                                   |
| `'c14n11'`                        | Canonical XML 1.1                                                   |
| `'exc-c14n'`                      | Exclusive XML Canonicalization 1.0, with `inclusivePrefixes`        |
| `'suite-first'`, `'suite-second'` | The W3C XML Test Suite's own canonical forms, for comparing parsers |

Each takes `comments: true` or `false`. Pass a `factory` to read the DTD and external entities through your resolvers and catalog.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/dom`](../dom/README.md): A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`
- [`@exemplarjs/writer`](../writer/README.md): Stream and event writers, to strings, bytes and web streams
- [`@exemplarjs/validation`](../validation/README.md): Validation against a DTD
- [`@exemplarjs/catalog`](../catalog/README.md): OASIS XML Catalogs 1.1
- [`@exemplarjs/xinclude`](../xinclude/README.md): XInclude 1.0, with XPointer
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
