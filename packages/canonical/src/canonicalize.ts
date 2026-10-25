import {
  ErrorCode,
  EventType,
  type StreamReader as PublicStreamReader,
  type Source,
  XMLError,
  XMLInputFactory,
} from '@exemplarjs/xml';
import {
  CREATE_READER,
  Char,
  DTD_COMPLETE,
  type StreamReader,
  XMLNS_NAMESPACE,
  byCodeUnit,
  declaredPrefixes,
  hasScheme,
  isReader,
  isRestrictedChar,
  namespacesInScope,
} from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { Canonicalizer, type CanonicalAttribute, sortAttributes } from './render.ts';
import { type CanonicalNode, TreeCanonicalizer, isNode } from './tree.ts';

/** The canonical forms: Canonical XML 1.0 and 1.1, Exclusive Canonicalization, and the XML suite's first and second forms. */
export type CanonicalMethod = 'c14n' | 'c14n11' | 'exc-c14n' | 'suite-first' | 'suite-second';

/** How to canonicalize. */
export interface CanonicalizeOptions {
  /** The form; Canonical XML 1.0 by default. */
  readonly method?: CanonicalMethod;
  /** Keep comments, for the Canonical XML forms. */
  readonly comments?: boolean;
  /** For Exclusive Canonicalization, prefixes treated inclusively; `#default` names the default namespace. */
  readonly inclusivePrefixes?: readonly string[];
  /** A string, the default, or UTF-8 bytes. */
  readonly output?: 'string' | 'bytes';
  /** The factory whose resolvers and access lists read the DTD and external entities. */
  readonly factory?: XMLInputFactory;
}

/** The references the suite's forms write for markup and whitespace characters. */
const SUITE_REFERENCES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;',
};

/** Whether the suite's forms of an XML 1.1 document write a code point as a reference: a RestrictedChar, or NEL. */
function isRestrictedOrNextLine(code: number): boolean {
  return isRestrictedChar(code) || code === Char.NEXT_LINE;
}

/** Orders a start tag's attributes by name. */
function byName([a]: [string, string], [b]: [string, string]): number {
  return byCodeUnit(a, b);
}

/** What canonicalize reads: a source, a cursor, or a DOM node. */
export type CanonicalInput = Source | PublicStreamReader | CanonicalNode;

/** Canonicalizes a document read from a source or a cursor, or a DOM node as a document subset. */
export function canonicalize(input: CanonicalInput, options: CanonicalizeOptions & { output: 'bytes' }): Uint8Array;
export function canonicalize(input: CanonicalInput, options?: CanonicalizeOptions): string;
export function canonicalize(input: CanonicalInput, options: CanonicalizeOptions = {}): string | Uint8Array {
  const method = options.method ?? 'c14n';
  const isSuiteForm = method === 'suite-first' || method === 'suite-second';
  let text: string;
  if (isNode(input)) {
    if (isSuiteForm)
      throw ErrorFactory.create(TypeError, `${method} is a form of documents read from a source, not of DOM nodes`);
    text = new TreeCanonicalizer(input, method, options).write(input);
  } else {
    const reader = isReader(input) ? (input as StreamReader) : readerFor(input, options.factory, isSuiteForm);
    text = isSuiteForm
      ? new SuiteForm(reader, method === 'suite-second').write()
      : new CanonicalXML(reader, method === 'exc-c14n', options).write();
  }
  return options.output === 'bytes' ? new TextEncoder().encode(text) : text;
}

/** A cursor that expands entities and applies defaults; the suite's forms also report namespace declarations as attributes. */
function readerFor(source: Source, factory: XMLInputFactory | undefined, isSuiteForm: boolean): StreamReader {
  return (factory ?? new XMLInputFactory())[CREATE_READER](
    source,
    {
      namespaceAware: true,
      namespacePrefixes: isSuiteForm,
      replaceEntityReferences: true,
      supportExternalEntities: true,
      coalescing: false,
      reportEntityBoundaries: false,
    },
    false
  );
}

/** Fails canonicalization at the cursor's location. */
function fail(reader: StreamReader, code: ErrorCode, message: string): never {
  throw ErrorFactory.create(XMLError, code, message, reader.location());
}

/**
 * Canonical XML 1.0 and 1.1, and Exclusive Canonicalization, of a whole document read through a
 * cursor. The two inclusive forms differ only for document subsets, so they agree here.
 */
class CanonicalXML extends Canonicalizer {
  readonly #reader: StreamReader;
  /** The namespaces in scope, per open element, innermost last. */
  readonly #namespacesInScope: ReadonlyMap<string, string>[] = [new Map([['', '']])];
  /** The namespaces declared in the output, per open element, innermost last. */
  readonly #namespacesRendered: ReadonlyMap<string, string>[] = [new Map([['', '']])];
  #sawRoot = false;
  /** The number of open elements. */
  #elementDepth = 0;

