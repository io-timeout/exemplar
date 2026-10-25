import {
  type NodeLike,
  NodeType,
  XML_NAMESPACE,
  attributesOf,
  prefixDeclaredBy,
  splitQName,
} from '@exemplarjs/xml/internal';
import { quotedLiteral } from './escape.ts';
import type { StreamWriter } from './stream-writer.ts';

/** The parts of a DOM node the writer reads, so that any DOM Level 2 tree can be written. */
export interface WritableNode extends NodeLike<WritableNode> {
  readonly prefix: string | null;
  /** Document types. */
  readonly name?: string;
  readonly publicId?: string | null;
  readonly systemId?: string | null;
  readonly internalSubset?: string | null;
  /** Documents. */
  readonly xmlVersion?: string;
  readonly xmlStandalone?: boolean;
}

/** Writes a node and everything below it, declaring the namespaces it uses that are not declared when `aware`. */
export function writeNode(writer: StreamWriter, node: WritableNode, namespaceAware = true): void {
  // A walk by child, sibling and parent links rather than recursion, so no tree is too deep to write.
  let current = node;
  for (;;) {
    if (writeStart(writer, current, namespaceAware) && current.firstChild !== null) {
      current = current.firstChild;
      continue;
    }
    writeEnd(writer, current);
    while (current !== node && current.nextSibling === null) {
      current = current.parentNode as WritableNode;
      writeEnd(writer, current);
    }
    if (current === node) return;
    current = current.nextSibling as WritableNode;
  }
}

/** Writes a node, or the start of one that holds children; true when its children are to be written next. */
function writeStart(writer: StreamWriter, node: WritableNode, namespaceAware: boolean): boolean {
  switch (node.nodeType) {
    case NodeType.ELEMENT_NODE: {
      if (namespaceAware) writeStartTag(writer, node);
      else writeNamedStartTag(writer, node);
      return true;
    }
    case NodeType.DOCUMENT_NODE: {
      writer.writeStartDocument(node.xmlVersion ?? '1.0', undefined, node.xmlStandalone === true ? true : undefined);
      return true;
    }
    case NodeType.DOCUMENT_FRAGMENT_NODE: {
      return true;
    }
    default: {
      writeLeaf(writer, node);
      return false;
    }
  }
}

/** Writes a node whose children, if it has any, are not written: character data, a reference, a PI, a comment or a DOCTYPE. */
function writeLeaf(writer: StreamWriter, node: WritableNode): void {
  switch (node.nodeType) {
    case NodeType.ATTRIBUTE_NODE:
    case NodeType.TEXT_NODE: {
      writer.writeCharacters(node.nodeValue ?? '');
      break;
    }
    case NodeType.CDATA_SECTION_NODE: {
      writer.writeCData(node.nodeValue ?? '');
      break;
    }
    case NodeType.ENTITY_REFERENCE_NODE: {
      writer.writeEntityRef(node.nodeName);
      break;
    }
    case NodeType.PROCESSING_INSTRUCTION_NODE: {
      writer.writeProcessingInstruction(node.nodeName, node.nodeValue ?? '');
      break;
    }
    case NodeType.COMMENT_NODE: {
      writer.writeComment(node.nodeValue ?? '');
      break;
    }
    case NodeType.DOCUMENT_TYPE_NODE: {
      writer.writeDTD(doctype(node));
      break;
    }
    default: {
      // Entities and notations are written as part of their document type.
      break;
    }
  }
}

/** Ends an element or a document once its children are written. */
function writeEnd(writer: StreamWriter, node: WritableNode): void {
  if (node.nodeType === NodeType.ELEMENT_NODE) writer.writeEndElement();
  else if (node.nodeType === NodeType.DOCUMENT_NODE) writer.writeEndDocument();
}

/** A DOCTYPE from a document type node. */
function doctype(node: WritableNode): string {
  const { publicId, systemId, internalSubset } = node;
  let declaration = `<!DOCTYPE ${node.name ?? node.nodeName}`;
  if (publicId) declaration += ` PUBLIC ${quotedLiteral(publicId)} ${quotedLiteral(systemId ?? '')}`;
  else if (systemId) declaration += ` SYSTEM ${quotedLiteral(systemId)}`;
  if (internalSubset) declaration += ` [${internalSubset}]`;
  return declaration + '>';
}

/** An element's or attribute's prefix and local name; a DOM Level 1 name splits only if it is a qualified name. */
function prefixAndLocalName(node: WritableNode): [string, string] {
  if (node.localName !== null) return [node.prefix ?? '', node.localName];
  return splitQName(node.nodeName) ?? ['', node.nodeName];
}

