# exemplar guide

exemplar reads, validates and writes XML. Its readers come in three styles, the same three Java offers:

- a pull cursor, like StAX;
- event objects, like StAX's event API;
- push handlers, like SAX.

It also has a DOM tree, a streaming writer and canonicalization.

This guide shows how to use each through common tasks. [design.md](design.md) explains how it works inside.

## Where things are

| Import                           | What it has                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| `@exemplarjs/xml`                | `XMLInputFactory`, the stream and event readers, `EventType`, `XMLError` |
| `@exemplarjs/sax`                | `SAXParser`, handler types, `XMLFilterImpl`                              |
| `@exemplarjs/dom`                | `DocumentBuilder`, the DOM, `DOMParser`, `XMLSerializer`                 |
| `@exemplarjs/writer`             | `XMLOutputFactory`, the stream and event writers, sinks                  |
| `@exemplarjs/xml/filters`        | Filtered readers                                                         |
| `@exemplarjs/validation`         | `dtdValidator`                                                           |
| `@exemplarjs/xinclude`           | `xincludeProcessor`                                                      |
| `@exemplarjs/catalog`            | `catalogResolver`                                                        |
| `@exemplarjs/xml/resolvers`      | `fetchResolver`                                                          |
| `@exemplarjs/xml/resolvers/file` | `fileResolver`, for Node, Deno and Bun                                   |
| `@exemplarjs/canonical`          | `canonicalize`                                                           |
| `@exemplarjs/encodings-cjk`      | Decoders for Japanese, Chinese and Korean encodings                      |

Each is its own package built on `@exemplarjs/xml`, apart from `@exemplarjs/xml`'s own subpaths, and all are released together at one version. Validation, XInclude, catalogs and the CJK decoders load only when you import them and pass them to a factory.

## Factories and sources

Every reader comes from an `XMLInputFactory`. Its options apply to every reader it makes. Create one factory per configuration and reuse it.

```ts
import { XMLInputFactory } from '@exemplarjs/xml';

const xml = new XMLInputFactory({ namespaceAware: true });
```

A source can be any of these:

- a string;
- a `Uint8Array`;
- an iterable or async iterable of `Uint8Array` chunks, such as a Node read stream;
- a `ReadableStream`, such as `fetch(url).body`;
- an object that adds where the document came from, which resolvers, XInclude and error messages use. It can also carry a `publicId`, a `baseURI` and an `encoding`, such as the charset of an HTTP response:

```ts
const source = { systemId: 'file:///data/manual.xml', bytes: await readFile('/data/manual.xml') };
```

Bytes are decoded as the XML specification says: a byte-order mark first, then an `encoding` given with the source, then the `encoding` in the XML declaration, otherwise UTF-8. Chunks can be any size. A string that starts with U+FEFF, as Node's `readFileSync(path, 'utf8')` leaves it, has that byte-order mark skipped too.

## Reading with the cursor

The cursor is the fastest way to read. `next()` moves to the next event and returns its type; the accessors then describe that event. Strings are made only when you ask for them.

```ts
import { EventType, XMLInputFactory } from '@exemplarjs/xml';

const xml = new XMLInputFactory();
const reader = xml.createStreamReader('<book id="b1"><title>Dune</title></book>');

for (let type = reader.next(); type !== EventType.END_DOCUMENT; type = reader.next()) {
  if (type === EventType.START_ELEMENT) {
    console.log(reader.localName(), reader.attributeValue('', 'id'));
  } else if (type === EventType.CHARACTERS) {
    console.log(reader.text());
  }
}
```

The accessors follow StAX's, without the `get`:

