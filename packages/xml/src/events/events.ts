import { EventType } from '../cursor/event-type.ts';
import { EVENT_OFFSET, EVENT_POSITION, copyString } from '../cursor/internal.ts';
import type { Doctype, StreamReader } from '../cursor/stream-reader.ts';
import type { Location } from '../errors/xml-error.ts';
import { LineSegment } from '../tokenizer/lines.ts';

/** A namespace-qualified name, as StAX's `QName` is: `xs:element` in the namespace `xs` is bound to. */
export class QName {
  /** The namespace URI, `''` for none. */
  readonly namespaceURI: string;
  readonly localName: string;
  /** The prefix as written, `''` for none. */
  readonly prefix: string;

  constructor(namespaceURI: string, localName: string, prefix = '') {
    this.namespaceURI = namespaceURI;
    this.localName = localName;
    this.prefix = prefix;
  }

  /** The qualified name as written: `prefix:localName`, or the local name alone. */
  toString(): string {
    return this.prefix === '' ? this.localName : `${this.prefix}:${this.localName}`;
  }
}

/** An attribute of a start tag; it is a QName itself, so `name` returns the attribute. */
export class Attribute extends QName {
  /** The value, normalized for the attribute's type. */
  readonly value: string;
  /** The type the DTD declares, CDATA when it declares none. */
  readonly type: string;
  /** Whether the attribute was in the start tag rather than defaulted from the DTD. */
  readonly specified: boolean;

  constructor(
    namespaceURI: string,
    localName: string,
    prefix: string,
    value: string,
    type: string,
    specified: boolean
  ) {
    super(namespaceURI, localName, prefix);
    this.value = value;
    this.type = type;
    this.specified = specified;
  }

  /** The attribute's name. */
  get name(): QName {
    return this;
  }
}

/** A namespace declaration; the prefix is the empty string for the default namespace. */
export interface Namespace {
  /** The prefix declared, `''` for the default namespace. */
  readonly prefix: string;
  /** The namespace URI it is bound to, `''` when the declaration undeclares it. */
  readonly namespaceURI: string;
}

/** What every event has. */
interface EventBase {
  /** Where the event starts, worked out when first asked for. */
  readonly location: Location;
}

/** The start of the document, with what its XML declaration says. */
export interface StartDocumentEvent extends EventBase {
  readonly type: typeof EventType.START_DOCUMENT;
  /** The version the XML declaration names, if there is one. */
  readonly version: string | undefined;
  /** The encoding the XML declaration names, or else the one detection chose. */
  readonly encoding: string | undefined;
  /** The XML declaration's `standalone`, if it has one. */
  readonly standalone: boolean | undefined;
}

/** The end of the document. */
export interface EndDocumentEvent extends EventBase {
  readonly type: typeof EventType.END_DOCUMENT;
}

/** A start tag, or the start of an empty-element tag such as `<br/>`. */
export interface StartElementEvent extends EventBase {
  readonly type: typeof EventType.START_ELEMENT;
  readonly name: QName;
  /** The attributes, with any the DTD defaults; `xmlns` declarations only with `namespacePrefixes`. */
  readonly attributes: readonly Attribute[];
  /** The namespaces the start tag declares. */
  readonly namespaces: readonly Namespace[];
  /** The attribute with a local name and namespace URI, `''` for none. */
  attribute(localName: string, namespaceURI?: string): Attribute | undefined;
}

/** An end tag, or the end of an empty-element tag. */
export interface EndElementEvent extends EventBase {
  readonly type: typeof EventType.END_ELEMENT;
  readonly name: QName;
  /** The namespaces going out of scope. */
  readonly namespaces: readonly Namespace[];
}

/** Character data: text, a CDATA section, or whitespace a validator found in element content (SPACE). */
export interface CharactersEvent extends EventBase {
  readonly type: typeof EventType.CHARACTERS | typeof EventType.CDATA | typeof EventType.SPACE;
  readonly text: string;
}

/** A comment. */
export interface CommentEvent extends EventBase {
  readonly type: typeof EventType.COMMENT;
  readonly text: string;
}

/** A processing instruction, `<?target data?>`. */
export interface ProcessingInstructionEvent extends EventBase {
  readonly type: typeof EventType.PROCESSING_INSTRUCTION;
  /** The target, the name after `<?`. */
  readonly target: string;
  /** Everything after the target and its whitespace, up to `?>`. */
  readonly data: string;
}

