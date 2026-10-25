/** Hooks and helpers the other exemplar packages share; not part of the public API. */
export {
  ADD_FILTER,
  CREATE_READER,
  DTD_COMPLETE,
  DTD_ITEMS,
  EVENT_OFFSET,
  EVENT_POSITION,
  type EntityListener,
  INCLUDED_DECLARATIONS,
  INPUT_ENCODING,
  LISTEN_ENTITIES,
  XML_ENCODING,
  isIndex,
  outOfRange,
} from './cursor/internal.ts';
export { isCharacterData } from './cursor/event-type.ts';
export { StreamReader, isReader } from './cursor/stream-reader.ts';
export type { DocumentValidator, ValidationContext, Validator } from './cursor/validation.ts';
export type { ResolvedOptions } from './config/options.ts';
export { DecodeError, Utf32Decoder, withCarry } from './encodings/decoders.ts';
export { SINGLE_BYTE_TABLES } from './encodings/tables.ts';
export { unmatchedByCatalog } from './entities/external.ts';
export { type DecoderRegistry, canonicalEncoding } from './input/decoders.ts';
export { detect } from './input/detect.ts';
export { type AsyncOpenedSource, type ByteStream, type OpenedSource, openSource, readStream } from './input/source.ts';
export { accessAllows, orElse, accessRefusedError } from './resolvers/resolver.ts';
export type { LineSegment } from './tokenizer/lines.ts';

// The shared helpers in src/util.
export { BYTE_ORDER_MARK, NO_BYTES, concatBytes, startsWithBytes } from './util/bytes.ts';
export { ErrorFactory } from './util/errors.ts';
export {
  Char,
  Unicode,
  byCodeUnit,
  codePointLabel,
  codePointOf,
  holdsNonChar,
  isChar,
  isHighSurrogate,
  isLowSurrogate,
  isRestrictedChar,
  isSurrogate,
} from './util/chars.ts';
export { isNcName, isNmtoken, isXmlName, localPartOf, prefixOf, splitQName } from './util/names.ts';
export {
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
  declaredPrefixes,
  reservedBindingProblem,
  namespacesInScope,
} from './util/namespaces.ts';
export { type NodeLike, NodeType, attributesOf, prefixDeclaredBy } from './util/nodes.ts';
export { escapeAndResolveURI, escapeURI, hasScheme, protocolOf, resolveURI } from './util/uri.ts';
export { isAllWhitespace, isWhitespaceChar, normalizePublicId } from './util/whitespace.ts';
