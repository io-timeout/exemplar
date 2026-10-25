import type { XMLError } from '@exemplarjs/xml';
import type { Attributes, Locator, SAXHandler } from './handler.ts';

/** Sits between the parser and a handler, passing every event on; override methods to change events, calling `super`. */
export class XMLFilterImpl implements SAXHandler {
  /** The handler events are passed to. */
  handler: SAXHandler;

  constructor(handler: SAXHandler = {}) {
    this.handler = handler;
  }

  setDocumentLocator(locator: Locator): void {
    this.handler.setDocumentLocator?.(locator);
  }

  startDocument(): void {
    this.handler.startDocument?.();
  }

  endDocument(): void {
    this.handler.endDocument?.();
  }

  startPrefixMapping(prefix: string, uri: string): void {
    this.handler.startPrefixMapping?.(prefix, uri);
  }

  endPrefixMapping(prefix: string): void {
    this.handler.endPrefixMapping?.(prefix);
  }

  startElement(uri: string, localName: string, qName: string, attributes: Attributes): void {
    this.handler.startElement?.(uri, localName, qName, attributes);
  }

  endElement(uri: string, localName: string, qName: string): void {
    this.handler.endElement?.(uri, localName, qName);
  }

  characters(text: string): void {
    this.handler.characters?.(text);
  }

  ignorableWhitespace(text: string): void {
    this.handler.ignorableWhitespace?.(text);
  }

  processingInstruction(target: string, data: string): void {
    this.handler.processingInstruction?.(target, data);
  }

  skippedEntity(name: string): void {
    this.handler.skippedEntity?.(name);
  }

  startDTD(name: string, publicId: string | undefined, systemId: string | undefined): void {
    this.handler.startDTD?.(name, publicId, systemId);
  }

  endDTD(): void {
    this.handler.endDTD?.();
  }

  startEntity(name: string): void {
    this.handler.startEntity?.(name);
  }

  endEntity(name: string): void {
    this.handler.endEntity?.(name);
  }

  startCDATA(): void {
    this.handler.startCDATA?.();
  }

  endCDATA(): void {
    this.handler.endCDATA?.();
  }

  comment(text: string): void {
    this.handler.comment?.(text);
  }

  elementDecl(name: string, model: string): void {
    this.handler.elementDecl?.(name, model);
  }

  attributeDecl(
    elementName: string,
    attributeName: string,
    type: string,
    mode: string | undefined,
    value: string | undefined
  ): void {
    this.handler.attributeDecl?.(elementName, attributeName, type, mode, value);
  }

  internalEntityDecl(name: string, value: string): void {
    this.handler.internalEntityDecl?.(name, value);
  }

  externalEntityDecl(name: string, publicId: string | undefined, systemId: string): void {
    this.handler.externalEntityDecl?.(name, publicId, systemId);
  }

  notationDecl(name: string, publicId: string | undefined, systemId: string | undefined): void {
    this.handler.notationDecl?.(name, publicId, systemId);
  }

  unparsedEntityDecl(name: string, publicId: string | undefined, systemId: string, notationName: string): void {
    this.handler.unparsedEntityDecl?.(name, publicId, systemId, notationName);
  }

  warning(error: XMLError): void {
    this.handler.warning?.(error);
  }

  /** Passes a recoverable error on; with no handler for it, it is thrown, as the cursor does. */
  error(error: XMLError): void {
    if (this.handler.error === undefined) throw error;
    this.handler.error(error);
  }

  fatalError(error: XMLError): void {
    this.handler.fatalError?.(error);
  }
}