/** The DOCTYPE, with the declarations its DTD made. */
export interface DTDEvent extends EventBase {
  readonly type: typeof EventType.DTD;
  /** The DOCTYPE as written. */
  readonly text: string;
  /** The DOCTYPE's name and identifiers, and the entities and notations its DTD declared. */
  readonly doctype: Doctype;
}

/** A reference to an entity that was not expanded, such as `&chapter;` with `replaceEntityReferences` off. */
export interface EntityReferenceEvent extends EventBase {
  readonly type: typeof EventType.ENTITY_REFERENCE;
  /** The entity's name. */
  readonly name: string;
  /** Its replacement text, when it was declared and read. */
  readonly text: string;
}

/** With `reportEntityBoundaries`: where an expanded entity starts or ends. */
export interface EntityBoundaryEvent extends EventBase {
  readonly type: typeof EventType.START_ENTITY | typeof EventType.END_ENTITY;
  /** The entity's name. */
  readonly name: string;
}

/** An event as an object, following StAX's `XMLEvent`; switch on `type` to narrow it. */
export type XMLEvent =
  | StartDocumentEvent
  | EndDocumentEvent
  | StartElementEvent
  | EndElementEvent
  | CharactersEvent
  | CommentEvent
  | ProcessingInstructionEvent
  | DTDEvent
  | EntityReferenceEvent
  | EntityBoundaryEvent;

/** How many element names a builder shares before it stops adding them. */
const QNAME_CACHE_SIZE = 4096;

/** No attributes and no namespaces, shared so that events without them allocate nothing. */
const NO_ATTRIBUTES: readonly Attribute[] = Object.freeze([]);
const NO_NAMESPACES: readonly Namespace[] = Object.freeze([]);

/** An element's name, or a PI's target or an entity's name. */
type EventName = QName | string | undefined;

/** The DOCTYPE for DTD events, or the XML declaration's values for START_DOCUMENT. */
type EventDetails = Doctype | DocumentDetails | undefined;

/**
 * Every kind of event, as one class. Code that handles events then sees one object shape, which V8
 * optimizes better than a class per kind; the getters give each kind's own properties.
 */
class Event {
  readonly type: EventType;
  readonly name: EventName;
  readonly attributes: readonly Attribute[];
  readonly namespaces: readonly Namespace[];
  /** The text of character data, comments, the DOCTYPE and entity references, and a PI's data. */
  readonly text: string;
  /** The DOCTYPE for DTD, or the XML declaration's values for START_DOCUMENT. */
  readonly details: EventDetails;
  /** The line segment that will find the location, until it has been found; then the location. */
  #where: LineSegment | Location;
  /** The document offset where the event starts. */
  readonly #offset: number;

  // eslint-disable-next-line max-params -- one positional constructor: an options object would cost an allocation per event
  constructor(
    type: EventType,
    name: EventName,
    attributes: readonly Attribute[],
    namespaces: readonly Namespace[],
    text: string,
    details: EventDetails,
    where: LineSegment | Location,
    offset: number
  ) {
    this.type = type;
    this.name = name;
    this.attributes = attributes;
    this.namespaces = namespaces;
    this.text = text;
    this.details = details;
    this.#where = where;
    this.#offset = offset;
  }

  /** Where the event starts, worked out from the line segment the first time it is asked for. */
  get location(): Location {
    if (this.#where instanceof LineSegment) this.#where = this.#where.locate(this.#offset);
    return this.#where;
  }

  /** A PI's target; `''` for any other event. */
  get target(): string {
    return this.type === EventType.PROCESSING_INSTRUCTION ? (this.name as string) : '';
  }

  /** A PI's data; `''` for any other event. */
  get data(): string {
    return this.type === EventType.PROCESSING_INSTRUCTION ? this.text : '';
  }

  /** The DOCTYPE, for a DTD event. */
  get doctype(): Doctype | undefined {
    return this.type === EventType.DTD ? (this.details as Doctype) : undefined;
  }

  /** For START_DOCUMENT, the version the XML declaration names. */
  get version(): string | undefined {
    return this.type === EventType.START_DOCUMENT ? (this.details as DocumentDetails).version : undefined;
  }

  /** For START_DOCUMENT, the encoding the XML declaration names, or else the one detection chose. */
  get encoding(): string | undefined {
    return this.type === EventType.START_DOCUMENT ? (this.details as DocumentDetails).encoding : undefined;
  }

  /** For START_DOCUMENT, the XML declaration's `standalone`. */
  get standalone(): boolean | undefined {
    return this.type === EventType.START_DOCUMENT ? (this.details as DocumentDetails).standalone : undefined;
  }

  /** A start tag's attribute with a local name and namespace URI, `''` for none. */
  attribute(localName: string, namespaceURI = ''): Attribute | undefined {
    return this.attributes.find(
      (attribute) => attribute.name.localName === localName && attribute.name.namespaceURI === namespaceURI
    );
  }
}

/** The XML declaration's values, as START_DOCUMENT reports them. */
interface DocumentDetails {
  readonly version: string | undefined;
  readonly encoding: string | undefined;
  readonly standalone: boolean | undefined;
}

/**
 * Builds event objects from a cursor. Their strings are copied, so an event doesn't keep the input
 * alive; element names are shared between events with the same name, and an end tag reuses its
 * start tag's name and namespaces.
 */
export class EventBuilder {
  /** The open elements' names, which their end tags report again. */
  readonly #names: QName[] = [];
  /** The open elements' namespace declarations, which their end tags report going out of scope. */
  readonly #namespaces: (readonly Namespace[])[] = [];
  /** Element names seen so far, by qualified name, up to QNAME_CACHE_SIZE. */
  readonly #qnames = new Map<string, QName>();

