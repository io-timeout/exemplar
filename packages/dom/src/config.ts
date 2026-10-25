import { XMLNS_NAMESPACE, XML_NAMESPACE, holdsNonChar, isXmlName } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { DTD_TYPES, fail, orNull } from './names.ts';
import { NodeType } from './node-type.ts';
import type { Attr, Document, Element, Node, Text } from './nodes/index.ts';

/** A live, read-only list of strings, following DOM Level 3's DOMStringList. */
export class DOMStringList {
  readonly #items: readonly string[];

  constructor(items: readonly string[]) {
    this.#items = items;
  }

  get length(): number {
    return this.#items.length;
  }

  item(index: number): string | null {
    return this.#items[index] ?? null;
  }

  contains(value: string): boolean {
    return this.#items.includes(value);
  }
}

/** What DOMLocator gives for a position it does not know. */
const UNKNOWN = -1;

/** Where a DOMError happened: in a tree, only the node is known. */
export class DOMLocator {
  readonly lineNumber = UNKNOWN;
  readonly columnNumber = UNKNOWN;
  readonly byteOffset = UNKNOWN;
  readonly utf16Offset = UNKNOWN;
  readonly relatedNode: Node | null;
  readonly uri: string | null = null;

  constructor(relatedNode: Node | null) {
    this.relatedNode = relatedNode;
  }
}

/** A problem `normalizeDocument` reports to the configuration's error handler. */
export class DOMError {
  static readonly SEVERITY_WARNING = 1;
  static readonly SEVERITY_ERROR = 2;
  static readonly SEVERITY_FATAL_ERROR = 3;
  readonly severity: number;
  readonly message: string;
  readonly type: string;
  readonly relatedException: unknown = null;
  readonly relatedData: unknown;
  readonly location: DOMLocator;

  constructor(severity: number, type: string, message: string, node: Node | null) {
    this.severity = severity;
    this.type = type;
    this.message = message;
    this.relatedData = node;
    this.location = new DOMLocator(node);
  }
}

/** Hears DOMErrors; a function, or an object with `handleError`, as the ECMAScript binding allows. Returning false stops. */
export type DOMErrorHandler = ((error: DOMError) => boolean | void) | { handleError(error: DOMError): boolean | void };

/** A boolean parameter: its default, and the values exemplar can set. */
interface BooleanParameter {
  readonly initial: boolean;
  readonly settable: readonly boolean[];
}

/** The boolean parameters. */
const BOOLEANS: Readonly<Record<string, BooleanParameter>> = {
  'canonical-form': { initial: false, settable: [false] },
  'cdata-sections': { initial: true, settable: [false, true] },
  'check-character-normalization': { initial: false, settable: [false, true] },
  comments: { initial: true, settable: [false, true] },
  'datatype-normalization': { initial: false, settable: [false] },
  'element-content-whitespace': { initial: true, settable: [false, true] },
  entities: { initial: true, settable: [false, true] },
  infoset: { initial: true, settable: [false, true] },
  namespaces: { initial: true, settable: [false, true] },
  'namespace-declarations': { initial: true, settable: [false, true] },
  'normalize-characters': { initial: false, settable: [false, true] },
  'split-cdata-sections': { initial: true, settable: [false, true] },
  validate: { initial: false, settable: [false] },
  'validate-if-schema': { initial: false, settable: [false] },
  'well-formed': { initial: true, settable: [false, true] },
};

/** What `infoset` set to true sets, and what reading it checks. */
const INFOSET: Readonly<Record<string, boolean>> = {
  'validate-if-schema': false,
  entities: false,
  'datatype-normalization': false,
  'cdata-sections': false,
  'namespace-declarations': true,
  'well-formed': true,
  'element-content-whitespace': true,
  comments: true,
  namespaces: true,
};

const NAMES = [...Object.keys(BOOLEANS), 'error-handler', 'schema-location', 'schema-type'];

/** The default error handler, which lets normalizing go on past errors. */
const IGNORE: DOMErrorHandler = { handleError: () => true };

