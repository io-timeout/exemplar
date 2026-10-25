# @exemplarjs/catalog

OASIS XML Catalogs 1.1 for JavaScript: local copies of DTDs, entities and XInclude targets, resolved the way Java resolves them.

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
| `@exemplarjs/catalog`                                     | OASIS XML Catalogs 1.1                                                                       |
| [`@exemplarjs/xinclude`](../xinclude/README.md)           | XInclude 1.0, with XPointer                                                                  |
| [`@exemplarjs/canonical`](../canonical/README.md)         | Canonical XML 1.0 and 1.1, and Exclusive Canonicalization                                    |
| [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md) | Japanese, Chinese and Korean encodings                                                       |

## This package

`@exemplarjs/catalog` maps public and system identifiers and URIs to local copies, so documents that name DTDs and entities on the web read from your disk instead, offline and fast. It implements every entry type of OASIS XML Catalogs 1.1 and follows `javax.xml.catalog`'s configuration, and the differential tests compare it with the JDK on every entry type and matching rule.

exemplar is the only pure-JavaScript XML library with XML Catalogs.

```bash
npm install @exemplarjs/xml @exemplarjs/catalog
```

### Use a catalog

```ts
import { catalogResolver } from '@exemplarjs/catalog';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';

const catalogs: Record<string, string> = {
  'file:///opt/schemas/catalog.xml': `<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">
    <public publicId="-//ACME//DTD Order//EN" uri="order.dtd"/>
  </catalog>`,
  'file:///opt/schemas/order.dtd': '<!ENTITY shop "ACME Tea">',
};

const xml = new XMLInputFactory({
  accessExternalDTD: ['file'],
  catalog: catalogResolver({
    files: ['file:///opt/schemas/catalog.xml'],
    read: (uri) => (catalogs[uri] === undefined ? undefined : { systemId: uri, text: catalogs[uri] }),
  }),
});

const reader = xml.createStreamReader(
  '<!DOCTYPE order PUBLIC "-//ACME//DTD Order//EN" "http://acme.example/order.dtd"><order>&shop;</order>'
);
while (reader.next() !== EventType.END_DOCUMENT)
  if (reader.eventType() === EventType.CHARACTERS) console.log(reader.text()); // ACME Tea
```

On Node, Deno and Bun the catalog reads local `file:` URIs itself, so `read` is needed only elsewhere, or to serve catalogs from memory as above. The access lists apply to the URI the catalog maps to, so a catalog that maps `http:` identifiers to `file:` copies needs only `'file'`.

### Everything the specification has

- `public`, `system`, `rewriteSystem`, `systemSuffix`, `delegatePublic` and `delegateSystem` for DTDs and entities;
- `uri`, `rewriteURI`, `uriSuffix` and `delegateURI` for XInclude targets and other URIs;
- `nextCatalog`, `group`, `prefer`, `xml:base` and `urn:publicid:` unwrapping.

`files`, `prefer`, `defer` and `resolve` follow `javax.xml.catalog`: under the default `resolve: 'strict'` an identifier the catalog doesn't know is an error, `'continue'` carries on as if there were no catalog, and `'ignore'` resolves an entity to empty content. The catalog is asked after your own resolvers, as in the JDK, and serves validation in `@exemplarjs/validation` and inclusions in `@exemplarjs/xinclude` alike.

## See also

- [`@exemplarjs/xml`](../xml/README.md): The reader: pull cursor, event objects, async streams, DTDs, entities, resolvers and filters
- [`@exemplarjs/sax`](../sax/README.md): SAX: push handlers, lexical and declaration events, and filter chains
- [`@exemplarjs/dom`](../dom/README.md): A DOM Level 3 Core tree, with browser-style `DOMParser` and `XMLSerializer`
- [`@exemplarjs/writer`](../writer/README.md): Stream and event writers, to strings, bytes and web streams
- [`@exemplarjs/validation`](../validation/README.md): Validation against a DTD
- [`@exemplarjs/xinclude`](../xinclude/README.md): XInclude 1.0, with XPointer
- [`@exemplarjs/canonical`](../canonical/README.md): Canonical XML 1.0 and 1.1, and Exclusive Canonicalization
- [`@exemplarjs/encodings-cjk`](../encodings-cjk/README.md): Japanese, Chinese and Korean encodings

The [guide](../../docs/guide.md) shows every part at work through common tasks, and the [design](../../docs/design.md) explains how it works inside.

## License

Apache License 2.0. The decoding tables derive from Unicode, ICU and WHATWG data, whose licences and attributions ship in `THIRD_PARTY_LICENSES`.
