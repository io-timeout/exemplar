/** The options of an `XMLOutputFactory`, after the JAXP serializer's output properties. */
export interface OutputOptions {
  /** The string to indent each level with, such as two spaces; no indentation when absent, the default. */
  readonly indent?: string;
  /** Add the namespace declarations that are needed, as StAX's `IS_REPAIRING_NAMESPACES` does; false by default. */
  readonly repairNamespaces?: boolean;
  /** `'roundTrip'`, the default, escapes everything re-reading would change; `'minimal'` only what XML requires. */
  readonly escaping?: 'roundTrip' | 'minimal';
  /** Throw on writes that would not give well-formed XML; true by default. */
  readonly checkWellFormedness?: boolean;
  /** Leave out the XML declaration `writeStartDocument` writes; false by default. */
  readonly omitXMLDeclaration?: boolean;
  /** The XML version the declaration names when `writeStartDocument` is given none; 1.0 by default. */
  readonly version?: '1.0' | '1.1';
  /** The public identifier of the DOCTYPE written before the root element; used only with `doctypeSystem`. */
  readonly doctypePublic?: string;
  /** Write a DOCTYPE with this system identifier before the root element, unless one is written already. */
  readonly doctypeSystem?: string;
  /** Elements, by qualified name, whose text is written as CDATA sections. */
  readonly cdataSectionElements?: readonly string[];
  /** The encoding for byte output, and the one the XML declaration names; UTF-8 by default. */
  readonly encoding?: string;
  /** Keep namespaces, the default; when false, names are written as given, colons and all. */
  readonly namespaceAware?: boolean;
}

/** Output options with every default filled in. */
export interface ResolvedOutputOptions {
  readonly indent: string | undefined;
  readonly repairNamespaces: boolean;
  readonly escaping: 'roundTrip' | 'minimal';
  readonly checkWellFormedness: boolean;
  readonly omitXMLDeclaration: boolean;
  readonly version: '1.0' | '1.1';
  readonly doctypePublic: string | undefined;
  readonly doctypeSystem: string | undefined;
  readonly cdataSectionElements: ReadonlySet<string>;
  readonly encoding: string;
  readonly namespaceAware: boolean;
}

/** Fills in the defaults. */
export function resolveOutputOptions(options: OutputOptions): ResolvedOutputOptions {
  return {
    indent: options.indent,
    repairNamespaces: options.repairNamespaces ?? false,
    escaping: options.escaping ?? 'roundTrip',
    checkWellFormedness: options.checkWellFormedness ?? true,
    omitXMLDeclaration: options.omitXMLDeclaration ?? false,
    version: options.version ?? '1.0',
    doctypePublic: options.doctypePublic,
    doctypeSystem: options.doctypeSystem,
    cdataSectionElements: new Set(options.cdataSectionElements),
    encoding: options.encoding ?? 'UTF-8',
    namespaceAware: options.namespaceAware ?? true,
  };
}
