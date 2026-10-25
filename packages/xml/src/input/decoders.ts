import { SINGLE_BYTE_DECODERS, Utf16Decoder, Utf32Decoder } from '../encodings/decoders.ts';
import { ALIASES } from './aliases.ts';

/** Anything that decodes bytes the way `TextDecoder` does. */
export interface Decoder {
  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string;
}

/** Creates a fresh decoder for one document. */
export type DecoderFactory = () => Decoder;

/** A factory for a fatal `TextDecoder`, which leaves the byte-order mark for exemplar to handle. */
function nativeDecoder(label: string): DecoderFactory {
  return () => new TextDecoder(label, { fatal: true, ignoreBOM: true });
}

/** The decoders built in: `TextDecoder` for UTF-8 and GB18030, wrapped for UTF-16, and exemplar's own for the rest. */
const BUILT_IN_DECODERS: Readonly<Record<string, DecoderFactory>> = {
  'utf-8': nativeDecoder('utf-8'),
  'utf-16le': () => new Utf16Decoder('UTF-16LE'),
  'utf-16be': () => new Utf16Decoder('UTF-16BE'),
  gb18030: nativeDecoder('gb18030'),
  'utf-32be': () => new Utf32Decoder('UTF-32BE', '1234'),
  'utf-32le': () => new Utf32Decoder('UTF-32LE', '4321'),
  'x-ucs-4-2143': () => new Utf32Decoder('UCS-4 in 2143 order', '2143'),
  'x-ucs-4-3412': () => new Utf32Decoder('UCS-4 in 3412 order', '3412'),
  ...SINGLE_BYTE_DECODERS,
};

/** Returns the canonical name for a declared encoding name, or the lower-cased name when exemplar has no alias. */
export function canonicalEncoding(name: string): string {
  const lower = name.toLowerCase();
  return ALIASES[lower] ?? lower;
}

/** The decoders a factory can use: the built-in ones plus any the caller registers. */
export class DecoderRegistry {
  readonly #factories: Map<string, DecoderFactory>;

  constructor(registered: Readonly<Record<string, DecoderFactory>> = {}) {
    this.#factories = new Map(Object.entries(BUILT_IN_DECODERS));
    for (const [name, factory] of Object.entries(registered)) this.#factories.set(canonicalEncoding(name), factory);
  }

  /** The decoder factory for a canonical encoding name, or undefined when none is registered. */
  get(name: string): DecoderFactory | undefined {
    return this.#factories.get(name);
  }
}
