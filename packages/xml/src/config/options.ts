import type { StreamReader } from '../cursor/stream-reader.ts';
import type { Validator } from '../cursor/validation.ts';
import type { ErrorHandler } from '../errors/xml-error.ts';
import type { DecoderFactory, DecoderRegistry } from '../input/decoders.ts';
import type { AsyncOpenedSource, OpenedSource, Source } from '../input/source.ts';
import type { AccessList, EntityResolver, ResolvedSource, URIResolver } from '../resolvers/resolver.ts';

/** The processing limits, defaulted as the JDK 24 `jdk.xml.*` limits are. */
export interface Limits {
  /** Entity expansions in a document; the JDK's `entityExpansionLimit`. */
  readonly entityExpansions: number;
  /** Characters all expansions produce; the JDK's `totalEntitySizeLimit`. */
  readonly totalEntitySize: number;
  /** Characters in one general entity; the JDK's `maxGeneralEntitySizeLimit`. */
  readonly generalEntitySize: number;
  /** Characters in one parameter entity; the JDK's `maxParameterEntitySizeLimit`. */
  readonly parameterEntitySize: number;
  /** Events produced inside entities; the JDK's `entityReplacementLimit`. */
  readonly entityReferenceNodes: number;
  /** Attributes on one element; the JDK's `elementAttributeLimit`. */
  readonly attributesPerElement: number;
  /** Element nesting; the JDK's `maxElementDepth`. */
  readonly elementDepth: number;
  /** Characters in one name; the JDK's `maxXMLNameLimit`. */
  readonly nameLength: number;
}

/** The JDK 24 defaults. */
export const DEFAULT_LIMITS: Limits = {
  entityExpansions: 2500,
  totalEntitySize: 100_000,
  generalEntitySize: 100_000,
  parameterEntitySize: 15_000,
  entityReferenceNodes: 100_000,
  attributesPerElement: 200,
  elementDepth: 100,
  nameLength: 1000,
};

/** Performs XInclude processing; `xincludeProcessor()` from `@exemplarjs/xinclude` makes one. */
export interface XIncludeProcessor {
  /** Creates a reader that carries out the inclusions in the document it reads. @internal */
  createReader(
    source: Source | undefined,
    opened: OpenedSource,
    options: ResolvedOptions,
    registry: DecoderRegistry,
    input?: AsyncOpenedSource
  ): StreamReader;
}

/** What a catalog does when nothing matches: fail, carry on as if there were no catalog, or read nothing. */
export type CatalogResolution = 'strict' | 'continue' | 'ignore';

/** Maps identifiers and URIs to the resources to read instead; `catalogResolver()` from `@exemplarjs/catalog` makes one. */
export interface CatalogProcessor {
  /** What happens when nothing in the catalog matches a reference. */
  readonly resolution: CatalogResolution;
  /** The URI an external identifier maps to, or undefined. */
  matchEntity(publicId: string | undefined, systemId: string | undefined, baseURI?: string): string | undefined;
  /** The URI a URI reference maps to, or undefined. */
  matchURI(uri: string, baseURI?: string): string | undefined;
  /** Reads a resource the catalog maps to, when no resolver supplies it. */
  read(uri: string): ResolvedSource | undefined;
}

