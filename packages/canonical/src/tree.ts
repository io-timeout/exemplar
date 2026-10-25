import { ErrorCode, XMLError } from '@exemplarjs/xml';
import {
  type NodeLike,
  NodeType,
  XML_NAMESPACE,
  attributesOf,
  prefixDeclaredBy,
  hasScheme,
  localPartOf,
  prefixOf,
} from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { joinURIReferences } from './base.ts';
import type { CanonicalizeOptions } from './canonicalize.ts';
import { Canonicalizer, type CanonicalAttribute, sortAttributes } from './render.ts';

/** How the qualified name of an attribute in the xml namespace starts. */
const XML_COLON = 'xml:';

/** The parts of a DOM node canonicalization reads, so that any DOM Level 2 tree can be canonicalized. */
export interface CanonicalNode extends NodeLike<CanonicalNode> {
  readonly ownerDocument: CanonicalNode | null;
  /** A document's XML version and encodings, which decide whether and how it can be canonicalized. */
  readonly xmlVersion?: string;
  readonly inputEncoding?: string | null;
  readonly xmlEncoding?: string | null;
}

/** Whether a value is a DOM node rather than a source. */
export function isNode(value: unknown): value is CanonicalNode {
  return typeof value === 'object' && value !== null && typeof (value as { nodeType?: unknown }).nodeType === 'number';
}

/** Fails canonicalization of a tree, which has no location to report. */
function fail(code: ErrorCode, message: string): never {
  throw ErrorFactory.create(XMLError, code, message, { line: 0, column: 0, offset: 0 });
}

/**
 * Canonical XML 1.0 and 1.1, and Exclusive Canonicalization, of a DOM node as a document subset: the
 * node and everything below it. The node is the apex, which has no ancestors in the subset, so it
 * declares every namespace in scope and, for the inclusive forms, takes on its ancestors' `xml:`
 * attributes. Canonicalizing `<b>` of `<a xml:lang="en" xmlns:p="urn:p"><b/></a>` with C14N 1.0
 * gives `<b xmlns:p="urn:p" xml:lang="en"></b>`.
 */
export class TreeCanonicalizer extends Canonicalizer {
  readonly #method: 'c14n' | 'c14n11' | 'exc-c14n';

  constructor(node: CanonicalNode, method: 'c14n' | 'c14n11' | 'exc-c14n', options: CanonicalizeOptions) {
    const document = node.nodeType === NodeType.DOCUMENT_NODE ? node : node.ownerDocument;
    if (document?.xmlVersion === '1.1') fail(ErrorCode.C14N_VERSION, 'Canonical XML is not defined for XML 1.1');
    // As for a source: the encoding declared, or else the one detected.
    super(method === 'exc-c14n', options, document?.xmlEncoding ?? document?.inputEncoding);
    this.#method = method;
  }

  /** The canonical form of a document, or of a node and everything below it. */
  write(node: CanonicalNode): string {
    const { nodeType } = node;
    if (nodeType === NodeType.DOCUMENT_NODE) this.#writeDocument(node);
    else if (nodeType === NodeType.ELEMENT_NODE) this.#writeApex(node);
    else this.#writeChild(node, noNamespaces(), noNamespaces());
    return this.output;
  }

