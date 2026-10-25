import type { ResolvedSource } from '@exemplarjs/xml';
import {
  BYTE_ORDER_MARK,
  type DecoderRegistry,
  canonicalEncoding,
  detect,
  holdsNonChar,
  startsWithBytes,
} from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';

/** Why a text inclusion failed: a resource error, which a fallback may replace, or a fatal one. */
export class TextInclusionError extends Error {
  readonly isFatal: boolean;

  constructor(message: string, kind: 'resource' | 'fatal') {
    super(message);
    this.name = 'TextInclusionError';
    this.isFatal = kind === 'fatal';
  }
}

/** The start of an XML declaration, `<?xml`, in ASCII. */
const XML_DECLARATION_START = new TextEncoder().encode('<?xml');

const { UTF16BE, UTF16LE } = BYTE_ORDER_MARK;

/** The encoding XML's rules give text that begins as an XML document does, without a BOM; undefined for other text. */
function encodingByXmlRules(bytes: Uint8Array): string | undefined {
  const detection = detect(bytes, true);
  if (detection === undefined || detection.byteOrderMark !== undefined) return undefined;
  return detection.family !== 'ascii' || startsWithBytes(bytes, XML_DECLARATION_START)
    ? detection.decoderName
    : undefined;
}

/** The encoding of text nothing names: UTF-16 when it starts with the first byte of either UTF-16 BOM, else UTF-8. */
function defaultEncoding(bytes: Uint8Array): string {
  const first = bytes[0];
  return first === UTF16BE[0] || first === UTF16LE[0] ? 'UTF-16' : 'UTF-8';
}

/** The encoding of included text: one supplied from outside, then XML's rules for XML, then the `encoding` attribute, else UTF-8. */
function encodingOf(source: ResolvedSource, attribute: string | undefined, bytes: Uint8Array): string {
  const named = source.encoding ?? encodingByXmlRules(bytes) ?? attribute ?? defaultEncoding(bytes);
  // UTF-16 takes its byte order from a BOM.
  if (canonicalEncoding(named) !== 'utf-16') return named;
  return startsWithBytes(bytes, UTF16LE) ? 'UTF-16LE' : 'UTF-16BE';
}

/** Whether an encoding's name gives its byte order, so a leading U+FEFF is a character rather than a BOM. */
function namesByteOrder(name: string): boolean {
  return /^(utf-16|utf-32)(le|be)$/.test(canonicalEncoding(name));
}

/** Reads a resource as text for `parse="text"` (XInclude §4.3): decoded, its BOM dropped, its characters checked. */
export function includedText(
  source: ResolvedSource,
  encoding: string | undefined,
  version11: boolean,
  registry: DecoderRegistry
): string {
  let text = source.text;
  let keepsByteOrderMark = false;
  if (text === undefined) {
    const bytes = source.bytes;
    if (bytes === undefined)
      throw ErrorFactory.create(TextInclusionError, 'The resource cannot be read as text here', 'resource');
    const named = source.encoding ?? encoding;
    keepsByteOrderMark = named !== undefined && namesByteOrder(named);
    const name = encodingOf(source, encoding, bytes);
    const factory = registry.get(canonicalEncoding(name));
    if (factory === undefined)
      throw ErrorFactory.create(TextInclusionError, `The encoding ${name} is not supported`, 'resource');
    try {
      text = factory().decode(bytes);
    } catch {
      throw ErrorFactory.create(TextInclusionError, `The resource holds bytes that are not ${name}`, 'fatal');
    }
  }
  if (text.startsWith('\uFEFF') && !keepsByteOrderMark) text = text.slice(1);
  if (holdsNonChar(text, version11)) {
    throw ErrorFactory.create(TextInclusionError, 'The included text holds a character XML does not allow', 'fatal');
  }
  return text;
}
