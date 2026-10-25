import { holdsAt, sameSpan } from '../scan/scanner.ts';
import { XML_NAMESPACE } from '../util/namespaces.ts';

/** The binding of the `xml` prefix, which is always in scope. */
const XML_BINDING = 0;
/** The first binding of the empty prefix, to no namespace, which is in scope until a default namespace is declared. */
const NO_DEFAULT_NAMESPACE = 1;
/** The first binding a document declares. */
const FIRST_DECLARED = 2;

/**
 * The namespace bindings in scope, as a stack with the innermost last. Each `xmlns:p="uri"`
 * declaration pushes a binding of `p` to `uri`, and leaving its element pops it again. A binding
 * is found by its index in the stack.
 *
 * To avoid building strings for every declaration, a prefix or URI is kept as a span of document
 * offsets and sliced from the tokenizer's buffer only when asked for, or just before the buffer
 * drops its text. Methods that read text take the buffer and its `bufferOffset`, the document
 * offset of the buffer's first character.
 */
export class NamespaceBindings {
  /** Where each binding's prefix starts and ends, as document offsets; -1 for a binding given as strings. */
  readonly #prefixStart: number[] = [0, 0];
  readonly #prefixEnd: number[] = [0, 0];
  /** Each prefix once sliced; undefined until then. */
  readonly #prefixes: (string | undefined)[] = ['xml', ''];
  /** Where each binding's URI starts and ends, as document offsets. */
  readonly #uriStart: number[] = [0, 0];
  readonly #uriEnd: number[] = [0, 0];
  /** Each URI once sliced, or as given when it had to be normalized; undefined until then. */
  readonly #uris: (string | undefined)[] = [XML_NAMESPACE, ''];
  /** How many bindings are in scope. */
  count = 2;
  /** The innermost binding of the empty prefix: the default namespace. */
  defaultIndex = NO_DEFAULT_NAMESPACE;

  /** The innermost binding of the prefix at buffer indexes `[start, end)`, or -1 if it isn't bound. */
  findBinding(buffer: string, bufferOffset: number, start: number, end: number): number {
    const length = end - start;
    if (length === 'xml'.length && holdsAt(buffer, start, 'xml')) return XML_BINDING;
    for (let binding = this.count - 1; binding >= FIRST_DECLARED; binding--) {
      const prefix = this.#prefixes[binding];
      const prefixStart = (this.#prefixStart[binding] as number) - bufferOffset;
      const prefixLength =
        prefix === undefined ? (this.#prefixEnd[binding] as number) - bufferOffset - prefixStart : prefix.length;
      if (
        prefixLength === length &&
        (prefix === undefined ? sameSpan(buffer, start, prefixStart, length) : holdsAt(buffer, start, prefix))
      ) {
        return binding;
      }
    }
    return length === 0 ? NO_DEFAULT_NAMESPACE : -1;
  }

  /** The innermost binding of a prefix given as a string, or -1 if it isn't bound. */
  findBindingOf(prefix: string, buffer: string, bufferOffset: number): number {
    if (prefix === 'xml') return XML_BINDING;
    for (let binding = this.count - 1; binding >= FIRST_DECLARED; binding--) {
      if (this.prefix(binding, buffer, bufferOffset) === prefix) return binding;
    }
    return prefix === '' ? NO_DEFAULT_NAMESPACE : -1;
  }

  /** Whether a binding binds its prefix to no namespace, as `xmlns=""` does. */
  isEmpty(binding: number): boolean {
    const uri = this.#uris[binding];
    return uri === undefined ? this.#uriEnd[binding] === this.#uriStart[binding] : uri === '';
  }

  /**
   * Pushes a binding given as document offsets, with its URI as a string if it had to be
   * normalized; returns the binding's index.
   */
  bind(prefixStart: number, prefixEnd: number, uriStart: number, uriEnd: number, uri: string | undefined): number {
    const binding = this.count++;
    this.#prefixStart[binding] = prefixStart;
    this.#prefixEnd[binding] = prefixEnd;
    this.#prefixes[binding] = prefixStart === prefixEnd ? '' : undefined;
    this.#uriStart[binding] = uriStart;
    this.#uriEnd[binding] = uriEnd;
    this.#uris[binding] = uri;
    return binding;
  }

  /** Pushes a binding given as strings, as a declaration defaulted from the DTD is; returns the binding's index. */
  bindStrings(prefix: string, uri: string): number {
    const binding = this.bind(-1, -1, -1, -1, uri);
    this.#prefixes[binding] = prefix;
    return binding;
  }

  /** A binding's prefix, sliced from the buffer the first time it is asked for. */
  prefix(binding: number, buffer: string, bufferOffset: number): string {
    let prefix = this.#prefixes[binding];
    if (prefix === undefined) {
      prefix = buffer.slice(
        (this.#prefixStart[binding] as number) - bufferOffset,
        (this.#prefixEnd[binding] as number) - bufferOffset
      );
      this.#prefixes[binding] = prefix;
    }
    return prefix;
  }

  /** A binding's URI, sliced from the buffer the first time it is asked for. */
  uri(binding: number, buffer: string, bufferOffset: number): string {
    let uri = this.#uris[binding];
    if (uri === undefined) {
      uri = buffer.slice(
        (this.#uriStart[binding] as number) - bufferOffset,
        (this.#uriEnd[binding] as number) - bufferOffset
      );
      this.#uris[binding] = uri;
    }
    return uri;
  }

  /** Slices every prefix and URI whose text starts before document offset `dropOffset`, which the buffer is about to drop. */
  sliceBeforeDrop(buffer: string, bufferOffset: number, dropOffset: number): void {
    for (let binding = FIRST_DECLARED; binding < this.count; binding++) {
      if ((this.#prefixStart[binding] as number) < dropOffset) this.prefix(binding, buffer, bufferOffset);
      if ((this.#uriStart[binding] as number) < dropOffset) this.uri(binding, buffer, bufferOffset);
    }
  }
}
