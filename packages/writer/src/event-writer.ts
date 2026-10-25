import {
  type AsyncEventReader,
  type EventReader,
  EventType,
  type StartElementEvent,
  type XMLEvent,
} from '@exemplarjs/xml';
import { XMLNS_NAMESPACE } from '@exemplarjs/xml/internal';
import type { StreamWriter } from './stream-writer.ts';

/** Writes event objects, following StAX's `XMLEventWriter`; it takes the event reader's events, so a loop copies a document. */
export class EventWriter {
  readonly #writer: StreamWriter;

  constructor(writer: StreamWriter) {
    this.#writer = writer;
  }

  /** Writes one event, or every event an event reader gives. */
  add(event: XMLEvent | EventReader): void {
    if ('nextEvent' in event) {
      for (const each of event) this.#write(each);
      return;
    }
    this.#write(event);
  }

  /** Writes every event an async event reader gives, waiting for the destination to have room after each batch. */
  async addAsync(reader: AsyncEventReader): Promise<void> {
    for await (const batch of reader.batches()) {
      for (const event of batch) this.#write(event);
      await this.#writer.drain();
    }
  }

  /** Writes one event by the stream writer call it matches. */
  #write(event: XMLEvent): void {
    const writer = this.#writer;
    switch (event.type) {
      case EventType.START_ELEMENT: {
        this.#startElement(event);
        break;
      }
      case EventType.END_ELEMENT: {
        writer.writeEndElement();
        break;
      }
      case EventType.CHARACTERS:
      case EventType.SPACE: {
        writer.writeCharacters(event.text);
        break;
      }
      case EventType.CDATA: {
        writer.writeCData(event.text);
        break;
      }
      case EventType.COMMENT: {
        writer.writeComment(event.text);
        break;
      }
      case EventType.PROCESSING_INSTRUCTION: {
        writer.writeProcessingInstruction(event.target, event.data);
        break;
      }
      case EventType.DTD: {
        writer.writeDTD(event.text);
        break;
      }
      case EventType.ENTITY_REFERENCE: {
        writer.writeEntityRef(event.name);
        break;
      }
      case EventType.START_DOCUMENT: {
        writer.writeStartDocument(event.version ?? '1.0', undefined, event.standalone);
        break;
      }
      case EventType.START_ENTITY:
      case EventType.END_ENTITY: {
        // The expanded content is written; its boundaries add nothing.
        break;
      }
      default: {
        writer.writeEndDocument();
      }
    }
  }

  /** Writes a start tag with its namespace declarations and attributes. */
  #startElement(event: StartElementEvent): void {
    const writer = this.#writer;
    const { prefix, localName, namespaceURI } = event.name;
    writer.writeStartElement(prefix, localName, namespaceURI);
    for (const namespace of event.namespaces) writer.writeNamespace(namespace.prefix, namespace.namespaceURI);
    for (const attribute of event.attributes) {
      // Declarations reported as attributes are written from the namespaces already.
      if (attribute.namespaceURI !== XMLNS_NAMESPACE) {
        writer.writeAttribute(attribute.prefix, attribute.namespaceURI, attribute.localName, attribute.value);
      }
    }
  }

  /** Hands what has been written to the sink. */
  flush(): void {
    this.#writer.flush();
  }

  /** Resolves when the destination has room for more, as the stream writer's `drain()` does. */
  drain(): Promise<void> {
    return this.#writer.drain();
  }

  /** Flushes and closes the sink. */
  close(): Promise<void> {
    return this.#writer.close();
  }
}