/** The URI a DOM Level 1 element's prefix is declared for by its own or its ancestors' attributes. */
function declaredURI(node: WritableNode, prefix: string): string {
  const name = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
  for (
    let element: WritableNode | null = node;
    element !== null && element.nodeType === NodeType.ELEMENT_NODE;
    element = element.parentNode
  ) {
    const declaration = attributesOf(element).find((attr) => attr.nodeName === name);
    if (declaration !== undefined) return declaration.nodeValue ?? '';
  }
  return prefix === 'xml' ? XML_NAMESPACE : '';
}

/** Writes an element's start tag with its declarations and attributes, for a namespace-aware writer. */
function writeStartTag(writer: StreamWriter, node: WritableNode): void {
  const [prefix, localName] = prefixAndLocalName(node);
  const uri = node.localName === null ? declaredURI(node, prefix) : (node.namespaceURI ?? '');
  writer.writeStartElement(prefix, localName, uri);
  const declared = writeDeclarations(writer, node, prefix, uri);
  // Declares the element's own namespace when the output does not bind its prefix to it yet.
  if ((writer.getNamespaceURI(prefix) ?? '') !== uri && !declared.has(prefix))
    declareNamespace(writer, declared, prefix, uri);
  for (const attr of attributesOf(node)) {
    if (prefixDeclaredBy(attr) === undefined) writeAttribute(writer, node, attr, declared);
  }
}

/** Writes an element's namespace declarations but for xml, repeats, and any its own name contradicts; returns their prefixes. */
function writeDeclarations(writer: StreamWriter, node: WritableNode, prefix: string, uri: string): Set<string> {
  const declared = new Set<string>();
  for (const attr of attributesOf(node)) {
    const declaration = prefixDeclaredBy(attr);
    if (declaration === undefined || declaration === 'xml' || declared.has(declaration)) continue;
    const value = attr.nodeValue ?? '';
    // A declaration the element's own name contradicts gives way to the name.
    if (declaration === prefix && value !== uri) continue;
    declareNamespace(writer, declared, declaration, value);
  }
  return declared;
}

/** Writes a namespace declaration on the open start tag and notes its prefix as declared there. */
function declareNamespace(writer: StreamWriter, declared: Set<string>, prefix: string, uri: string): void {
  writer.writeNamespace(prefix, uri);
  declared.add(prefix);
}

/** Writes an element's start tag and attributes by their node names, for a writer that keeps no namespaces. */
function writeNamedStartTag(writer: StreamWriter, node: WritableNode): void {
  writer.writeStartElement(node.nodeName);
  for (const attr of attributesOf(node)) writer.writeAttribute(attr.nodeName, attr.nodeValue ?? '');
}

/** Writes an attribute, declaring a prefix for its namespace when none is bound. */
function writeAttribute(writer: StreamWriter, element: WritableNode, attr: WritableNode, declared: Set<string>): void {
  const [prefix, localName] = prefixAndLocalName(attr);
  const value = attr.nodeValue ?? '';
  if (attr.localName === null) {
    writeLevel1Attribute(writer, element, prefix, localName, value, declared);
    return;
  }
  const uri = attr.namespaceURI ?? '';
  if (uri === '') {
    writer.writeAttribute(localName, value);
    return;
  }
  if (prefix === 'xml' || (prefix !== '' && writer.getNamespaceURI(prefix) === uri)) {
    writer.writeAttribute(prefix, uri, localName, value);
    return;
  }
  let chosen = writer.getPrefix(uri);
  if (chosen === undefined || chosen === '') {
    chosen = prefix !== '' && !declared.has(prefix) ? prefix : freePrefix(writer, declared);
    declareNamespace(writer, declared, chosen, uri);
  }
  writer.writeAttribute(chosen, uri, localName, value);
}

/** Writes a DOM Level 1 attribute by its own name, declaring its prefix as the tree does when the output lacks it. */
function writeLevel1Attribute(
  writer: StreamWriter,
  element: WritableNode,
  prefix: string,
  localName: string,
  value: string,
  declared: Set<string>
): void {
  const uri = prefix === '' ? '' : declaredURI(element, prefix);
  if (uri !== '' && !declared.has(prefix) && writer.getNamespaceURI(prefix) !== uri)
    declareNamespace(writer, declared, prefix, uri);
  writer.writeAttribute(prefix, uri, localName, value);
}

/** A prefix bound neither in scope nor on the open tag. */
function freePrefix(writer: StreamWriter, declared: Set<string>): string {
  for (let number = 1; ; number++) {
    const prefix = `ns${number}`;
    if (!declared.has(prefix) && writer.getNamespaceURI(prefix) === undefined) return prefix;
  }
}
