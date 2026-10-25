import { type AsyncStreamReader, EventType, type StreamReader, type XMLEvent } from '@exemplarjs/xml';
import { byCodeUnit } from '@exemplarjs/xml/internal';
import type { Attributes, SAXHandler } from '@/index.ts';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;',
};

/** Escapes character data and attribute values as the suite's canonical form does. */
function escape(text: string): string {
  return text.replaceAll(/[&<>"\t\n\r]/g, (c) => ESCAPES[c] ?? c);
}

/** Writes a start tag with its attributes sorted by name. */
function startTag(reader: StreamReader | AsyncStreamReader): string {
  const attributes: [string, string][] = [];
  for (let i = 0; i < reader.attributeCount(); i++)
    attributes.push([reader.attributeName(i), reader.attributeValue(i)]);
  const written = attributes
    .toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([name, value]) => ` ${name}="${escape(value)}"`);
  return `<${reader.name()}${written.join('')}>`;
}

/** Writes one event in the first canonical form; comments, the DOCTYPE and skipped entities write nothing. */
export function write(reader: StreamReader | AsyncStreamReader, event: EventType): string {
  switch (event) {
    case EventType.START_ELEMENT: {
      return startTag(reader);
    }
    case EventType.END_ELEMENT: {
      return `</${reader.name()}>`;
    }
    case EventType.CHARACTERS:
    case EventType.SPACE:
    case EventType.CDATA: {
      return escape(reader.text());
    }
    case EventType.PROCESSING_INSTRUCTION: {
      return `<?${reader.piTarget()} ${reader.piData()}?>`;
    }
    default: {
      return '';
    }
  }
}

/** Reads a document to its end and returns it in the suite's first canonical form. */
export function canonicalOf(reader: StreamReader): string {
  let out = '';
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) out += write(reader, event);
  return out;
}

/** Reads a document with an asynchronous reader, awaiting `fill()` whenever it needs input. */
export async function canonicalOfAsync(reader: AsyncStreamReader): Promise<string> {
  let out = '';
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.NEED_INPUT) await reader.fill();
    else out += write(reader, event);
  }
  return out;
}

/** Writes a start tag from a name and its attributes, sorted by name. */
function tag(name: string, attributes: readonly (readonly [string, string])[]): string {
  const written = attributes
    .toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([attribute, value]) => ` ${attribute}="${escape(value)}"`);
  return `<${name}${written.join('')}>`;
}

/** Writes one event object in the first canonical form. */
export function writeEvent(event: XMLEvent): string {
  switch (event.type) {
    case EventType.START_ELEMENT: {
      return tag(
        event.name.toString(),
        event.attributes.map((a) => [a.toString(), a.value] as const)
      );
    }
    case EventType.END_ELEMENT: {
      return `</${event.name.toString()}>`;
    }
    case EventType.CHARACTERS:
    case EventType.SPACE:
    case EventType.CDATA: {
      return escape(event.text);
    }
    case EventType.PROCESSING_INSTRUCTION: {
      return `<?${event.target} ${event.data}?>`;
    }
    default: {
      return '';
    }
  }
}

/** A SAX handler that writes the first canonical form, and what it has written; PIs in the DTD are left out. */
export function canonicalHandler(): { handler: SAXHandler; written: () => string } {
  let out = '';
  let inDtd = false;
  const handler: SAXHandler = {
    startDTD: () => {
      inDtd = true;
    },
    endDTD: () => {
      inDtd = false;
    },
    startElement: (_uri: string, _localName: string, qName: string, attributes: Attributes) => {
      const pairs = Array.from(
        { length: attributes.length },
        (_, i) => [attributes.qName(i), attributes.value(i)] as const
      );
      out += tag(qName, pairs);
    },
    endElement: (_uri, _localName, qName) => {
      out += `</${qName}>`;
    },
    characters: (text) => {
      out += escape(text);
    },
    processingInstruction: (target, data) => {
      if (!inDtd) out += `<?${target} ${data}?>`;
    },
  };
  return { handler, written: () => out };
}

/** An expanded name as `{uri}local`, or the local name alone in no namespace. */
function expanded(uri: string, localName: string): string {
  return uri === '' ? localName : `{${uri}}${localName}`;
}

/** The cursor's names in order: `+p=uri` and `-p` around elements, `{uri}local` starts, `@{uri}local=value` attributes, `/` ends. */
export function namesOf(reader: StreamReader): string[] {
  const out: string[] = [];
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.START_ELEMENT) {
      for (let i = 0; i < reader.namespaceCount(); i++)
        out.push(`+${reader.namespacePrefix(i)}=${reader.namespaceURI(i)}`);
      out.push(expanded(reader.namespaceURI(), reader.localName()));
      const attributes: string[] = [];
      for (let i = 0; i < reader.attributeCount(); i++) {
        const name = expanded(reader.attributeNamespace(i), reader.attributeLocalName(i));
        attributes.push(`@${name}=${reader.attributeValue(i)}`);
      }
      out.push(...attributes.toSorted(byCodeUnit));
    } else if (event === EventType.END_ELEMENT) {
      out.push(`/${expanded(reader.namespaceURI(), reader.localName())}`);
      for (let i = 0; i < reader.namespaceCount(); i++) out.push(`-${reader.namespacePrefix(i)}`);
    }
  }
  return out;
}

/** A SAX handler that records names as `namesOf` writes them. */
export function namesHandler(): { handler: SAXHandler; names: string[] } {
  const names: string[] = [];
  const handler: SAXHandler = {
    startPrefixMapping: (prefix, uri) => names.push(`+${prefix}=${uri}`),
    startElement: (uri, localName, _qName, attributes) => {
      names.push(expanded(uri, localName));
      const list = Array.from(
        { length: attributes.length },
        (_, i) => `@${expanded(attributes.uri(i), attributes.localName(i))}=${attributes.value(i)}`
      );
      names.push(...list.toSorted(byCodeUnit));
    },
    endElement: (uri, localName) => names.push(`/${expanded(uri, localName)}`),
    endPrefixMapping: (prefix) => names.push(`-${prefix}`),
  };
  return { handler, names };
}
