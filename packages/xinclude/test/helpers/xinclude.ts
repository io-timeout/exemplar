import { canonicalize } from '@exemplarjs/canonical';
import {
  type EntityResolver,
  EventType,
  type InputOptions,
  type AsyncStreamReader,
  type ResolvedSource,
  type StreamReader,
  type XIncludeProcessor,
  XMLError,
  XMLInputFactory,
} from '@exemplarjs/xml';
import { type DecoderRegistry, accessAllows, accessRefusedError } from '@exemplarjs/xml/internal';
import { type XIncludeSettings, xincludeProcessor } from '@/index.ts';

/** The XInclude namespace, and its declaration with the usual prefix. */
export const XI_NS = 'http://www.w3.org/2001/XInclude';
export const XI = `xmlns:xi="${XI_NS}"`;

/** The URI the documents under test are read from. */
export const MAIN = 'file:///doc/main.xml';

/** In-memory resources by absolute URI: text, bytes, or a resolved source given as it is. */
export type Files = Readonly<Record<string, string | Uint8Array | ResolvedSource>>;

/** How a test reads: resolvers answering with promises, the processor's settings, and other factory options. */
export interface Setup {
  readonly async?: boolean;
  readonly settings?: Partial<XIncludeSettings>;
  readonly options?: InputOptions;
}

/** The resource a file map holds for an absolute URI, as a resolver supplies it. */
export function lookup(files: Files, uri: string): ResolvedSource | undefined {
  const file = files[uri];
  if (file === undefined) return undefined;
  if (typeof file === 'string') return { text: file, systemId: uri };
  if (file instanceof Uint8Array) return { bytes: file, systemId: uri };
  return file;
}

/** An entity resolver over in-memory files, resolving each system id against its base URI and keeping to the access list, as the bundled resolvers do. */
export function memoryResolver(files: Files, async = false): EntityResolver {
  return {
    resolveEntity: ({ systemId, baseURI, access }) => {
      const uri = new URL(systemId ?? '', baseURI).href;
      if (access !== undefined && !accessAllows(access, uri)) throw accessRefusedError(uri);
      const found = lookup(files, uri);
      return async ? Promise.resolve(found) : found;
    },
  };
}

/** A factory with XInclude on that reads in-memory files, with every protocol allowed. */
export function factory(files: Files, setup: Setup = {}): XMLInputFactory {
  return new XMLInputFactory({
    xinclude: xincludeProcessor(setup.settings),
    accessExternalEntities: 'all',
    entityResolver: memoryResolver(files, setup.async),
    ...setup.options,
  });
}

/** A document read from MAIN with XInclude, in exclusive canonical form, which leaves out unused declarations. */
export function included(files: Files, main: string, setup: Setup = {}): string {
  const reader = factory(files, setup).createStreamReader({ text: main, systemId: MAIN });
  return canonicalize(reader, { method: 'exc-c14n' });
}

/** Escapes text for `written`. */
function escaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

/** Writes the cursor's current event as XML: a start tag's declarations, then its attributes, in reported order. */
export function written(reader: StreamReader | AsyncStreamReader): string {
  switch (reader.eventType()) {
    case EventType.START_ELEMENT: {
      let tag = `<${reader.name()}`;
      for (let i = 0; i < reader.namespaceCount(); i++) {
        const prefix = reader.namespacePrefix(i);
        const name = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
        tag += ` ${name}="${reader.namespaceURI(i)}"`;
      }
      for (let i = 0; i < reader.attributeCount(); i++) {
        tag += ` ${reader.attributeName(i)}="${escaped(reader.attributeValue(i))}"`;
      }
      return `${tag}>`;
    }
    case EventType.END_ELEMENT: {
      return `</${reader.name()}>`;
    }
    case EventType.CHARACTERS:
    case EventType.SPACE:
    case EventType.CDATA: {
      return escaped(reader.text());
    }
    case EventType.COMMENT: {
      return `<!--${reader.text()}-->`;
    }
    case EventType.PROCESSING_INSTRUCTION: {
      return `<?${reader.piTarget()} ${reader.piData()}?>`;
    }
    default: {
      return '';
    }
  }
}

/** Everything a synchronous cursor reports, written out by `written`. */
export function events(reader: StreamReader): string {
  let out = '';
  while (reader.next() !== EventType.END_DOCUMENT) out += written(reader);
  return out;
}

/** Everything an asynchronous cursor reports, waiting for input and resolvers as it asks. */
export async function eventsAsync(reader: AsyncStreamReader): Promise<string> {
  let out = '';
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.NEED_INPUT) await reader.fill();
    else out += written(reader);
  }
  return out;
}

/** A document read from MAIN with XInclude through the cursor, written out by `written`. */
export function read(files: Files, main: string, setup: Setup = {}): string {
  return events(factory(files, setup).createStreamReader({ text: main, systemId: MAIN }));
}

/** The XMLError a call throws; fails when it throws nothing or something else. */
export function errorOf(call: () => unknown): XMLError {
  try {
    call();
  } catch (error) {
    if (error instanceof XMLError) return error;
    throw error;
  }
  throw new Error('Expected an XMLError, but nothing was thrown');
}

/** The XMLError an asynchronous call rejects with. */
export async function asyncErrorOf(call: () => Promise<unknown>): Promise<XMLError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof XMLError) return error;
    throw error;
  }
  throw new Error('Expected an XMLError, but nothing was thrown');
}

/** The error code reading a document from MAIN with XInclude fails with. */
export function failure(files: Files, main: string, setup: Setup = {}): string {
  return errorOf(() => read(files, main, setup)).code;
}

/** The decoder registry a factory gives its readers, caught as XInclude is handed it. */
export function decoderRegistry(options: InputOptions = {}): DecoderRegistry {
  let registry: DecoderRegistry | undefined;
  const inner = xincludeProcessor();
  const catching: XIncludeProcessor = {
    createReader(source, opened, resolved, decoders, input) {
      registry = decoders;
      return inner.createReader(source, opened, resolved, decoders, input);
    },
  };
  new XMLInputFactory({ ...options, xinclude: catching }).createStreamReader('<a/>');
  return registry as DecoderRegistry;
}