- the current event: `eventType()`, `hasNext()`;
- names: `name()`, `localName()`, `prefix()`, `namespaceURI()`;
- attributes: `attributeCount()`, `attributeName(i)`, `attributeLocalName(i)`, `attributePrefix(i)`, `attributeNamespace(i)`, `attributeType(i)`, `isAttributeSpecified(i)`, and `attributeValue(i)` or `attributeValue(namespaceURI, localName)`, where `''` means no namespace. An index that is not below `attributeCount()` throws a `RangeError`, and `attributeCount()` is 0 except at `START_ELEMENT`;
- content: `text()`, `isWhitespace()`, `piTarget()`, `piData()`;
- namespace declarations: `namespaceCount()`, `namespacePrefix(i)`, `namespaceURI(i)`, where an index not below `namespaceCount()` throws a `RangeError`;
- the document: `version()`, `encoding()`, `standalone()`, and for the `DTD` event `doctype()`, which gives the name, public and system ids, the internal subset, the entities and notations declared, and the processing instructions in the DTD;
- the current position: `location()`.

A reference to an entity exemplar does not read, such as one declared in a DTD it was not given, arrives as an `ENTITY_REFERENCE` event, and `name()` gives the entity's name.

To know which events came from an entity, turn on `reportEntityBoundaries`. Each expansion then sits between a `START_ENTITY` and an `END_ENTITY` event, and `name()` gives the entity's name:

```ts
const xml = new XMLInputFactory({ reportEntityBoundaries: true });
const reader = xml.createStreamReader('<!DOCTYPE a [<!ENTITY intro "<p>Hello</p>">]><a>&intro;<p>Bye</p></a>');
// START_ELEMENT a, START_ENTITY intro, START_ELEMENT p, CHARACTERS, END_ELEMENT p, END_ENTITY intro,
// START_ELEMENT p, CHARACTERS, END_ELEMENT p, END_ELEMENT a
```

These two event types are exemplar's own, beyond StAX's, so a loop that switches on event types should let others pass. SAX reports the same through `startEntity` and `endEntity`.

### Reading a simple structure

`nextTag()` skips whitespace, comments and PIs to the next start or end tag. `elementText()` reads a text-only element and stops at its end tag.

```ts
// <settings><host>example.org</host><port>8080</port></settings>
const reader = xml.createStreamReader(source);
const settings = new Map<string, string>();

reader.nextTag(); // <settings>
while (reader.nextTag() === EventType.START_ELEMENT) {
  settings.set(reader.localName(), reader.elementText());
}
```

## Reading large files and streams

The async reader takes a stream and has the same accessors. The simplest way to read it is `forEachEvent`, which calls your function for each event and waits for input between chunks:

```ts
import { createReadStream } from 'node:fs';

let count = 0;
const reader = xml.createAsyncStreamReader({
  systemId: 'file:///data/big.xml',
  stream: createReadStream('/data/big.xml'),
});

await reader.forEachEvent((type, r) => {
  if (type === EventType.START_ELEMENT && r.localName() === 'record') count++;
});
```

The same works with `fetch`:

```ts
const response = await fetch('https://example.org/feed.xml');
const reader = xml.createAsyncStreamReader({ systemId: response.url, stream: response.body! });
```

When the response's `Content-Type` names a charset, pass it as `encoding`; it then takes precedence over the XML declaration.

To pull events yourself, loop over `next()`. While input is buffered, `next()` returns at once. When it needs more input it returns `EventType.NEED_INPUT`, and you await `fill()`. That way you pay for a promise once per chunk, not once per event. This loop is the fastest way to read a stream; `forEachEvent` is about 2% slower on the FreeBSD documentation and 4% slower on XMark, or 6% once a program passes it many different functions.

```ts
for (let type = reader.next(); type !== EventType.END_DOCUMENT; type = reader.next()) {
  if (type === EventType.NEED_INPUT) await reader.fill();
  else if (type === EventType.START_ELEMENT && reader.localName() === 'record') count++;
}
```

Unlike the sync reader, which starts at `START_DOCUMENT`, the async reader starts at `NEED_INPUT` and returns `START_DOCUMENT` from `next()` once it has read the XML declaration. Calling `next()` again after `NEED_INPUT`, without waiting for input, throws.

