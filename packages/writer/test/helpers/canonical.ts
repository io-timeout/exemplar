import { EventType, type InputOptions, type Source, type StreamReader, XMLInputFactory } from '@exemplarjs/xml';
import { byCodeUnit } from '@exemplarjs/xml/internal';

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
function startTag(reader: StreamReader): string {
  const attributes: [string, string][] = [];
  for (let i = 0; i < reader.attributeCount(); i++)
    attributes.push([reader.attributeName(i), reader.attributeValue(i)]);
  const written = attributes
    .toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([name, value]) => ` ${name}="${escape(value)}"`);
  return `<${reader.name()}${written.join('')}>`;
}

/** Writes one event in the first canonical form; comments, the DOCTYPE and skipped entities write nothing. */
export function write(reader: StreamReader, event: EventType): string {
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

/** Returns a document's canonical form, or throws the XMLError it raises. */
export function canonical(source: Source, options: InputOptions = {}): string {
  return canonicalOf(new XMLInputFactory(options).createStreamReader(source));
}

/** An expanded name as `{uri}local`, or the local name alone in no namespace. */
function expanded(uri: string, localName: string): string {
  return uri === '' ? localName : `{${uri}}${localName}`;
}

/** A document's element and attribute names as namespaces expand them: `{uri}local`, `@{uri}local=value` and `/` ends. */
export function names(source: Source, options: InputOptions = {}): string[] {
  const reader = new XMLInputFactory(options).createStreamReader(source);
  const out: string[] = [];
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.START_ELEMENT) {
      out.push(expanded(reader.namespaceURI(), reader.localName()));
      const attributes: string[] = [];
      for (let i = 0; i < reader.attributeCount(); i++) {
        attributes.push(
          `@${expanded(reader.attributeNamespace(i), reader.attributeLocalName(i))}=${reader.attributeValue(i)}`
        );
      }
      out.push(...attributes.toSorted(byCodeUnit));
    } else if (event === EventType.END_ELEMENT) {
      out.push(`/${expanded(reader.namespaceURI(), reader.localName())}`);
    }
  }
  return out;
}
