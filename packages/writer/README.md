# @exemplarjs/writer

XML stream and event writers for JavaScript: round-trip safe, well-formed by construction, and fast.

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
| `@exemplarjs/writer`                                      | Stream and event writers, to strings, bytes and web streams                                  |
| [`@exemplarjs/validation`](../validation/README.md)       | Validation against a DTD                                                                     |
| [`@exemplarjs/catalog`](../catalog/README.md)             | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/writer` has StAX's two writers: a stream writer like `XMLStreamWriter`, and an event writer like `XMLEventWriter` that takes the events `@exemplarjs/xml` reads, so a filtering copy is a loop. It escapes so that re-reading gives back exactly what was written, refuses anything that would not be well-formed, repairs namespaces when asked, indents as the XSLT serialization rules require, and writes strings, bytes in any built-in encoding, or a web `WritableStream`.

```bash
npm install @exemplarjs/xml @exemplarjs/writer
```

### Write a document

```ts
import { StringSink, XMLOutputFactory } from '@exemplarjs/writer';

const out = new XMLOutputFactory({ indent: '  ' });
const sink = new StringSink();
const w = out.createStreamWriter(sink);
const DC = 'http://purl.org/dc/elements/1.1/';

w.writeStartDocument();
w.writeStartElement('library');
w.writeNamespace('dc', DC);
w.writeStartElement('dc', 'title', DC);
w.writeAttribute('lang', 'en');
w.writeCharacters('Dune & Children');
w.writeEndElement();
w.writeEndElement();
w.writeEndDocument();
w.flush();

console.log(sink.toString());
```

Names can also be a `QName` from `@exemplarjs/xml`, which avoids StAX's differing argument orders for elements and attributes.

### Copy and transform

```ts
import { EventType, XMLInputFactory } from '@exemplarjs/xml';

const copy = new StringSink();
const writer = out.createEventWriter(copy);
for (const event of new XMLInputFactory().createEventReader('<a><!-- drop me --><b>keep</b></a>')) {
  if (event.type !== EventType.COMMENT) writer.add(event);
}
writer.flush();
```

### Streams and encodings

Give a web `WritableStream` and an encoding to write a file or a response. The writes return at once, so await `drain()` now and then to keep a slow stream from queuing the whole document, and `close()` at the end. Bytes can be UTF-8, UTF-16 in either byte order, or any single-byte encoding the reader decodes; characters an encoding lacks become character references.

### What the writer guarantees

- Round-trip escaping by default, tabs and line breaks in attribute values included, or minimal escaping on request.
- Names, characters, nesting, one root, duplicate attributes and prefix bindings checked as you write.
- Namespace declarations written as given, or added where needed with `repairNamespaces: true`.
- XML 1.0 or 1.1, a DOCTYPE, CDATA-section elements and the XML declaration under the options JAXP's serializer has.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/dom`](../dom/README.md): A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`
- [`@exemplarjs/validation`](../validation/README.md): Validation against a DTD
- [`@exemplarjs/catalog`](../catalog/README.md): OASIS XML Catalogs 1.1
- [`@exemplarjs/xinclude`](../xinclude/README.md): XInclude 1.0, with XPointer
- [`@exemplarjs/canonical`](../canonical/README.md): Canonical XML 1.0 and 1.1, and Exclusive Canonicalization
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
