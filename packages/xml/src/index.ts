/** @exemplarjs/xml: XML reading, through a cursor or event objects. */
export { XMLInputFactory } from './config/factory.ts';
export type { CatalogProcessor, CatalogResolution, InputOptions, Limits, XIncludeProcessor } from './config/options.ts';
export { DEFAULT_LIMITS } from './config/options.ts';
export { EventType } from './cursor/event-type.ts';
export type { AsyncStreamReader, StreamReader } from './cursor/readers.ts';
export type { Doctype, StreamFilter } from './cursor/stream-reader.ts';
export type {
  AttributeDeclaration,
  AttributeType,
  DefaultMode,
  ElementDeclaration,
  EntityDeclaration,
  NotationDeclaration,
} from './dtd/declarations.ts';
export type { DtdItem } from './dtd/store.ts';
export { ErrorCode } from './errors/codes.ts';
export { AsyncEventReader, type EventFilter, EventReader } from './events/event-reader.ts';
export {
  Attribute,
  type CharactersEvent,
  type CommentEvent,
  type DTDEvent,
  type EndDocumentEvent,
  type EndElementEvent,
  type EntityBoundaryEvent,
  type EntityReferenceEvent,
  type Namespace,
  type ProcessingInstructionEvent,
  QName,
  type StartDocumentEvent,
  type StartElementEvent,
  type XMLEvent,
} from './events/events.ts';
export { type ErrorHandler, type Location, XMLError } from './errors/xml-error.ts';
export type { Decoder, DecoderFactory } from './input/decoders.ts';
export type { Source, SourceObject } from './input/source.ts';
export {
  type AccessList,
  type EntityResolver,
  type Resolution,
  ResolutionError,
  type ResolveRequest,
  type ResolvedSource,
  type URIResolver,
} from './resolvers/resolver.ts';