`nextTag()` and `elementText()` cannot wait for input, so an async reader has `nextTagAsync()` and `elementTextAsync()`:

```ts
await reader.nextTagAsync(); // <settings>
while ((await reader.nextTagAsync()) === EventType.START_ELEMENT) {
  settings.set(reader.localName(), await reader.elementTextAsync());
}
```

When the data arrives in pieces you don't control, such as messages on a socket, create the reader without a source and feed it yourself. Events come out as soon as each one is complete, and `fill()` resolves when the next chunk is fed:

```ts
const reader = xml.createAsyncStreamReader();

socket.on('data', (chunk) => {
  reader.feed(chunk);
  drain();
});
socket.on('end', () => {
  reader.endOfInput();
  drain();
});

function drain() {
  for (
    let type = reader.next();
    type !== EventType.NEED_INPUT && type !== EventType.END_DOCUMENT;
    type = reader.next()
  ) {
    handle(reader, type);
  }
}
```

## Reading events as objects

The event reader yields one object per event. Event objects copy their strings, so they can be kept after reading moves on; the cursor is faster when you don't need to keep them. Switching on `event.type` narrows the event to its kind.

```ts
for (const event of xml.createEventReader(source)) {
  switch (event.type) {
    case EventType.START_ELEMENT:
      console.log(event.name.localName, event.attribute('id')?.value);
      break;
    case EventType.CHARACTERS:
      console.log(event.text);
      break;
  }
}
```

- A start tag's `name` is a `QName` with `namespaceURI`, `localName` and `prefix`; `toString()` gives the qualified name.
- `attributes` holds `Attribute`s, each a `QName` with `value`, `type` and `specified`; `namespaces` holds the declarations, as `{ prefix, namespaceURI }`.
- `event.location` is worked out the first time you read it.
- The reader also has `peek()`, `nextTag()` and `elementText()`, as StAX's has. `nextTag()` passes over `START_DOCUMENT`, as the cursor's does.

From a stream, there are two ways to iterate:

- **Per event:** `for await (const event of xml.createAsyncEventReader(stream))`. This costs a promise per event.
- **Per chunk:** iterating its `batches()` yields an array of events per chunk, at a promise per chunk. It is about 10% faster on the FreeBSD documentation and 25% faster on XMark.

`xml.createEventStream(stream)` gives the events as a web `ReadableStream`. `xml.createAsyncEventReader()` with no source gives a reader you feed with `feed(bytes)` and `endOfInput()`, as the fed cursor is.

```ts
for await (const batch of xml.createAsyncEventReader(stream).batches()) {
  for (const event of batch) handle(event);
}
```

## Push handlers (SAX)

The SAX parser calls your handler's methods. A handler implements only the methods it needs: content, lexical, declaration, DTD and error methods, all on one object.

```ts
import { SAXParser, type Attributes } from '@exemplarjs/sax';

const parser = new SAXParser(xml);
const titles: string[] = [];
let inTitle = false;

const handler = {
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
};

parser.parse(source, handler);
await parser.parseAsync(stream, handler); // the same, from a stream
```

`Attributes` has `length`, `localName(i)`, `uri(i)`, `qName(i)`, `value(i)`, `value(qName)` or `value(uri, localName)`, `type(i)`, `isSpecified(i)` and `index(qName)` or `index(uri, localName)`. It reads the parser directly, so use it only during `startElement`. As in SAX, `characters` may be called more than once for one run of text.

