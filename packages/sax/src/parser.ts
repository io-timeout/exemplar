import {
  type AttributeDeclaration,
  type DtdItem,
  type EntityDeclaration,
  type ErrorHandler,
  EventType,
  type Source,
  type SourceObject,
  type XMLError,
  XMLInputFactory,
} from '@exemplarjs/xml';
import {
  CREATE_READER,
  DTD_ITEMS,
  INCLUDED_DECLARATIONS,
  LISTEN_ENTITIES,
  StreamReader,
  resolveURI,
} from '@exemplarjs/xml/internal';
import { NoXmlnsURIAttributes, ReaderAttributes } from './attributes.ts';
import type { Locator, SAXHandler } from './handler.ts';

// Module-level constants, so V8 can inline them; imported bindings are read again on every use.
const {
  START_ELEMENT,
  END_ELEMENT,
  CHARACTERS,
  CDATA,
  COMMENT,
  PROCESSING_INSTRUCTION,
  ENTITY_REFERENCE,
  SPACE,
  START_DOCUMENT,
  DTD,
  END_DOCUMENT,
  NEED_INPUT,
} = EventType;

/** What a SAX parser adds to its factory's options, after SAX's own features. */
export interface SAXOptions {
  /** Make system ids in declarations absolute, as SAX's `resolve-dtd-uris` does; true by default. */
  readonly resolveDTDURIs?: boolean;
  /** Put `xmlns` attributes in the xmlns namespace rather than in none, as SAX's `xmlns-uris` does; false by default. */
  readonly xmlnsURIs?: boolean;
}

/**
 * A SAX parser: it reads a document and calls a handler's methods as it goes, as SAX's `XMLReader`
 * does. The handler is one object with whichever of SAX's handler methods it needs:
 *
 * ```ts
 * new SAXParser().parse('<a>hi</a>', {
 *   startElement: (uri, localName) => console.log('start', localName),
 *   characters: (text) => console.log('text', text),
 * });
 * ```
 *
 * It reads through a cursor made by `factory`, so the factory's options apply; `options` adds the
 * SAX features the factory doesn't have.
 */
export class SAXParser {
  /** Makes the cursor each parse reads through. */
  readonly factory: XMLInputFactory;
  readonly options: SAXOptions;
  readonly #resolveDTDURIs: boolean;
  readonly #xmlnsURIs: boolean;

  constructor(factory: XMLInputFactory = new XMLInputFactory(), options: SAXOptions = {}) {
    this.factory = factory;
    this.options = options;
    this.#resolveDTDURIs = options.resolveDTDURIs ?? true;
    this.#xmlnsURIs = options.xmlnsURIs ?? false;
  }

  /** Parses a document, calling the handler's methods as it goes. */
  parse(source: Source, handler: SAXHandler): void {
    const reporting = new ErrorReporting();
    const dispatcher = this.#dispatcher(this.#reader(source, handler, false, reporting), handler, source, reporting);
    for (let type = dispatcher.reader.eventType(); !dispatcher.dispatch(type); type = dispatcher.reader.next());
  }

  /** Parses a stream or any other source, awaiting input as it arrives. */
  async parseAsync(source: Source, handler: SAXHandler): Promise<void> {
    const reporting = new ErrorReporting();
    const dispatcher = this.#dispatcher(this.#reader(source, handler, true, reporting), handler, source, reporting);
    for (let type = dispatcher.reader.eventType(); ; type = dispatcher.reader.next()) {
      if (type === NEED_INPUT) await dispatcher.reader.fill();
      else if (dispatcher.dispatch(type)) return;
    }
  }

  /** The dispatcher for one parse, with the `Attributes` the namespace features call for. */
  #dispatcher(reader: StreamReader, handler: SAXHandler, source: Source, reporting: ErrorReporting): EventDispatcher {
    const { namespaceAware, namespacePrefixes } = this.factory.options;
    const attributes =
      namespaceAware && namespacePrefixes && !this.#xmlnsURIs
        ? new NoXmlnsURIAttributes(reader, true)
        : new ReaderAttributes(reader, namespaceAware);
    const locator = new ReaderLocator(reader, source, reporting);
    return new EventDispatcher(reader, handler, locator, attributes, namespaceAware, this.#resolveDTDURIs);
  }