  /** A whole document: the root element, with comments and processing instructions on lines of their own around it. */
  #writeDocument(node: CanonicalNode): void {
    let sawRoot = false;
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === NodeType.ELEMENT_NODE) {
        sawRoot = true;
        this.#writeElement(child, noNamespaces(), noNamespaces(), 'apex');
        continue;
      }
      const markup = this.#commentOrPIMarkup(child);
      if (markup !== '') this.output += sawRoot ? `\n${markup}` : `${markup}\n`;
    }
  }

  /** The markup of a comment or processing instruction; anything else outside the root element has no canonical form. */
  #commentOrPIMarkup(node: CanonicalNode): string {
    if (node.nodeType === NodeType.COMMENT_NODE)
      return this.keepsComments ? this.commentMarkup(node.nodeValue ?? '') : '';
    return node.nodeType === NodeType.PROCESSING_INSTRUCTION_NODE
      ? this.piMarkup(node.nodeName, node.nodeValue ?? '')
      : '';
  }

  /** Writes a node inside the apex: an element, character data, or the children of a reference or fragment. */
  #writeChild(node: CanonicalNode, scope: ReadonlyMap<string, string>, rendered: ReadonlyMap<string, string>): void {
    switch (node.nodeType) {
      case NodeType.ELEMENT_NODE: {
        this.#writeElement(node, scope, rendered, 'descendant');
        break;
      }
      case NodeType.TEXT_NODE:
      case NodeType.CDATA_SECTION_NODE: {
        this.writeCharacters(node.nodeValue ?? '');
        break;
      }
      case NodeType.ENTITY_REFERENCE_NODE:
      case NodeType.DOCUMENT_FRAGMENT_NODE: {
        for (let child = node.firstChild; child !== null; child = child.nextSibling)
          this.#writeChild(child, scope, rendered);
        break;
      }
      default: {
        this.output += this.#commentOrPIMarkup(node);
      }
    }
  }

  /** Writes the apex element, which inherits the namespaces in scope from its ancestors. */
  #writeApex(node: CanonicalNode): void {
    this.#writeElement(node, namespacesInScopeAt(node.parentNode), noNamespaces(), 'apex');
  }

  /** Writes an element, its content and its end tag; `role` says whether it is the apex of the subset. */
  #writeElement(
    node: CanonicalNode,
    parentScope: ReadonlyMap<string, string>,
    parentRendered: ReadonlyMap<string, string>,
    role: 'apex' | 'descendant'
  ): void {
    const isApex = role === 'apex';
    const ownAttributes = attributesOf(node);
    const [scope, declaredHere] = declareNamespaces(ownAttributes, parentScope);
    // The apex's namespace nodes include those it inherits, which must not be relative either.
    if (isApex) for (const uri of scope.values()) requireAbsolute(uri);
    const attributes = this.#sortedAttributes(node, ownAttributes, isApex);
    // The apex renders every namespace in scope, as no ancestor of it is in the subset.
    let candidates: Iterable<string> = isApex ? scope.keys() : declaredHere;
    if (this.isExclusive) candidates = this.usedPrefixes(prefixOf(node.nodeName), attributes, scope);
    const rendered = this.writeStartTag(node.nodeName, candidates, scope, parentRendered, attributes);
    for (let child = node.firstChild; child !== null; child = child.nextSibling)
      this.#writeChild(child, scope, rendered);
    this.output += `</${node.nodeName}>`;
  }

  /** The element's attributes without declarations, with the `xml:` attributes the apex inherits, sorted. */
  #sortedAttributes(
    node: CanonicalNode,
    ownAttributes: readonly CanonicalNode[],
    isApex: boolean
  ): CanonicalAttribute[] {
    /** The attributes by namespace URI and local name, so that an inherited one never replaces the element's own. */
    const byExpandedName = new Map<string, CanonicalAttribute>();
    for (const attr of ownAttributes) {
      if (prefixDeclaredBy(attr) !== undefined) continue;
      const uri = attr.namespaceURI ?? (prefixOf(attr.nodeName) === 'xml' ? XML_NAMESPACE : '');
      const local = attr.localName ?? localPartOf(attr.nodeName);
      byExpandedName.set(`${uri} ${local}`, [uri, local, attr.nodeName, attr.nodeValue ?? '']);
    }
    if (isApex && !this.isExclusive) this.#inheritXmlAttributes(node, byExpandedName);
    return sortAttributes([...byExpandedName.values()]);
  }

  /** Adds the `xml:` attributes of the apex's ancestors: all of them for 1.0; for 1.1 xml:lang and xml:space, and xml:base joined. */
  #inheritXmlAttributes(node: CanonicalNode, byExpandedName: Map<string, CanonicalAttribute>): void {
    const bases: string[] = [];
    for (
      let ancestor = node.parentNode;
      ancestor !== null && ancestor.nodeType === NodeType.ELEMENT_NODE;
      ancestor = ancestor.parentNode
    ) {
      for (const attr of attributesOf(ancestor)) this.#inheritXmlAttribute(attr, byExpandedName, bases);
    }
    if (bases.length === 0) return;
    const key = `${XML_NAMESPACE} base`;
    const own = byExpandedName.get(key);
    if (own !== undefined) bases.push(own[3]);
    // Innermost first, each value joined onto the one around it.
    let joined = bases.at(-1) as string;
    for (let i = bases.length - 2; i >= 0; i--) joined = joinURIReferences(bases[i] as string, joined);
    if (joined === '') byExpandedName.delete(key);
    else byExpandedName.set(key, [XML_NAMESPACE, 'base', 'xml:base', joined]);
  }

  /** Inherits one ancestor attribute, nearest first, or keeps an xml:base value for 1.1 to join. */
  #inheritXmlAttribute(attr: CanonicalNode, byExpandedName: Map<string, CanonicalAttribute>, bases: string[]): void {
    if (prefixOf(attr.nodeName) !== 'xml') return;
    const local = attr.nodeName.slice(XML_COLON.length);
    if (this.#method === 'c14n11' && local === 'base') {
      bases.unshift(attr.nodeValue ?? '');
      return;
    }
    if (this.#method !== 'c14n' && local !== 'lang' && local !== 'space') return;
    const key = `${XML_NAMESPACE} ${local}`;
    if (!byExpandedName.has(key)) byExpandedName.set(key, [XML_NAMESPACE, local, attr.nodeName, attr.nodeValue ?? '']);
  }
}

/** No namespaces bound, or rendered, but the empty default. */
function noNamespaces(): Map<string, string> {
  return new Map([['', '']]);
}

/** The scope an element's declarations make inside its parent's, and the prefixes it declares. */
function declareNamespaces(
  ownAttributes: readonly CanonicalNode[],
  parentScope: ReadonlyMap<string, string>
): [Map<string, string>, Set<string>] {
  const scope = new Map(parentScope);
  const declaredHere = new Set<string>();
  for (const attr of ownAttributes) {
    const prefix = prefixDeclaredBy(attr);
    if (prefix === undefined) continue;
    const uri = requireAbsolute(attr.nodeValue ?? '');
    scope.set(prefix, uri);
    declaredHere.add(prefix);
  }
  return [scope, declaredHere];
}

/** The namespaces in scope at a node, from its ancestors' declarations; the nearest wins. */
function namespacesInScopeAt(node: CanonicalNode | null): Map<string, string> {
  const chain: CanonicalNode[] = [];
  for (let element = node; element !== null && element.nodeType === NodeType.ELEMENT_NODE; element = element.parentNode)
    chain.unshift(element);
  const scope = new Map([['', '']]);
  for (const element of chain) {
    for (const attr of attributesOf(element)) {
      const prefix = prefixDeclaredBy(attr);
      if (prefix !== undefined) scope.set(prefix, attr.nodeValue ?? '');
    }
  }
  return scope;
}

/** Returns a namespace URI, refusing it when it is relative, as canonicalization must. */
function requireAbsolute(uri: string): string {
  if (uri !== '' && !hasScheme(uri)) fail(ErrorCode.C14N_RELATIVE_NAMESPACE, `The namespace URI ${uri} is relative`);
  return uri;
}
