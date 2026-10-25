# @exemplarjs/xinclude

XInclude 1.0 for JavaScript: assemble documents from parts, in every reader and in the DOM, streaming.

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
| `@exemplarjs/xinclude`                                    | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/xinclude` replaces `xi:include` elements with what they point to, as JAXP's `setXIncludeAware(true)` does. It works in every reader `@exemplarjs/xml` makes, the cursor, event objects, SAX and the DOM, and streams: a pointer into another document skips to its target and passes that subtree through, buffering nothing. It passes 151 of the 153 applicable tests of the W3C XInclude Test Suite.

```bash
npm install @exemplarjs/xml @exemplarjs/xinclude
```

### Include

```ts
import { xincludeProcessor } from '@exemplarjs/xinclude';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';

const parts: Record<string, string> = {
  'file:///docs/chapter.xml': '<chapter id="c1"><title>Arrakis</title></chapter>',
  'file:///docs/notes.txt': 'Spice must flow.',
};

const xml = new XMLInputFactory({
  xinclude: xincludeProcessor(),
  accessExternalEntities: ['file'],
  entityResolver: {
    resolveEntity: ({ systemId, baseURI }) => {
      const uri = new URL(systemId ?? '', baseURI).href;
      return parts[uri] === undefined ? undefined : { systemId: uri, text: parts[uri] };
    },
  },
});

const book = `<book xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include href="chapter.xml"/>
  <note><xi:include href="notes.txt" parse="text"/></note>
</book>`;
const reader = xml.createStreamReader({ systemId: 'file:///docs/book.xml', text: book });
while (reader.next() !== EventType.END_DOCUMENT)
  if (reader.eventType() === EventType.START_ELEMENT) console.log(reader.localName());
```

`fileResolver({ root })` from `@exemplarjs/xml/resolvers/file` serves real files, and a catalog from `@exemplarjs/catalog` maps targets to local copies.

### What it supports

- `parse="xml"` and `parse="text"`, with text encodings from HTTP, the bytes, or the `encoding` attribute.
- Pointers through the XPointer framework, with the `element()` scheme and shorthand pointers to IDs and `xml:id`.
- `xi:fallback` for resources that can't be read or pointers that find nothing.
- `accept` and `accept-language`, passed to your resolver and sent as HTTP headers by `fetchResolver`.
- `xml:base` and `xml:lang` fix-ups on included content, which `xincludeProcessor({ fixupBaseURIs: false, fixupLanguage: false })` turns off.
- Unparsed entities and notations from included content, merged into the result.
- Async readers, whose resolvers may answer with promises or streams.

Inclusion loops, malformed targets and misplaced XInclude elements are fatal errors with their own codes, as the recommendation requires.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/dom`](../dom/README.md): A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`
- [`@exemplarjs/writer`](../writer/README.md): Stream and event writers, to strings, bytes and web streams
- [`@exemplarjs/validation`](../validation/README.md): Validation against a DTD
- [`@exemplarjs/catalog`](../catalog/README.md): OASIS XML Catalogs 1.1
- [`@exemplarjs/canonical`](../canonical/README.md): Canonical XML 1.0 and 1.1, and Exclusive Canonicalization
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