/**
 * The parameters `normalizeDocument` follows, as DOM Level 3's DOMConfiguration holds them; names ignore
 * case. For example, `document.domConfig.setParameter('comments', false)` makes the next
 * `normalizeDocument()` remove the comments.
 */
export class DOMConfiguration {
  readonly #values = new Map<string, unknown>([
    ...Object.entries(BOOLEANS).map(([name, { initial }]) => [name, initial] as const),
    ['error-handler', IGNORE],
    ['schema-location', null],
    ['schema-type', null],
  ]);

  get parameterNames(): DOMStringList {
    return new DOMStringList(NAMES);
  }

  canSetParameter(name: string, value: unknown): boolean {
    const key = name.toLowerCase();
    if (!this.#values.has(key)) return false;
    if (value === null) return true;
    const boolean = BOOLEANS[key];
    if (boolean !== undefined) return typeof value === 'boolean' && boolean.settable.includes(value);
    if (key === 'error-handler') return isHandler(value);
    return typeof value === 'string' && (key === 'schema-location' || value === DTD_TYPES);
  }

  setParameter(name: string, value: unknown): void {
    const key = name.toLowerCase();
    this.#checkValue(key, value);
    // Null resets a boolean parameter to its default.
    const boolean = BOOLEANS[key];
    const set = boolean !== undefined && value === null ? boolean.initial : value;
    if (key === 'infoset') {
      if (set === true)
        for (const [parameter, infosetValue] of Object.entries(INFOSET)) this.#values.set(parameter, infosetValue);
      return;
    }
    this.#values.set(key, set);
  }

  /** Throws unless a parameter exists and can take a value: NOT_FOUND_ERR, TYPE_MISMATCH_ERR or NOT_SUPPORTED_ERR. */
  #checkValue(key: string, value: unknown): void {
    if (!this.#values.has(key)) fail('NotFoundError', `${key} is not a parameter`);
    if (value !== null && BOOLEANS[key] !== undefined && typeof value !== 'boolean') {
      fail('TypeMismatchError', `${key} takes true or false`);
    }
    if (key === 'error-handler' && value !== null && !isHandler(value)) {
      fail('TypeMismatchError', 'error-handler takes a DOMErrorHandler');
    }
    if ((key === 'schema-location' || key === 'schema-type') && value !== null && typeof value !== 'string') {
      fail('TypeMismatchError', `${key} takes a string`);
    }
    if (!this.canSetParameter(key, value)) fail('NotSupportedError', `${key} cannot be ${String(value)}`);
  }

  getParameter(name: string): unknown {
    const key = name.toLowerCase();
    if (!this.#values.has(key)) fail('NotFoundError', `${name} is not a parameter`);
    if (key === 'infoset')
      return Object.entries(INFOSET).every(([parameter, infosetValue]) => this.#values.get(parameter) === infosetValue);
    return this.#values.get(key);
  }

  /** A boolean parameter's value. @internal */
  _is(name: string): boolean {
    return this.#values.get(name) === true;
  }

  /** The error handler, if one is set. @internal */
  _handler(): DOMErrorHandler | null {
    return this.#values.get('error-handler') as DOMErrorHandler | null;
  }
}

/** Whether a value is a DOMErrorHandler: a function, or an object with `handleError`. */
function isHandler(value: unknown): value is DOMErrorHandler {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && 'handleError' in value);
}

/** Thrown to stop normalizing when the error handler asks to. */
class StopError extends Error {
  override name = 'StopError';
}

/** Normalizes a document as its configuration says: DOM Level 3's `normalizeDocument`. */
export function normalizeDocument(document: Document, config: DOMConfiguration): void {
  try {
    new Normalizer(document, config).normalize();
  } catch (error) {
    ErrorFactory.expect(error, StopError);
  }
}

/** A prefix bound during the namespace fix-up; the fix-up keeps them innermost last. */
interface Binding {
  readonly prefix: string;
  readonly uri: string | null;
}

/** A node whose children are being normalized: the next child to do, and how many bindings to keep at its end. */
interface OpenParent {
  readonly parent: Node;
  next: Node | null;
  readonly bindingCount: number;
}

/**
 * Carries out `normalizeDocument` once: walks the document in order, joining text, fixing up
 * namespaces, and removing or checking nodes as the configuration says, reporting problems to its
 * error handler.
 */
class Normalizer {
  readonly #document: Document;
  readonly #config: DOMConfiguration;
  readonly #version11: boolean;
  /** The prefixes bound in scope, innermost last. */
  readonly #bindings: Binding[] = [
    { prefix: 'xml', uri: XML_NAMESPACE },
    { prefix: 'xmlns', uri: XMLNS_NAMESPACE },
  ];
  /** How many `NSn` prefixes have been made. */
  #generatedCount = 0;

  constructor(document: Document, config: DOMConfiguration) {
    this.#document = document;
    this.#config = config;
    this.#version11 = document.xmlVersion === '1.1';
  }

  /** Reports a problem to the error handler; a fatal one, or the handler returning false, stops normalizing. */
  #report(severity: number, type: string, message: string, node: Node | null): void {
    const handler = this.#config._handler();
    const error = new DOMError(severity, type, message, node);
    const goOn = typeof handler === 'function' ? handler(error) : handler?.handleError(error);
    if (severity === DOMError.SEVERITY_FATAL_ERROR || goOn === false) throw ErrorFactory.create(StopError);
  }

  /** Reports an error. */
  #error(type: string, message: string, node: Node): void {
    this.#report(DOMError.SEVERITY_ERROR, type, message, node);
  }

  /** Normalizes the document in document order, keeping the elements open on a stack rather than recursing. */
  normalize(): void {
    const document = this.#document;
    const open: OpenParent[] = [{ parent: document, next: document.firstChild, bindingCount: this.#bindings.length }];
    for (let at = open.at(-1); at !== undefined; at = open.at(-1)) {
      const node = at.next;
      if (node === null) {
        this.#joinText(at.parent);
        this.#bindings.length = at.bindingCount;
        open.pop();
        continue;
      }
      // The next sibling is taken first, as normalizing a node may replace or remove it.
      at.next = node._next;
      const type = node.nodeType;
      if (type === NodeType.ELEMENT_NODE) {
        const bindingCount = this.#bindings.length;
        this.#element(node as Element);
        open.push({ parent: node, next: node.firstChild, bindingCount });
      } else if (type === NodeType.ENTITY_REFERENCE_NODE) {
        at.next = this.#reference(node) ?? at.next;
      } else {
        this.#node(node);
      }
    }
  }

  /** Normalizes a node that holds no children, which may replace or remove itself. */
  #node(node: Node): void {
    switch (node.nodeType) {
      case NodeType.TEXT_NODE: {
        this.#text(node as Text);
        break;
      }
      case NodeType.CDATA_SECTION_NODE: {
        this.#cdata(node as Text);
        break;
      }
      case NodeType.PROCESSING_INSTRUCTION_NODE: {
        this.#processingInstruction(node);
        break;
      }
      case NodeType.COMMENT_NODE: {
        this.#comment(node);
        break;
      }
      default:
    }
  }

  /** Joins adjacent text nodes and drops empty ones, as Node.normalize does. */
  #joinText(parent: Node): void {
    for (let child = parent.firstChild; child !== null;) {
      const next = child._next;
      if (child.nodeType === NodeType.TEXT_NODE) joinForward(parent, child as Text);
      child = next;
    }
  }

  /** Reports a name that is not an XML name, when `well-formed` is on. */
  #checkName(node: Node, name: string): void {
    if (this.#config._is('well-formed') && !isXmlName(name)) {
      this.#error('wf-invalid-character-in-node-name', `${name} is not an XML name`, node);
    }
  }

  /** Reports characters the document's XML version does not allow, when `well-formed` is on. */
  #checkCharacters(node: Node, text: string): void {
    if (this.#config._is('well-formed') && holdsNonChar(text, this.#version11)) {
      this.#error('wf-invalid-character', `${node.nodeName} holds a character XML does not allow`, node);
    }
  }

  /** Normalizes characters and checks their normalization, as the configuration asks. */
  #characters(node: Node, text: string): string {
    this.#checkCharacters(node, text);
    const normalized = this.#config._is('normalize-characters') ? text.normalize('NFC') : text;
    if (this.#config._is('check-character-normalization') && normalized.normalize('NFC') !== normalized) {
      this.#error('check-character-normalization-failure', 'The text is not fully normalized', node);
    }
    return normalized;
  }

  /** Normalizes an element's name, namespaces and attributes; its children follow. */
  #element(element: Element): void {
    this.#checkName(element, element.nodeName);
    if (this.#config._is('namespaces')) this.#fixNamespaces(element);
    for (const attr of element._attributes.slice()) this.#attribute(element, attr);
  }

  /** Checks an attribute's name and characters, and removes a namespace declaration when `namespace-declarations` is off. */
  #attribute(element: Element, attr: Attr): void {
    this.#checkName(attr, attr.nodeName);
    if (attr._namespaceURI === XMLNS_NAMESPACE && !this.#config._is('namespace-declarations')) {
      element.removeAttributeNode(attr);
      return;
    }
    const value = attr.value;
    const normalized = this.#characters(attr, value);
    if (normalized !== value) attr.value = normalized;
  }

  /** Removes element-content whitespace when `element-content-whitespace` is off, else checks and normalizes the text. */
  #text(text: Text): void {
    const parent = text._parent as Node;
    if (text._ignorable && !this.#config._is('element-content-whitespace')) {
      parent._unlink(text);
      return;
    }
    text._data = this.#characters(text, text._data);
  }

  /** Normalizes a CDATA section: turns it into text with `cdata-sections` off, else splits or reports any ]]> in it. */
  #cdata(cdata: Text): void {
    if (!this.#config._is('cdata-sections')) {
      const parent = cdata._parent as Node;
      const text = this.#document.createTextNode(cdata._data);
      parent._insert(text, cdata);
      parent._unlink(cdata);
      this.#text(text);
      return;
    }
    cdata._data = this.#characters(cdata, cdata._data);
    if (!cdata._data.includes(']]>')) return;
    if (this.#config._is('split-cdata-sections')) this.#splitCdata(cdata);
    else this.#error('wf-invalid-character', 'A CDATA section holds ]]>', cdata);
  }

  /** Splits a CDATA section at each ]]>, ending one section with ]] and starting the next with >. */
  #splitCdata(cdata: Text): void {
    const parent = cdata._parent as Node;
    const parts = cdata._data.split(']]>');
    const last = parts.length - 1;
    cdata._data = `${parts[0]}]]`;
    let after: Node = cdata;
    for (let i = 1; i <= last; i++) {
      const data = i < last ? `>${parts[i]}]]` : `>${parts[i]}`;
      const next = this.#document.createCDATASection(data);
      parent._insert(next, after._next);
      after = next;
    }
    this.#report(DOMError.SEVERITY_WARNING, 'cdata-sections-splitted', 'A CDATA section holding ]]> was split', cdata);
  }

  /** Removes a comment when `comments` is off, else checks it. */
  #comment(comment: Node): void {
    const parent = comment._parent as Node;
    if (!this.#config._is('comments')) {
      parent._unlink(comment);
      return;
    }
    const data = comment.nodeValue as string;
    this.#checkCharacters(comment, data);
    if (this.#config._is('well-formed') && (data.includes('--') || data.endsWith('-'))) {
      this.#error('wf-invalid-character', 'A comment holds -- or ends with -', comment);
    }
  }

  /** Checks a processing instruction's target and characters. */
  #processingInstruction(pi: Node): void {
    this.#checkName(pi, pi.nodeName);
    this.#checkCharacters(pi, pi.nodeValue as string);
  }

  /** With `entities` off, puts a writable copy of a reference's expansion in its place; returns the first copy, to normalize next. */
  #reference(reference: Node): Node | null {
    if (this.#config._is('entities') || reference.firstChild === null) return null;
    const parent = reference._parent as Node;
    let first: Node | null = null;
    for (let child: Node | null = reference.firstChild; child !== null; child = child._next) {
      const copy = child._clone(this.#document, true);
      copy._setReadonly(false);
      parent._insert(copy, reference);
      first ??= copy;
    }
    parent._unlink(reference);
    return first;
  }

  /** The URI a prefix is bound to in scope: null for no namespace, undefined when unbound. */
  #lookup(prefix: string): string | null | undefined {
    for (let index = this.#bindings.length - 1; index >= 0; index--) {
      const binding = this.#bindings[index] as Binding;
      if (binding.prefix === prefix) return binding.uri;
    }
    return prefix === '' ? null : undefined;
  }

  /** A non-empty prefix bound to a URI in scope. */
  #prefixFor(uri: string): string | undefined {
    for (let index = this.#bindings.length - 1; index >= 0; index--) {
      const binding = this.#bindings[index] as Binding;
      if (binding.uri === uri && binding.prefix !== '' && this.#lookup(binding.prefix) === uri) return binding.prefix;
    }
    return undefined;
  }

  /** Declares a namespace on an element and binds it. */
  #declare(element: Element, prefix: string, uri: string): void {
    const name = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
    element.setAttributeNS(XMLNS_NAMESPACE, name, uri);
    this.#bindings.push({ prefix, uri: orNull(uri) });
  }

  /** DOM Level 3's namespace fix-up (Appendix B.1): declarations for the element's and its attributes' namespaces. */
  #fixNamespaces(element: Element): void {
    this.#bindDeclarations(element);
    const uri = element._namespaceURI;
    const prefix = element.prefix ?? '';
    if (uri !== null) {
      if (this.#lookup(prefix) !== uri) this.#declare(element, prefix, uri);
    } else if (element._localName === null) {
      this.#error('NullLocalElementName', `${element._name} is a DOM Level 1 node`, element);
    } else if (this.#lookup('') !== null) {
      this.#declare(element, '', '');
    }
    for (const attr of element._attributes.slice()) this.#fixAttribute(element, attr);
  }

  /** Binds the namespaces an element's own attributes declare. */
  #bindDeclarations(element: Element): void {
    for (const attr of element._attributes) {
      if (attr._namespaceURI !== XMLNS_NAMESPACE) continue;
      const prefix = attr._name === 'xmlns' ? '' : (attr._localName as string);
      if (prefix === 'xml' || prefix === 'xmlns') continue;
      this.#bindings.push({ prefix, uri: orNull(attr.value) });
    }
  }

  /** Gives a namespaced attribute a prefix bound to its namespace, declaring one when none in scope is. */
  #fixAttribute(element: Element, attr: Attr): void {
    const uri = attr._namespaceURI;
    if (uri === XMLNS_NAMESPACE) return;
    if (uri === null) {
      if (attr._localName === null) {
        this.#error('NullLocalAttrName', `${attr._name} is a DOM Level 1 node`, attr);
      }
      return;
    }
    const prefix = attr.prefix;
    if (prefix !== null && this.#lookup(prefix) === uri) return;
    let chosen = this.#prefixFor(uri);
    if (chosen === undefined) {
      // The attribute's own prefix, unless it is missing or bound to another namespace.
      chosen = prefix === null || this.#lookup(prefix) !== undefined ? this.#generatePrefix() : prefix;
      this.#declare(element, chosen, uri);
    }
    attr._name = `${chosen}:${attr._localName as string}`;
  }

  /** A new prefix, NS1 onwards, that nothing in scope binds. */
  #generatePrefix(): string {
    let prefix: string;
    do prefix = `NS${++this.#generatedCount}`;
    while (this.#lookup(prefix) !== undefined);
    return prefix;
  }
}

/** Joins a text node to the text node after it, or drops it when it is empty. */
function joinForward(parent: Node, text: Text): void {
  const next = text._next;
  if (next?.nodeType === NodeType.TEXT_NODE) {
    (next as Text)._data = text._data + (next as Text)._data;
    parent._unlink(text);
  } else if (text._data === '') {
    parent._unlink(text);
  }
}