The parser reads with its factory's options, which cover SAX's features, such as `namespaceAware` for `namespaces`; [design.md](design.md#configuration) gives the Java name of each. It has two options of its own, for SAX features no factory option covers:

```ts
const parser = new SAXParser(xml, {
  resolveDTDURIs: false, // system ids in declarations as written
  xmlnsURIs: true, // xmlns attributes in the xmlns namespace
});
```

## Filters

A pull filter passes on only the events your function accepts. It runs inside the reader's own `next()`, so the reader you pass becomes the filtered reader, with the same accessors.

```ts
import { createFilteredReader } from '@exemplarjs/xml/filters';

const reader = createFilteredReader(
  xml.createStreamReader(source),
  (r) => r.eventType() !== EventType.COMMENT && r.eventType() !== EventType.PROCESSING_INSTRUCTION
);
```

`createFilteredReader` takes an event reader too, with a function of the event. To change what accessors return, extend `StreamReaderDelegate`, which forwards every call to the reader it wraps; it is slower than a filter.

A SAX filter sits between the parser and a handler. It changes events as they pass, then forwards them by calling `super`:

```ts
import { XMLFilterImpl } from '@exemplarjs/sax';

class RenamePara extends XMLFilterImpl {
  override startElement(uri: string, localName: string, qName: string, attributes: Attributes) {
    super.startElement(uri, localName === 'para' ? 'p' : localName, qName, attributes);
  }
}

parser.parse(source, new RenamePara(handler));
```

## The DOM

`DocumentBuilder` builds a DOM Level 3 Core tree, using the factory's options. XInclude and validation apply to the tree too; pull filters do not, as the builder reads through a cursor of its own.

```ts
import { DocumentBuilder } from '@exemplarjs/dom';

const builder = new DocumentBuilder(xml);
const doc = builder.parse(source); // await builder.parseAsync(stream) for streams

const DC = 'http://purl.org/dc/elements/1.1/';
for (const title of doc.getElementsByTagNameNS(DC, 'title')) console.log(title.textContent);
doc.documentElement.setAttribute('checked', 'yes');
```

The builder has two options of its own, as JAXP's does: `new DocumentBuilder(xml, { ignoringComments: true, ignoringElementContentWhitespace: true })`. With the factory's `replaceEntityReferences: false`, entity references stay in the tree as read-only nodes holding their expansion.

`doc.normalizeDocument()` does what `doc.domConfig` says. It declares the namespaces the tree uses, and, for example, turns CDATA sections into text after `doc.domConfig.setParameter('cdata-sections', false)`.

Code written for browsers runs unchanged, and nodes have `remove()` as well as `removeChild`. As in browsers, a document that isn't well-formed comes back containing a `parsererror` element instead of throwing:

```ts
import { DOMParser, XMLSerializer } from '@exemplarjs/dom';

const doc = new DOMParser().parseFromString(text, 'application/xml');
const back = new XMLSerializer().serializeToString(doc);
```

Lists such as `childNodes` answer to `list[i]`, `length`, `item()` and `for...of`. To turn one into an array, use `Array.from(list)` or `[...list]`, as browsers recommend: just after the children change anywhere but at the end, `Object.values(list)` and `{ ...list }` see no items until the list is next read.

## Writing

The stream writer works like StAX's `XMLStreamWriter`. It writes to a sink in chunks, so writing a large document takes little memory.

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

console.log(sink.toString());
```

Names can also be given as a `QName` from `@exemplarjs/xml`, as event objects carry them: `w.writeStartElement(new QName(DC, 'title', 'dc'))`, `w.writeAttribute(new QName(DC, 'lang', 'dc'), 'en')`. That avoids StAX's argument orders, which differ: prefix, local name, URI for an element, but prefix, URI, local name for an attribute.

To write a file, or any other `WritableStream`, give the stream and an encoding. The writer's methods return at once, so a stream slower than the writer queues what it has not yet taken; awaiting `drain()` now and then waits until it has room, which keeps a large document from piling up in memory.

```ts
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';

const w = out.createStreamWriter(Writable.toWeb(createWriteStream('out.xml')), { encoding: 'utf-8' });
w.writeStartElement('records');
for (const [i, record] of records.entries()) {
  writeRecord(w, record);
  if (i % 1000 === 0) await w.drain();
}
w.writeEndDocument();
await w.close();
```

What the writer does by default:

- It escapes so that re-reading gives back exactly what was written, including tabs and line breaks in attribute values.
- It checks names and nesting, and throws on anything that would not be well-formed.
- It writes the namespace declarations you give it. `XMLOutputFactory({ repairNamespaces: true })` adds missing declarations itself.

An element with no content can be written with `writeEmptyElement`, which takes attributes until the next write. Byte output is UTF-8 unless you ask for UTF-16 or one of the built-in single-byte encodings, such as US-ASCII, ISO-8859-1 or windows-1252; characters the encoding lacks become character references.

A DOM tree or any part of it is written with `w.writeNode(node)`.

## Copying and transforming

An event reader feeds an event writer directly, so a filtering copy is a loop:

```ts
const writer = out.createEventWriter(sink);

for (const event of xml.createEventReader(source)) {
  if (event.type === EventType.COMMENT) continue; // drop comments
  writer.add(event);
}
await writer.close();
```

A document read with `namespaceAware: false` may have names with colons that are not namespace prefixes; copy it with `new XMLOutputFactory({ namespaceAware: false })`, which writes names as given.

## Validating against a DTD

With a validator from `@exemplarjs/validation`, the parser checks the document against its DTD. It reads the external DTD through a resolver, and only from the places you allow.

```ts
import { DocumentBuilder } from '@exemplarjs/dom';
import { dtdValidator } from '@exemplarjs/validation';
import { XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { fileResolver } from '@exemplarjs/xml/resolvers/file';

const problems: XMLError[] = [];
const validating = new XMLInputFactory({
  validator: dtdValidator(),
  accessExternalDTD: ['file'],
  entityResolver: fileResolver({ root: '/opt/schemas' }),
  errorHandler: {
    error: (e) => problems.push(e), // validity errors; well-formedness errors still throw
    warning: (e) => console.warn(e.message),
  },
});

const doc = new DocumentBuilder(validating).parse({ systemId: 'file:///data/dm.xml', bytes });
```

Without an `error` handler, the first validity error throws and ends the document.

## Catalogs

A catalog maps public and system identifiers to local copies. A catalog resolver from `@exemplarjs/catalog`, passed as the `catalog` option, serves DTDs, entities and XInclude targets.

```ts
import { catalogResolver } from '@exemplarjs/catalog';
import { dtdValidator } from '@exemplarjs/validation';

const xml = new XMLInputFactory({
  validator: dtdValidator(),
  accessExternalDTD: ['file'],
  catalog: catalogResolver({ files: ['file:///opt/schemas/catalog.xml'], prefer: 'public' }),
});
```

The catalog is asked after your own resolvers. DTDs and entities are looked up in its `system` and `public` entries and XInclude targets in its `uri` entries; a lookup that finds nothing there tries the other kind, as Java's catalogs do. The access lists apply to the URI it maps to, so a catalog that maps `http:` identifiers to `file:` copies needs only `'file'`, as above. Your resolver is asked for that URI first; if it supplies nothing, the catalog reads it, from local files on Node, Deno and Bun. Elsewhere, pass `read` to supply the catalog files and what they map to.

With the default `resolve: 'strict'`, an identifier the catalog doesn't know is an error, `CATALOG_NO_MATCH`. `'continue'` carries on as if there were no catalog, and `'ignore'` resolves an entity to empty content. An XInclude target the catalog doesn't know falls back under either.

## Resolvers

A resolver supplies external entities, DTDs and XInclude targets. It returns `{ systemId, bytes }`, `{ systemId, text }` or `{ systemId, stream }`, or `undefined` to let the next resolver try. Your own resolver is asked first, whatever the access lists say, as in Java, and the catalog after it. In async readers a resolver may return a promise; a stream, or a promise, needs an async reader, and a sync reader throws a `TypeError` for either. To fail the document at the reference instead, throw a `ResolutionError` with an error code.

The request carries `access`, the protocols the factory allows for that read. The ready-made resolvers keep to it, and a resolver of your own that reads by URI should too, by throwing a `ResolutionError` with the code `ACCESS_REFUSED`. A refused read is reported as an error: it throws and ends the document unless an `errorHandler` takes it, and then the document goes on without what was refused.

```ts
const xml = new XMLInputFactory({
  entityResolver: {
    resolveEntity({ name, publicId, systemId, baseURI }) {
      if (publicId === '-//ACME//ENTITIES Symbols//EN') return { systemId, text: symbolsDtd };
      return undefined;
    },
  },
  entities: { nbsp: ' ' }, // entities known in advance, for documents whose DTD isn't read
});
```

There are two ready-made resolvers:

- `fileResolver({ root })`, from `@exemplarjs/xml/resolvers/file`, reads files below `root` only, when the access list allows `'file'`. It works on Node, Deno and Bun.
- `fetchResolver()`, from `@exemplarjs/xml/resolvers`, reads over HTTP, when the access list allows `'http'` or `'https'`. It returns promises, so it works only with async readers.

## XInclude

With an XInclude processor from `@exemplarjs/xinclude`, `xi:include` elements are replaced by what they point to, in every reader and in the DOM.

```ts
import { xincludeProcessor } from '@exemplarjs/xinclude';
import { fileResolver } from '@exemplarjs/xml/resolvers/file';

const xml = new XMLInputFactory({
  xinclude: xincludeProcessor(),
  accessExternalEntities: ['file'],
  entityResolver: fileResolver({ root: '/docs' }),
});

const doc = new DocumentBuilder(xml).parse({ systemId: 'file:///docs/book.xml', bytes });
```

- `parse="text"` includes text.
- `xpointer="element(/1/2)"` and `xpointer="chapter-3"` include part of a document.
- `xi:fallback` is used when the target can't be read or the pointer finds nothing.
- `xincludeProcessor({ fixupBaseURIs: false, fixupLanguage: false })` stops it adding `xml:base` and `xml:lang` to included content.

## Canonical form

`canonicalize` produces Canonical XML 1.0 or 1.1, or Exclusive Canonicalization, for signatures and for comparing documents. It takes a source, a reader or a DOM node; a DOM node is canonicalized as a document subset. The `method` is `'c14n'` (the default), `'c14n11'` or `'exc-c14n'`, or `'suite-first'` or `'suite-second'` for the XML Test Suite's own canonical forms.

```ts
import { canonicalize } from '@exemplarjs/canonical';

const text = canonicalize(source, { method: 'c14n11', factory: xml });
const bytes = canonicalize(signedInfo, {
  method: 'exc-c14n',
  inclusivePrefixes: ['ds'],
  comments: false,
  output: 'bytes',
});
```

Canonical XML needs the document's whole DTD and its external entities. `canonicalize` reads them through the resolvers of the `factory` you pass, and throws if it can't.

## Errors and locations

Well-formedness errors throw an `XMLError`. It has a stable `code`, the message, and the line, column, offset and system id where the error is. A validity or other recoverable error goes to the `errorHandler`'s `error`, and parsing carries on; without one it is thrown too. A thrown error ends the document: every later `next()` throws it again.

```ts
import { XMLError } from '@exemplarjs/xml';

try {
  new DocumentBuilder(xml).parse(source);
} catch (e) {
  if (e instanceof XMLError) console.error(`${e.systemId}:${e.line}:${e.column}: ${e.code} ${e.message}`);
  else throw e;
}
```

Any event's position is available:

- from the cursor, with `reader.location()`;
- from an event object, as `event.location`;
- from a SAX handler, through the locator passed to `setDocumentLocator(locator)`.

The cursor's and event objects' locations give `{ line, column, offset, systemId }`, and SAX's locator `lineNumber`, `columnNumber`, `systemId` and `publicId`, as SAX's `Locator2` does. A location costs nothing until asked for.

## Untrusted input

The defaults are already safe:

- no external access: without a resolver nothing external is read, and the ready-made resolvers read only what the access lists allow;
- entity expansion limits matching current JDK defaults.

For input that should never have a DTD at all, as in SOAP, refuse one outright, and tighten any limit you need:

```ts
const untrusted = new XMLInputFactory({
  disallowDoctype: true,
  limits: { elementDepth: 64, attributesPerElement: 50 },
});
```

## Trusted input

For input you produced yourself and trust, `checkWellFormedness: false` skips the structural checks and saves roughly a quarter of tokenizing time. Character checks and line counting stay on.

```ts
const trusted = new XMLInputFactory({ checkWellFormedness: false });
```

If you keep strings from a very large document, set `copyStrings: true`. Otherwise a kept string can hold the whole input chunk it came from in memory.

## Encodings

These encodings are built in:

- UTF-8 and UTF-16;
- UTF-32;
- GB18030;
- US-ASCII and the ISO-8859 family;
- the Windows code pages;
- KOI8;
- Macintosh;
- EBCDIC.

The other Japanese, Chinese and Korean encodings are a separate import, so the tables load only when needed:

```ts
import { cjkDecoders } from '@exemplarjs/encodings-cjk';

const xml = new XMLInputFactory({ decoders: cjkDecoders });
```

Any object with `TextDecoder`'s `decode(bytes, { stream })` can be registered under an encoding name, through a factory that creates one, including a `TextDecoder` itself:

```ts
const xml = new XMLInputFactory({
  decoders: { 'x-legacy': () => new TextDecoder('windows-1252', { fatal: true }) },
});
```

## Options

| Option                          | Default      | Meaning                                                                                             |
| ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `namespaceAware`                | `true`       | Resolve namespace prefixes and check them                                                           |
| `namespacePrefixes`             | `false`      | Report `xmlns` attributes among the attributes                                                      |
| `validator`                     | none         | A DTD validator from `@exemplarjs/validation`                                                       |
| `checkWellFormedness`           | `true`       | Run the structural well-formedness checks                                                           |
| `checkNormalization`            | `false`      | Report whether an XML 1.1 document is fully normalized                                              |
| `replaceEntityReferences`       | `true`       | Expand entities; when `false`, report `ENTITY_REFERENCE` events                                     |
| `supportExternalEntities`       | `true`       | Read external entities, subject to `accessExternalEntities`                                         |
| `accessExternalDTD`             | `[]`         | Protocols allowed for external DTDs and parameter entities, such as `['file', 'https']`, or `'all'` |
| `accessExternalEntities`        | `[]`         | Protocols allowed for external general entities and XInclude targets                                |
| `disallowDoctype`               | `false`      | Treat any DOCTYPE as a fatal error                                                                  |
| `coalescing`                    | `false`      | Merge adjacent text, CDATA and entity text into one event                                           |
| `reportPrologWhitespace`        | `false`      | Report whitespace outside the root element                                                          |
| `reportEntityBoundaries`        | `false`      | Report where expanded entities start and end, as `START_ENTITY` and `END_ENTITY` events             |
| `copyStrings`                   | `false`      | Copy strings instead of slicing the input                                                           |
| `xinclude`                      | none         | An XInclude processor from `@exemplarjs/xinclude`                                                   |
| `entityResolver`, `uriResolver` | none         | Resolvers for entities and DTDs, and for URIs                                                       |
| `catalog`                       | none         | A catalog resolver from `@exemplarjs/catalog`                                                       |
| `entities`                      | none         | Entity names and replacement text known in advance                                                  |
| `errorHandler`                  | throws       | `{ warning, error, fatalError }`; `fatalError` hears of a fatal error before it throws              |
| `decoders`                      | built in     | Extra or replacement decoders by encoding name                                                      |
| `limits`                        | JDK defaults | `entityExpansions`, `totalEntitySize`, `elementDepth` and the others                                |
