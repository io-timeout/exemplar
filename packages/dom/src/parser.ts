import { StringSink, XMLOutputFactory } from '@exemplarjs/writer';
import { XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { XMLNS_NAMESPACE } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { DocumentBuilder } from './builder.ts';
import { fail } from './names.ts';
import { type Document, Element, type Node, Text } from './nodes/index.ts';

/** The namespace Firefox puts its `parsererror` element in. */
// eslint-disable-next-line no-clear-text-protocols -- a namespace name, never fetched
export const PARSER_ERROR_NAMESPACE = 'http://www.mozilla.org/newlayout/xml/parsererror.xml';

/** The types `parseFromString` reads as XML. */
const XML_TYPES = new Set(['text/xml', 'application/xml', 'application/xhtml+xml', 'image/svg+xml']);

/** Parses strings into documents as browsers' `DOMParser` does: errors give a `parsererror` document. */
export class DOMParser {
  readonly #builder: DocumentBuilder;

  constructor(factory: XMLInputFactory = new XMLInputFactory()) {
    this.#builder = new DocumentBuilder(factory);
  }

  parseFromString(string: string, type: string): Document {
    if (type === 'text/html') fail('NotSupportedError', 'exemplar parses XML, not HTML');
    if (!XML_TYPES.has(type)) throw ErrorFactory.create(TypeError, `${type} is not a type DOMParser supports`);
    try {
      return this.#builder.parse(String(string));
    } catch (error) {
      const parseError = ErrorFactory.expect(error, XMLError);
      return errorDocument(this.#builder, parseError, String(string));
    }
  }
}

/** A document holding a `parsererror` element that describes the error, as Firefox makes one. */
function errorDocument(builder: DocumentBuilder, error: XMLError, text: string): Document {
  const document = builder.newDocument();
  const root = new Element(document, 'parsererror', PARSER_ERROR_NAMESPACE, 'parsererror');
  const where = `Location: ${error.systemId ?? 'about:blank'}\nLine Number ${error.line}, Column ${error.column}:`;
  root._append(new Text(document, `XML Parsing Error: ${error.message}\n${where}`));
  const line = text.split(/\r\n?|\n/)[error.line - 1];
  if (line !== undefined) {
    const source = new Element(document, 'sourcetext', PARSER_ERROR_NAMESPACE, 'sourcetext');
    const caret = '-'.repeat(Math.max(0, error.column - 1));
    source._append(new Text(document, `${line}\n${caret}^`));
    root._append(source);
  }
  const xmlns = document.createAttributeNS(XMLNS_NAMESPACE, 'xmlns');
  xmlns.value = PARSER_ERROR_NAMESPACE;
  root.setAttributeNodeNS(xmlns);
  document._append(root);
  return document;
}

const SERIALIZER = new XMLOutputFactory({ omitXMLDeclaration: true, checkWellFormedness: false });

/** Serializes nodes to strings as browsers' `XMLSerializer` does. */
export class XMLSerializer {
  serializeToString(node: Node): string {
    const sink = new StringSink();
    const writer = SERIALIZER.createStreamWriter(sink);
    writer.writeNode(node);
    writer.flush();
    return sink.toString();
  }
}