/** The options of an `XMLInputFactory`. */
export interface InputOptions {
  /** A DTD validator from `@exemplarjs/validation`. */
  readonly validator?: Validator;
  /** An XInclude processor from `@exemplarjs/xinclude`, which switches XInclude on. */
  readonly xinclude?: XIncludeProcessor;
  /** Apply Namespaces in XML: resolve prefixes and check qualified names. On by default. */
  readonly namespaceAware?: boolean;
  /** Report `xmlns` declarations as attributes too, as SAX's `namespace-prefixes` feature does. Off by default. */
  readonly namespacePrefixes?: boolean;
  /**
   * Check the structural well-formedness rules: names, end-tag matching, duplicate attributes,
   * references, `]]>`, `--`, PI targets and prolog order. On by default; turn off only for trusted
   * input. Characters are always checked.
   */
  readonly checkWellFormedness?: boolean;
  /** Warn, once, when XML 1.1 text is not fully normalized (XML 1.1 §2.13). Off by default. */
  readonly checkNormalization?: boolean;
  /** Fail any document that has a DOCTYPE, for input that must not declare entities. Off by default. */
  readonly disallowDoctype?: boolean;
  /** Report whitespace outside the root element as SPACE events. Off by default. */
  readonly reportPrologWhitespace?: boolean;
  /** Merge adjacent text, CDATA and entity text into one CHARACTERS event. Off by default. */
  readonly coalescing?: boolean;
  /** Report where each expanded entity starts and ends, as START_ENTITY and END_ENTITY events. Off by default. */
  readonly reportEntityBoundaries?: boolean;
  /** Copy strings instead of slicing the input, so that kept strings do not hold its chunks. Off by default. */
  readonly copyStrings?: boolean;
  /** Expand entity references; when false, report each as an ENTITY_REFERENCE event. On by default. */
  readonly replaceEntityReferences?: boolean;
  /** Read external parsed entities, as the access list allows. On by default. */
  readonly supportExternalEntities?: boolean;
  /** The protocols an external DTD may be read with, such as `['file']`, or `'all'`. None by default. */
  readonly accessExternalDTD?: AccessList;
  /** The protocols external entities may be read with. None by default. */
  readonly accessExternalEntities?: AccessList;
  /** Supplies external entities and DTDs, asked before anything is read by URI. */
  readonly entityResolver?: EntityResolver;
  /** Supplies resources by URI, such as XInclude targets. */
  readonly uriResolver?: URIResolver;
  /** A catalog from `@exemplarjs/catalog`, asked after the entity and URI resolvers. */
  readonly catalog?: CatalogProcessor;
  /** Entities known in advance, by name, with their replacement text, as if the DTD declared them. */
  readonly entities?: Readonly<Record<string, string>>;
  /** Receives warnings and errors. Without an `error` handler, a recoverable error is thrown and ends the document. */
  readonly errorHandler?: ErrorHandler;
  /** Decoders for more encodings, by name, such as `@exemplarjs/encodings-cjk`'s. */
  readonly decoders?: Readonly<Record<string, DecoderFactory>>;
  /** The processing limits to change; the others keep their defaults, `DEFAULT_LIMITS`. */
  readonly limits?: Partial<Limits>;
}

/** The options with every default filled in, as the readers use them; each field is `InputOptions`' field of that name. */
export interface ResolvedOptions {
  readonly validator: Validator | undefined;
  readonly xinclude: XIncludeProcessor | undefined;
  readonly namespaceAware: boolean;
  readonly namespacePrefixes: boolean;
  readonly checkWellFormedness: boolean;
  readonly checkNormalization: boolean;
  readonly disallowDoctype: boolean;
  readonly reportPrologWhitespace: boolean;
  readonly coalescing: boolean;
  readonly reportEntityBoundaries: boolean;
  readonly copyStrings: boolean;
  readonly replaceEntityReferences: boolean;
  readonly supportExternalEntities: boolean;
  readonly accessExternalDTD: AccessList;
  readonly accessExternalEntities: AccessList;
  readonly entityResolver: EntityResolver | undefined;
  readonly uriResolver: URIResolver | undefined;
  readonly catalog: CatalogProcessor | undefined;
  readonly entities: ReadonlyMap<string, string>;
  readonly errorHandler: ErrorHandler;
  readonly decoders: Readonly<Record<string, DecoderFactory>>;
  readonly limits: Limits;
}

/** Fills in the defaults. */
export function resolveOptions(options: InputOptions): ResolvedOptions {
  return {
    validator: options.validator,
    xinclude: options.xinclude,
    namespaceAware: options.namespaceAware ?? true,
    namespacePrefixes: options.namespacePrefixes ?? false,
    checkWellFormedness: options.checkWellFormedness ?? true,
    checkNormalization: options.checkNormalization ?? false,
    disallowDoctype: options.disallowDoctype ?? false,
    reportPrologWhitespace: options.reportPrologWhitespace ?? false,
    coalescing: options.coalescing ?? false,
    reportEntityBoundaries: options.reportEntityBoundaries ?? false,
    copyStrings: options.copyStrings ?? false,
    replaceEntityReferences: options.replaceEntityReferences ?? true,
    supportExternalEntities: options.supportExternalEntities ?? true,
    accessExternalDTD: options.accessExternalDTD ?? [],
    accessExternalEntities: options.accessExternalEntities ?? [],
    entityResolver: options.entityResolver,
    uriResolver: options.uriResolver,
    catalog: options.catalog,
    entities: new Map(Object.entries(options.entities ?? {})),
    errorHandler: options.errorHandler ?? {},
    decoders: options.decoders ?? {},
    limits: { ...DEFAULT_LIMITS, ...options.limits },
  };
}
