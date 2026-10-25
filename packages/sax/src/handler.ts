import type { XMLError } from '@exemplarjs/xml';

/** Where the parser is, as SAX's `Locator2` reports it: where the current event starts. */
export interface Locator {
  /** The line, counting from 1. */
  readonly lineNumber: number;
  /** The column, counting from 1 in UTF-16 code units. */
  readonly columnNumber: number;
  /** The URI of the document or external entity being read. */
  readonly systemId: string | undefined;
  readonly publicId: string | undefined;
  /** The XML version: the declaration's, or `1.0`. */
  readonly xmlVersion: string;
  /** The encoding the XML declaration names, or else the one detection chose. */
  readonly encoding: string | undefined;
}

/** A start tag's attributes, valid only during `startElement`, as SAX's `Attributes2` is. */
export interface Attributes {
  /** How many attributes the start tag has. */
  readonly length: number;
  /** An attribute's local name; `''` when namespaces are off. */
  localName(index: number): string;
  /** An attribute's namespace URI; `''` for none. */
  uri(index: number): string;
  /** An attribute's qualified name, as written. */
  qName(index: number): string;
  /** An attribute's normalized value. */
  value(index: number): string;
  /** The value of an attribute by qualified name, or by namespace URI and local name; undefined when absent. */
  value(qName: string): string | undefined;
  value(uri: string, localName: string): string | undefined;
  /** The type the DTD declares; an enumeration reports NMTOKEN. */
  type(index: number): string;
  /** Whether an attribute was in the start tag rather than defaulted from the DTD. */
  isSpecified(index: number): boolean;
  /** The index of an attribute by qualified name, or by namespace URI and local name; -1 when absent. */
  index(qName: string): number;
  index(uri: string, localName: string): number;
}

/** SAX's `ContentHandler`, with text as strings. */
export interface ContentHandler {
  /** Receives the locator first, which tells where each later event is while it is being reported. */
  setDocumentLocator?(locator: Locator): void;
  startDocument?(): void;
  endDocument?(): void;
  /** A namespace declaration comes into scope, before the start tag that declares it; `''` for the default namespace. */
  startPrefixMapping?(prefix: string, uri: string): void;
  /** A namespace declaration goes out of scope, after its element's end tag. */
  endPrefixMapping?(prefix: string): void;
  /** A start tag. With namespaces off, `uri` and `localName` are `''`. */
  startElement?(uri: string, localName: string, qName: string, attributes: Attributes): void;
  /** An end tag. */
  endElement?(uri: string, localName: string, qName: string): void;
  /** Character data, including CDATA sections; one run of text may come in several calls. */
  characters?(text: string): void;
  /** Whitespace in element content, which only a validating parser can tell apart from text. */
  ignorableWhitespace?(text: string): void;
  processingInstruction?(target: string, data: string): void;
  /** An entity reference that was not expanded, because expansion is off or the entity was not read. */
  skippedEntity?(name: string): void;
}

/** SAX's `LexicalHandler`. */
export interface LexicalHandler {
  /** The DOCTYPE starts; its declarations come next, then `endDTD`. */
  startDTD?(name: string, publicId: string | undefined, systemId: string | undefined): void;
  endDTD?(): void;
  /** An expanded entity starts: `%name` for a parameter entity, `[dtd]` for the external subset. */
  startEntity?(name: string): void;
  /** An expanded entity ends. */
  endEntity?(name: string): void;
  /** A CDATA section starts; its text comes through `characters`. */
  startCDATA?(): void;
  endCDATA?(): void;
  comment?(text: string): void;
}

/** SAX's `DeclHandler`; parameter entities are named `%name`. */
export interface DeclHandler {
  /** An element type declaration; `model` is the content model without whitespace, such as `(item)*`. */
  elementDecl?(name: string, model: string): void;
  /** An attribute declaration; `mode` is `#REQUIRED`, `#IMPLIED`, `#FIXED`, or undefined for a plain default. */
  attributeDecl?(
    elementName: string,
    attributeName: string,
    type: string,
    mode: string | undefined,
    value: string | undefined
  ): void;
  /** An internal entity declaration, with its replacement text. */
  internalEntityDecl?(name: string, value: string): void;
  /** An external parsed entity declaration; `systemId` is absolute unless `resolveDTDURIs` is off. */
  externalEntityDecl?(name: string, publicId: string | undefined, systemId: string): void;
}

/** SAX's `DTDHandler`. */
export interface DTDHandler {
  /** A notation declaration. */
  notationDecl?(name: string, publicId: string | undefined, systemId: string | undefined): void;
  /** An unparsed entity declaration, `<!ENTITY name SYSTEM "uri" NDATA notation>`. */
  unparsedEntityDecl?(name: string, publicId: string | undefined, systemId: string, notationName: string): void;
}

/** SAX's `ErrorHandler`; a fatal error is thrown after `fatalError` hears of it. */
export interface SAXErrorHandler {
  /** A warning; parsing carries on. */
  warning?(error: XMLError): void;
  /** A recoverable error, such as a validity error; parsing carries on. Without this method the error is thrown and parsing ends. */
  error?(error: XMLError): void;
  /** A fatal error, which is thrown once this returns. */
  fatalError?(error: XMLError): void;
}

/** Every SAX handler method on one object; implement only those you need. */
export interface SAXHandler extends ContentHandler, LexicalHandler, DeclHandler, DTDHandler, SAXErrorHandler {}
