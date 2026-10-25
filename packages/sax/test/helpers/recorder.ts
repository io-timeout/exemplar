import type { XMLError } from '@exemplarjs/xml';
import type { Attributes, SAXHandler } from '@/index.ts';

/** Every handler method but `setDocumentLocator` and `startElement`, which the recorder writes its own way. */
export const HANDLER_METHODS = [
  'startDocument',
  'endDocument',
  'startPrefixMapping',
  'endPrefixMapping',
  'endElement',
  'characters',
  'ignorableWhitespace',
  'processingInstruction',
  'skippedEntity',
  'startDTD',
  'endDTD',
  'startEntity',
  'endEntity',
  'startCDATA',
  'endCDATA',
  'comment',
  'elementDecl',
  'attributeDecl',
  'internalEntityDecl',
  'externalEntityDecl',
  'notationDecl',
  'unparsedEntityDecl',
  'warning',
  'error',
  'fatalError',
] as const;

/** Writes one argument: strings as they are, errors by code, anything else by type. */
function argument(a: unknown): string {
  if (typeof a === 'string') return a;
  if (typeof a === 'object' && a !== null && 'code' in a) return (a as XMLError).code;
  return String(a);
}

/** Writes a start tag's attributes as `qName=value` pairs. */
export function attributeList(attributes: Attributes): string {
  return Array.from({ length: attributes.length }, (_, i) => `${attributes.qName(i)}=${attributes.value(i)}`).join(' ');
}

/** A handler that records every call as a line, such as `characters(text)`; `only` limits it to some methods. */
export function recorder(only?: readonly string[]): { handler: SAXHandler; calls: string[] } {
  const calls: string[] = [];
  const names = HANDLER_METHODS.filter((name) => only === undefined || only.includes(name));
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(`${name}(${args.map((a) => argument(a)).join(', ')})`);
  const handler: Record<string, unknown> = Object.fromEntries(names.map((name) => [name, record(name)]));
  if (only === undefined || only.includes('startElement')) {
    handler['startElement'] = (uri: string, localName: string, qName: string, attributes: Attributes) => {
      calls.push(`startElement(${uri}, ${localName}, ${qName}, [${attributeList(attributes)}])`);
    };
  }
  return { handler: handler as SAXHandler, calls };
}