  /** A cursor whose errors go to the handler, falling back on the factory's error handler. */
  #reader(source: Source, handler: SAXHandler, async: boolean, reporting: ErrorReporting): StreamReader {
    const reader = this.factory[CREATE_READER](
      source,
      // SAX hears of entity boundaries through startEntity and endEntity, not as events.
      {
        errorHandler: errorHandlerFor(handler, this.factory.options.errorHandler, reporting),
        reportEntityBoundaries: false,
      },
      async
    );
    if (handler.startEntity !== undefined || handler.endEntity !== undefined) {
      reader[LISTEN_ENTITIES]({
        startEntity: (name) => handler.startEntity?.(name),
        endEntity: (name) => handler.endEntity?.(name),
      });
    }
    return reader;
  }
}

/** The error being reported, which the locator gives the position of while the handler hears of it, as the JDK's does. */
class ErrorReporting {
  error: XMLError | undefined;
}

/** The handler's error methods, each falling back on the factory's, with the error noted while each runs. */
function errorHandlerFor(handler: SAXHandler, fallback: ErrorHandler, reporting: ErrorReporting): ErrorHandler {
  const combined: { -readonly [K in keyof ErrorHandler]: ErrorHandler[K] } = {};
  for (const name of ['warning', 'error', 'fatalError'] as const) {
    const from = handler[name] === undefined ? fallback : handler;
    if (from[name] === undefined) continue;
    combined[name] = (error: XMLError) => {
      reporting.error = error;
      try {
        from[name]?.(error);
      } finally {
        reporting.error = undefined;
      }
    };
  }
  return combined;
}

/** The cursor's location, read as SAX's `Locator2`; each getter asks the cursor, or the error being reported, when called. */
class ReaderLocator implements Locator {
  readonly #reader: StreamReader;
  readonly #reporting: ErrorReporting;
  readonly #systemId: string | undefined;
  readonly #publicId: string | undefined;

  constructor(reader: StreamReader, source: Source, reporting: ErrorReporting) {
    this.#reader = reader;
    this.#reporting = reporting;
    // Strings, bytes and chunks carry no identifiers; a source object may give either or both.
    const object = typeof source === 'object' && !(source instanceof Uint8Array) ? (source as SourceObject) : undefined;
    this.#systemId = object?.systemId;
    this.#publicId = object?.publicId;
  }

