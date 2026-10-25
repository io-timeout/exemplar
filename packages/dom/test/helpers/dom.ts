import { expect } from 'vitest';
import { type InputOptions, type Source, XMLInputFactory } from '@exemplarjs/xml';
import { type BuilderOptions, type Document, DocumentBuilder, type Node, XMLSerializer } from '@/index.ts';

/** The legacy DOMException codes of the exceptions the DOM raises. */
const CODES = {
  IndexSizeError: 1,
  HierarchyRequestError: 3,
  WrongDocumentError: 4,
  InvalidCharacterError: 5,
  NoModificationAllowedError: 7,
  NotFoundError: 8,
  NotSupportedError: 9,
  InUseAttributeError: 10,
  NamespaceError: 14,
  TypeMismatchError: 17,
} as const;

/** A DOMException name the DOM raises. */
export type DOMExceptionName = keyof typeof CODES;

/** Matches a DOMException by its name and legacy code. */
export function domException(name: DOMExceptionName): unknown {
  return expect.objectContaining({ name, code: CODES[name] });
}

/** Builds a tree with a factory's options and the builder's own. */
export function build(source: Source, options: InputOptions = {}, builder: BuilderOptions = {}): Document {
  return new DocumentBuilder(new XMLInputFactory(options), builder).parse(source);
}

/** Builds a tree asynchronously, as from a stream. */
export function buildAsync(
  source: Source,
  options: InputOptions = {},
  builder: BuilderOptions = {}
): Promise<Document> {
  return new DocumentBuilder(new XMLInputFactory(options), builder).parseAsync(source);
}

/** An empty document. */
export function newDocument(): Document {
  return new DocumentBuilder().newDocument();
}

/** A node serialized as browsers' XMLSerializer does. */
export function serialize(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** UTF-16 bytes of a string, with a byte-order mark. */
export function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xfe_ff, littleEndian);
  // eslint-disable-next-line prefer-code-point -- UTF-16 is code units
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian);
  return out;
}

/** A web stream giving bytes in chunks of one size. */
export function streamOf(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

/** The children of a node as `type:name:text`. */
export function children(node: Node): string[] {
  return [...node.childNodes].map((n) => `${n.nodeType}:${n.nodeName}:${n.textContent}`);
}
