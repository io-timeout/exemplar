import { type DtdItem, type EntityResolver, EventType, type XIncludeProcessor } from '@exemplarjs/xml';
import { INCLUDED_DECLARATIONS, StreamReader, type Validator } from '@exemplarjs/xml/internal';

/** A validator that reports all whitespace character data as whitespace in element content (SPACE). */
export const spaceValidator: Validator = {
  create: (context) => ({
    dtd: () => undefined,
    startElement: () => undefined,
    endElement: () => undefined,
    text: (event) => event === EventType.CHARACTERS && context.reader.isWhitespace(),
    markup: () => undefined,
    entity: () => undefined,
    endDocument: () => undefined,
  }),
};

/** A cursor that reports the given declarations as XInclude's included ones. */
class IncludingReader extends StreamReader {
  readonly #items: readonly DtdItem[];

  constructor(items: readonly DtdItem[], ...args: ConstructorParameters<typeof StreamReader>) {
    super(...args);
    this.#items = items;
  }

  override [INCLUDED_DECLARATIONS](): readonly DtdItem[] {
    return this.#items;
  }
}

/** An XInclude processor that includes nothing but reports declarations as if included content had brought them. */
export function including(items: readonly DtdItem[]): XIncludeProcessor {
  return {
    createReader: (_source, opened, options, registry, input) =>
      new IncludingReader(items, opened, options, registry, input),
  };
}

/** A cursor that leaves out the document element but the elements in it, as a root xi:include gives way to its fallback. */
class FallbackReader extends StreamReader {
  #depth = 0;

  override next(): EventType {
    for (;;) {
      const event = super.next();
      if (event === EventType.START_ELEMENT && ++this.#depth === 1) continue;
      if (event === EventType.END_ELEMENT && --this.#depth === 0) continue;
      // Text, comments and references directly in the document element are ignored.
      if (this.#depth !== 1 || event === EventType.START_ELEMENT || event === EventType.END_ELEMENT) return event;
    }
  }
}

/** An XInclude processor that puts the elements inside the document element in its place, ignoring the rest of it. */
export const fallingBack: XIncludeProcessor = {
  createReader: (_source, opened, options, registry, input) => new FallbackReader(opened, options, registry, input),
};

/** A resolver that supplies external entities as UTF-8 bytes, from a map of system ids to text. */
export function resolver(files: Readonly<Record<string, string>>, base = 'file:///ext/'): EntityResolver {
  return {
    resolveEntity: ({ systemId }) => {
      const text = systemId === undefined ? undefined : files[systemId];
      if (text === undefined) return undefined;
      return { systemId: new URL(systemId as string, base).href, bytes: new TextEncoder().encode(text) };
    },
  };
}