  constructor(reader: StreamReader, exclusive: boolean, options: CanonicalizeOptions) {
    super(exclusive, options, reader.encoding());
    this.#reader = reader;
  }

  /** Reads the document to its end and returns its canonical form. */
  write(): string {
    const reader = this.#reader;
    if (reader.version() === '1.1') fail(reader, ErrorCode.C14N_VERSION, 'Canonical XML is not defined for XML 1.1');
    for (let event = reader.eventType(); event !== EventType.END_DOCUMENT; event = reader.next())
      this.#writeEvent(event);
    return this.output;
  }

  /** Writes one event's canonical form, and refuses what cannot be canonicalized. */
  #writeEvent(event: EventType): void {
    const reader = this.#reader;
    switch (event) {
      case EventType.START_ELEMENT: {
        this.#startElement();
        break;
      }
      case EventType.END_ELEMENT: {
        this.#endElement();
        break;
      }
      case EventType.CHARACTERS:
      case EventType.CDATA:
      case EventType.SPACE: {
        if (this.#elementDepth > 0) this.writeCharacters(reader.text());
        break;
      }
      case EventType.COMMENT: {
        if (this.keepsComments) this.#writeCommentOrPI(this.commentMarkup(reader.text()));
        break;
      }
      case EventType.PROCESSING_INSTRUCTION: {
        this.#writeCommentOrPI(this.piMarkup(reader.piTarget(), reader.piData()));
        break;
      }
      case EventType.DTD: {
        if (!reader[DTD_COMPLETE]) fail(reader, ErrorCode.C14N_UNREAD, 'Part of the DTD could not be read');
        break;
      }
      case EventType.ENTITY_REFERENCE: {
        fail(reader, ErrorCode.C14N_UNREAD, `The entity ${reader.name()} could not be read`);
        break;
      }
      case EventType.NEED_INPUT: {
        throw ErrorFactory.create(TypeError, 'canonicalize needs a synchronous reader');
      }
      default:
    }
  }

  /** Writes a comment or PI; outside the root element it gets a line of its own. */
  #writeCommentOrPI(markup: string): void {
    if (this.#elementDepth > 0) this.output += markup;
    else if (this.#sawRoot) this.output += `\n${markup}`;
    else this.output += `${markup}\n`;
  }

  /** Writes a start tag and opens its element's namespace scope. */
  #startElement(): void {
    const reader = this.#reader;
    this.#sawRoot = true;
    this.#elementDepth++;
    const scope = this.#startTagScope();
    this.#namespacesInScope.push(scope);
    const attributes = this.#sortedAttributes();
    const candidates = this.isExclusive
      ? this.usedPrefixes(reader.prefix(), attributes, scope)
      : declaredPrefixes(reader);
    const parentRendered = this.#namespacesRendered.at(-1) as ReadonlyMap<string, string>;
    this.#namespacesRendered.push(this.writeStartTag(reader.name(), candidates, scope, parentRendered, attributes));
  }

  /** Writes an end tag and closes its element's namespace scope. */
  #endElement(): void {
    this.output += `</${this.#reader.name()}>`;
    this.#namespacesInScope.pop();
    this.#namespacesRendered.pop();
    this.#elementDepth--;
  }

  /** The namespaces in scope on the start tag: the parent's, with the tag's declarations, which must be absolute. */
  #startTagScope(): ReadonlyMap<string, string> {
    const reader = this.#reader;
    for (let i = 0; i < reader.namespaceCount(); i++) {
      const uri = reader.namespaceURI(i);
      if (uri !== '' && !hasScheme(uri)) {
        fail(reader, ErrorCode.C14N_RELATIVE_NAMESPACE, `The namespace URI ${uri} is relative`);
      }
    }
    return namespacesInScope(this.#namespacesInScope.at(-1) as ReadonlyMap<string, string>, reader);
  }

  /** The start tag's attributes, without namespace declarations, sorted. */
  #sortedAttributes(): CanonicalAttribute[] {
    const reader = this.#reader;
    const attributes: CanonicalAttribute[] = [];
    for (let i = 0; i < reader.attributeCount(); i++) {
      const uri = reader.attributeNamespace(i);
      if (uri !== XMLNS_NAMESPACE)
        attributes.push([uri, reader.attributeLocalName(i), reader.attributeName(i), reader.attributeValue(i)]);
    }
    return sortAttributes(attributes);
  }
}

