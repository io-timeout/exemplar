# @exemplarjs/sax

SAX for JavaScript: push handlers on the most conformant XML reader in JavaScript, and the fastest pure-JavaScript one.

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
| `@exemplarjs/sax`                                         | SAX: push handlers, lexical and declaration events, and filter chains                        |
| [`@exemplarjs/dom`](../dom/README.md)                     | A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`                  |
| [`@exemplarjs/writer`](../writer/README.md)               | Stream and event writers, to strings, bytes and web streams                                  |
| [`@exemplarjs/validation`](../validation/README.md)       | Validation against a DTD                                                                     |
| [`@exemplarjs/catalog`](../catalog/README.md)             | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/sax` is SAX2 as Java has it: content, lexical, declaration, DTD and error events on one handler object, an `Attributes` view, a locator, and `XMLFilterImpl` chains. It reads through `@exemplarjs/xml`, so every option, resolver, catalog, validator and XInclude processor you give its factory applies, and it runs within a few percent of the pull cursor's speed.

```bash
npm install @exemplarjs/xml @exemplarjs/sax
```

### Handle events

A handler implements only the methods it needs:

```ts
import { SAXParser, type Attributes } from '@exemplarjs/sax';
import { XMLInputFactory } from '@exemplarjs/xml';

const parser = new SAXParser(new XMLInputFactory());
const titles: string[] = [];
let inTitle = false;

parser.parse('<books><book><title>Dune</title></book></books>', {
  startElement(uri: string, localName: string, qName: string, attributes: Attributes) {
    inTitle = localName === 'title';
  },
  characters(text: string) {
    if (inTitle) titles.push(text);
  },
  endElement() {
    inTitle = false;
  },
  comment(text: string) {}, // lexical events, as in SAX's LexicalHandler
});
```

`parseAsync(stream, handler)` reads streams and async iterables the same way. `Attributes` reads by index, by qualified name, or by namespace URI and local name, and gives each attribute's DTD type and whether it was specified or defaulted.

### Everything SAX reports

- `startDTD`, `endDTD`, `startEntity`, `endEntity`, `startCDATA`, `endCDATA` and `comment`, as `LexicalHandler` does;
- `elementDecl`, `attributeDecl`, `internalEntityDecl`, `externalEntityDecl`, `notationDecl` and `unparsedEntityDecl`, as `DeclHandler` and `DTDHandler` do;
- `skippedEntity` for entities that are not read, `ignorableWhitespace` when validating, and `startPrefixMapping` and `endPrefixMapping` around elements;
- `warning`, `error` and `fatalError`, with a locator that gives the error's position while they run.

### Filter chains

```ts
import { XMLFilterImpl } from '@exemplarjs/sax';

class RenamePara extends XMLFilterImpl {
  override startElement(uri: string, localName: string, qName: string, attributes: Attributes) {
    super.startElement(uri, localName === 'para' ? 'p' : localName, qName, attributes);
  }
}

parser.parse('<doc><para>Hello</para></doc>', new RenamePara({ startElement: (u, local) => console.log(local) }));
```

The factory's options cover SAX's features, such as `namespaceAware` for `namespaces`; the parser adds `resolveDTDURIs` and `xmlnsURIs` for the two that no factory option covers.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
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
