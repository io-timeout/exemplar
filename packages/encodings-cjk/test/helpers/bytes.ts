import type { Decoder, DecoderFactory } from '@exemplarjs/xml';
import { cjkDecoders } from '@/index.ts';

/** Bytes from hex pairs, such as `'82a0'`. */
export function hex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** Bytes from ASCII text and byte lists, in order. */
export function bytes(...parts: readonly (string | readonly number[] | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    // eslint-disable-next-line prefer-code-point -- ASCII text
    if (typeof part === 'string') for (const c of part) out.push(c.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

/** The registered decoder factory for a canonical charset name. */
export function factory(name: string): DecoderFactory {
  const found = cjkDecoders[name];
  if (found === undefined) throw new Error(`No decoder for ${name}`);
  return found;
}

/** Decodes bytes whole with a fresh decoder of a charset. */
export function decode(name: string, input: Uint8Array | string): string {
  return factory(name)().decode(typeof input === 'string' ? hex(input) : input);
}

/** Decodes chunks with one decoder, streaming each, then flushes. */
export function decodeChunks(decoder: Decoder, chunks: readonly Uint8Array[]): string {
  let out = '';
  for (const chunk of chunks) out += decoder.decode(chunk, { stream: true });
  return out + decoder.decode();
}

/** Every way of splitting bytes in two, as a pair of chunks. */
export function splits(input: Uint8Array): Uint8Array[][] {
  return Array.from({ length: input.length + 1 }, (_, at) => [input.subarray(0, at), input.subarray(at)]);
}

/** The bytes one at a time. */
export function byteByByte(input: Uint8Array): Uint8Array[] {
  return Array.from(input, (b) => Uint8Array.of(b));
}

/** What decoding gives: the text, or `null` when the decoder rejects the bytes. */
export function outcome(name: string, input: string): string | null {
  try {
    return decode(name, input);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}
