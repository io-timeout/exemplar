/** @exemplarjs/dom: the DOM Level 3 Core tree, its builder, and browser-style `DOMParser` and `XMLSerializer`. */
export { type BuilderOptions, DocumentBuilder } from './builder.ts';
export { DOMConfiguration, DOMError, type DOMErrorHandler, DOMLocator, DOMStringList } from './config.ts';
export {
  Attr,
  CDATASection,
  CharacterData,
  Comment,
  DOMImplementation,
  DOMImplementationRegistry,
  Document,
  DocumentFragment,
  DocumentPosition,
  DocumentType,
  Element,
  Entity,
  EntityReference,
  NamedNodeMap,
  Node,
  NodeList,
  NodeType,
  Notation,
  ProcessingInstruction,
  Text,
  TypeInfo,
  type UserDataHandler,
  UserDataOperation,
} from './nodes/index.ts';
export { DOMParser, PARSER_ERROR_NAMESPACE, XMLSerializer } from './parser.ts';