/**
 * The canonical forms the XML conformance suite compares parsers' output with, and their XML 1.1
 * variants. The first form is the document's content: elements with sorted attributes, text with
 * markup characters and whitespace written as references, and processing instructions. The second
 * form adds a DOCTYPE listing the notations, for tests that report them.
 */
class SuiteForm {
  readonly #reader: StreamReader;
  readonly #isSecondForm: boolean;
  readonly #version11: boolean;
  /** The DTD's notations, written in the second form's DOCTYPE. */
  readonly #notations = new Map<string, { publicId: string | undefined; systemId: string | undefined }>();
  /** The form written so far; from the root element on, only what follows the DOCTYPE. */
  #output = '';
  /** What was written before the root element, where the DOCTYPE goes; undefined until the root starts. */
  #outputBeforeRoot: string | undefined;
  #rootName = '';
  /** The number of open elements. */
  #elementDepth = 0;

  constructor(reader: StreamReader, isSecondForm: boolean) {
    this.#reader = reader;
    this.#isSecondForm = isSecondForm;
    this.#version11 = reader.version() === '1.1';
  }

  /** Reads the document to its end and returns its form. */
  write(): string {
    const reader = this.#reader;
    for (let event = reader.eventType(); event !== EventType.END_DOCUMENT; event = reader.next())
      this.#writeEvent(event);
    const declaration = this.#version11 ? '<?xml version="1.1"?>' : '';
    return this.#outputBeforeRoot === undefined
      ? declaration + this.#output
      : declaration + this.#outputBeforeRoot + this.#notationDoctype() + this.#output;
  }

  /** Writes one event's form; the DTD's processing instructions are written, and its notations kept for the DOCTYPE. */
  #writeEvent(event: EventType): void {
    const reader = this.#reader;
    switch (event) {
      case EventType.START_ELEMENT: {
        this.#startElement();
        break;
      }
      case EventType.END_ELEMENT: {
        this.#output += `</${reader.name()}>`;
        this.#elementDepth--;
        break;
      }
      case EventType.CHARACTERS:
      case EventType.CDATA:
      case EventType.SPACE: {
        if (this.#elementDepth > 0) this.#output += this.#escape(reader.text());
        break;
      }
      case EventType.PROCESSING_INSTRUCTION: {
        this.#output += `<?${reader.piTarget()} ${reader.piData()}?>`;
        break;
      }
      case EventType.DTD: {
        const doctype = reader.doctype();
        for (const { target, data } of doctype.processingInstructions) this.#output += `<?${target} ${data}?>`;
        for (const { name, publicId, systemId } of doctype.notations) this.#notations.set(name, { publicId, systemId });
        break;
      }
      default:
    }
  }

  /** Writes a start tag with its attributes sorted by name; the first one sets what goes before the root. */
  #startElement(): void {
    const reader = this.#reader;
    if (this.#outputBeforeRoot === undefined) {
      this.#outputBeforeRoot = this.#output;
      this.#output = '';
      this.#rootName = reader.name();
    }
    const attributes: [string, string][] = [];
    for (let i = 0; i < reader.attributeCount(); i++)
      attributes.push([reader.attributeName(i), reader.attributeValue(i)]);
    attributes.sort(byName);
    let tag = `<${reader.name()}`;
    for (const [name, value] of attributes) tag += ` ${name}="${this.#escape(value)}"`;
    this.#output += `${tag}>`;
    this.#elementDepth++;
  }

  /** Text with markup characters and whitespace, and in XML 1.1 control characters, written as references. */
  #escape(text: string): string {
    let escaped = '';
    for (const char of text) {
      const code = char.codePointAt(0) as number;
      const reference = SUITE_REFERENCES[char];
      if (reference !== undefined) escaped += reference;
      else if (this.#version11 && isRestrictedOrNextLine(code)) escaped += `&#${code};`;
      else escaped += char;
    }
    return escaped;
  }

  /** The second form's DOCTYPE, listing the notations sorted by name; empty in the first form or without notations. */
  #notationDoctype(): string {
    if (!this.#isSecondForm || this.#notations.size === 0) return '';
    let doctype = `<!DOCTYPE ${this.#rootName} [\n`;
    for (const [name, { publicId, systemId }] of [...this.#notations].toSorted(([a], [b]) => byCodeUnit(a, b))) {
      if (publicId === undefined) doctype += `<!NOTATION ${name} SYSTEM '${systemId as string}'>\n`;
      else if (systemId === undefined) doctype += `<!NOTATION ${name} PUBLIC '${publicId}'>\n`;
      else doctype += `<!NOTATION ${name} PUBLIC '${publicId}' '${systemId}'>\n`;
    }
    return `${doctype}]>\n`;
  }
}