  get lineNumber(): number {
    return (this.#reporting.error ?? this.#reader.location()).line;
  }

  get columnNumber(): number {
    return (this.#reporting.error ?? this.#reader.location()).column;
  }

  get systemId(): string | undefined {
    return (this.#reporting.error ?? this.#reader.location()).systemId ?? this.#systemId;
  }

  get publicId(): string | undefined {
    return this.#publicId;
  }

  get xmlVersion(): string {
    return this.#reader.version() ?? '1.0';
  }

  get encoding(): string | undefined {
    return this.#reader.encoding();
  }
}

/**
 * Turns one parse's cursor events into calls on the handler. SAX reports some things the cursor
 * doesn't, or reports them differently: prefix mappings around each element, the DTD's declarations
 * one by one, and CDATA as `characters` between `startCDATA` and `endCDATA`.
 */
class EventDispatcher {
  readonly reader: StreamReader;
  readonly #handler: SAXHandler;
  /** The `Attributes` passed to `startElement`, reading the cursor's current start tag. */
  readonly #attributes: ReaderAttributes;
  readonly #locator: ReaderLocator;
  readonly #namespaceAware: boolean;
  readonly #resolveDTDURIs: boolean;
  /**
   * The open elements' names, which their end tags report again: the namespace URI, local name and
   * qualified name of each, or with namespaces off, only the qualified name.
   */
  readonly #openElementNames: string[] = [];
  /** How many elements are open. */
  #depth = 0;
  /** Whether XInclude may add declarations as it includes content. */
  readonly #including: boolean;
  /** How many of those declarations the handler has heard of. */
  #includedReported = 0;

  constructor(
    reader: StreamReader,
    handler: SAXHandler,
    locator: ReaderLocator,
    attributes: ReaderAttributes,
    namespaceAware: boolean,
    resolveDTDURIs: boolean
  ) {
    this.reader = reader;
    this.#handler = handler;
    this.#locator = locator;
    this.#namespaceAware = namespaceAware;
    this.#resolveDTDURIs = resolveDTDURIs;
    this.#attributes = attributes;
    this.#including = reader[INCLUDED_DECLARATIONS] !== StreamReader.prototype[INCLUDED_DECLARATIONS];
  }

  /** A system id from a declaration, made absolute against its base when `resolve-dtd-uris` is on. */
  #resolvedSystemId(systemId: string, baseURI: string | undefined): string {
    return this.#resolveDTDURIs ? (resolveURI(systemId, baseURI) ?? systemId) : systemId;
  }

  /** Calls the handler for one event; returns true at the end of the document. */
  dispatch(type: EventType): boolean {
    const handler = this.#handler;
    const reader = this.reader;
    switch (type) {
      case START_ELEMENT: {
        if (this.#including) this.#reportIncluded();
        this.#startElement();
        break;
      }
      case END_ELEMENT: {
        this.#endElement();
        break;
      }
      case CHARACTERS: {
        if (handler.characters !== undefined) handler.characters(reader.text());
        break;
      }
      case CDATA: {
        handler.startCDATA?.();
        if (handler.characters !== undefined) handler.characters(reader.text());
        handler.endCDATA?.();
        break;
      }
      case COMMENT: {
        if (handler.comment !== undefined) handler.comment(reader.text());
        break;
      }
      case PROCESSING_INSTRUCTION: {
        handler.processingInstruction?.(reader.piTarget(), reader.piData());
        break;
      }
      case ENTITY_REFERENCE: {
        handler.skippedEntity?.(reader.name());
        break;
      }
      case SPACE: {
        // Inside the root, SPACE is whitespace a validator found in element content.
        if (this.#depth > 0) handler.ignorableWhitespace?.(reader.text());
        break;
      }
      default: {
        return this.#dispatchDocumentEvent(type);
      }
    }
    return false;
  }

  /** Calls the handler for the events that come once: the start and end of the document, and the DTD; true at the end. */
  #dispatchDocumentEvent(type: EventType): boolean {
    const handler = this.#handler;
    if (type === START_DOCUMENT) {
      handler.setDocumentLocator?.(this.#locator);
      handler.startDocument?.();
    } else if (type === DTD) {
      const doctype = this.reader.doctype();
      handler.startDTD?.(doctype.name, doctype.publicId, doctype.systemId);
      for (const item of this.reader[DTD_ITEMS]()) this.#dtdItem(item);
      handler.endDTD?.();
    } else if (type === END_DOCUMENT) {
      handler.endDocument?.();
      return true;
    }
    return false;
  }

  /** Reports a start tag, after the prefix mappings it declares. */
  #startElement(): void {
    const handler = this.#handler;
    const reader = this.reader;
    this.#depth++;
    const qName = reader.name();
    if (!this.#namespaceAware) {
      this.#openElementNames.push(qName);
      handler.startElement?.('', '', qName, this.#attributes);
      return;
    }
    if (handler.startPrefixMapping !== undefined) {
      for (let i = 0; i < reader.namespaceCount(); i++) {
        handler.startPrefixMapping(reader.namespacePrefix(i), reader.namespaceURI(i));
      }
    }
    const uri = reader.namespaceURI();
    const localName = reader.localName();
    this.#openElementNames.push(uri, localName, qName);
    handler.startElement?.(uri, localName, qName, this.#attributes);
  }

  /** Reports an end tag, then the end of the prefix mappings its start tag declared. */
  #endElement(): void {
    const handler = this.#handler;
    const reader = this.reader;
    this.#depth--;
    const open = this.#openElementNames;
    if (!this.#namespaceAware) {
      handler.endElement?.('', '', open.pop() as string);
      return;
    }
    const qName = open.pop() as string;
    const localName = open.pop() as string;
    handler.endElement?.(open.pop() as string, localName, qName);
    if (handler.endPrefixMapping !== undefined) {
      for (let i = 0; i < reader.namespaceCount(); i++) handler.endPrefixMapping(reader.namespacePrefix(i));
    }
  }

  /** Reports the declarations XInclude has added since the last start tag, as it includes the content naming them. */
  #reportIncluded(): void {
    const items = this.reader[INCLUDED_DECLARATIONS]();
    for (; this.#includedReported < items.length; this.#includedReported++) {
      this.#dtdItem(items[this.#includedReported] as DtdItem);
    }
  }

  /** Reports one thing the DTD held. */
  #dtdItem(item: DtdItem): void {
    const handler = this.#handler;
    switch (item.kind) {
      case 'entity': {
        this.#entityDeclaration(item.declaration);
        break;
      }
      case 'element': {
        handler.elementDecl?.(item.declaration.name, item.declaration.content);
        break;
      }
      case 'attribute': {
        const { element, name, value } = item.declaration;
        handler.attributeDecl?.(
          element,
          name,
          attributeType(item.declaration),
          DEFAULT_MODE_KEYWORDS[item.declaration.mode],
          value
        );
        break;
      }
      case 'notation': {
        const { name, publicId, systemId, baseURI } = item.declaration;
        handler.notationDecl?.(
          name,
          publicId,
          systemId === undefined ? undefined : this.#resolvedSystemId(systemId, baseURI)
        );
        break;
      }
      case 'pi': {
        handler.processingInstruction?.(item.target, item.data);
        break;
      }
      case 'comment': {
        handler.comment?.(item.text);
        break;
      }
      case 'startEntity': {
        handler.startEntity?.(item.name);
        break;
      }
      case 'skippedEntity': {
        handler.skippedEntity?.(item.name);
        break;
      }
      default: {
        handler.endEntity?.(item.name);
      }
    }
  }

  /** Reports an entity declaration: internal, external or unparsed; parameter entities are named `%name`. */
  #entityDeclaration(entity: EntityDeclaration): void {
    const handler = this.#handler;
    const name = entity.isParameterEntity ? `%${entity.name}` : entity.name;
    if (entity.value !== undefined) {
      handler.internalEntityDecl?.(name, entity.value);
      return;
    }
    const systemId = this.#resolvedSystemId(entity.systemId ?? '', entity.baseURI);
    if (entity.notation === undefined) handler.externalEntityDecl?.(name, entity.publicId, systemId);
    else handler.unparsedEntityDecl?.(name, entity.publicId, systemId, entity.notation);
  }
}

/** How SAX's `attributeDecl` writes each default mode; undefined for a plain default value. */
const DEFAULT_MODE_KEYWORDS: Readonly<Record<AttributeDeclaration['mode'], string | undefined>> = {
  REQUIRED: '#REQUIRED',
  IMPLIED: '#IMPLIED',
  FIXED: '#FIXED',
  DEFAULT: undefined,
};

/** An attribute type as SAX's `attributeDecl` writes it: enumerations as `(a|b)`, notations as `NOTATION (a|b)`. */
function attributeType(declaration: AttributeDeclaration): string {
  const values = `(${(declaration.values ?? []).join('|')})`;
  if (declaration.type === 'ENUMERATION') return values;
  return declaration.type === 'NOTATION' ? `NOTATION ${values}` : declaration.type;
}
