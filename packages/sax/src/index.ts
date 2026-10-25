/** @exemplarjs/sax: the push API, following SAX. */
export type {
  Attributes,
  ContentHandler,
  DTDHandler,
  DeclHandler,
  LexicalHandler,
  Locator,
  SAXErrorHandler,
  SAXHandler,
} from './handler.ts';
export { XMLFilterImpl } from './filter.ts';
export { type SAXOptions, SAXParser } from './parser.ts';