  /** The event the cursor is at, as an object; `type` is the cursor's current event type. */
  build(reader: StreamReader, type: EventType): XMLEvent {
    const where = reader[EVENT_POSITION]();
    const offset = reader[EVENT_OFFSET];
    let name: EventName;
    let attributes = NO_ATTRIBUTES;
    let namespaces = NO_NAMESPACES;
    let text = '';
    let details: EventDetails;
    switch (type) {
      case EventType.START_ELEMENT: {
        const qname = this.#qname(reader);
        name = qname;
        namespaces = namespacesOf(reader);
        attributes = attributesOf(reader);
        this.#names.push(qname);
        this.#namespaces.push(namespaces);
        break;
      }
      case EventType.END_ELEMENT: {
        name = this.#names.pop() as QName;
        namespaces = this.#namespaces.pop() as readonly Namespace[];
        break;
      }
      case EventType.CHARACTERS:
      case EventType.CDATA:
      case EventType.SPACE:
      case EventType.COMMENT:
      case EventType.DTD: {
        details = type === EventType.DTD ? reader.doctype() : undefined;
        text = copyString(reader.text());
        break;
      }
      case EventType.PROCESSING_INSTRUCTION: {
        text = copyString(reader.piData());
        name = copyString(reader.piTarget());
        break;
      }
      case EventType.START_ENTITY:
      case EventType.END_ENTITY:
      case EventType.ENTITY_REFERENCE: {
        if (type === EventType.ENTITY_REFERENCE) text = copyString(reader.text());
        name = reader.name();
        break;
      }
      case EventType.START_DOCUMENT: {
        details = { version: reader.version(), encoding: reader.encoding(), standalone: reader.standalone() };
        break;
      }
      default:
    }
    return new Event(type, name, attributes, namespaces, text, details, where, offset) as unknown as XMLEvent;
  }

  /** The current element's name, shared with earlier elements of the same name and namespace. */
  #qname(reader: StreamReader): QName {
    const qName = reader.name();
    const uri = reader.namespaceURI();
    let name = this.#qnames.get(qName);
    if (name?.namespaceURI !== uri) {
      name = new QName(copyString(uri), copyString(reader.localName()), reader.prefix());
      if (this.#qnames.size < QNAME_CACHE_SIZE) this.#qnames.set(copyString(qName), name);
    }
    return name;
  }
}

/** The start tag's attributes, with copied values. */
function attributesOf(reader: StreamReader): readonly Attribute[] {
  const count = reader.attributeCount();
  if (count === 0) return NO_ATTRIBUTES;
  const attributes: Attribute[] = [];
  for (let i = 0; i < count; i++) {
    const uri = copyString(reader.attributeNamespace(i));
    const localName = copyString(reader.attributeLocalName(i));
    const value = copyString(reader.attributeValue(i));
    const type = reader.attributeType(i);
    attributes.push(
      new Attribute(uri, localName, reader.attributePrefix(i), value, type, reader.isAttributeSpecified(i))
    );
  }
  return attributes;
}

/** The namespaces a start tag declares, or an end tag takes out of scope. */
function namespacesOf(reader: StreamReader): readonly Namespace[] {
  const count = reader.namespaceCount();
  if (count === 0) return NO_NAMESPACES;
  const namespaces: Namespace[] = [];
  for (let i = 0; i < count; i++) {
    namespaces.push({ prefix: reader.namespacePrefix(i), namespaceURI: copyString(reader.namespaceURI(i)) });
  }
  return namespaces;
}
