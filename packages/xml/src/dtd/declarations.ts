/**
 * An entity declaration (§4.2): `<!ENTITY name "text">` declares an internal entity, and
 * `<!ENTITY name SYSTEM "uri">` an external one, whose text is read from elsewhere.
 */
export interface EntityDeclaration {
  readonly name: string;
  /** Whether it is a parameter entity, `<!ENTITY % name …>`, used only inside the DTD. */
  readonly isParameterEntity: boolean;
  /** The replacement text of an internal entity. */
  readonly value?: string;
  /** An external entity's public identifier, normalized. */
  readonly publicId?: string;
  /** An external entity's system identifier, as written. */
  readonly systemId?: string;
  /** The notation of an unparsed entity. */
  readonly notation?: string;
  /** The base URI a relative system id resolves against: the URI of the entity the declaration sits in. */
  readonly baseURI?: string;
  /** Whether the declaration sits in the external subset or a parameter entity, which `standalone="yes"` does not count. */
  readonly declaredExternally: boolean;
}

/** An attribute type (§3.3.1); enumerations that are not notations are `ENUMERATION`. */
export type AttributeType =
  | 'CDATA'
  | 'ID'
  | 'IDREF'
  | 'IDREFS'
  | 'ENTITY'
  | 'ENTITIES'
  | 'NMTOKEN'
  | 'NMTOKENS'
  | 'NOTATION'
  | 'ENUMERATION';

/** How an attribute declaration defaults its value (§3.3.2). */
export type DefaultMode = 'REQUIRED' | 'IMPLIED' | 'FIXED' | 'DEFAULT';

/** One attribute of an attribute-list declaration (§3.3), such as `id ID #REQUIRED` in `<!ATTLIST item id ID #REQUIRED>`. */
export interface AttributeDeclaration {
  /** The element the attribute belongs to. */
  readonly element: string;
  readonly name: string;
  readonly type: AttributeType;
  /** The names a NOTATION or enumerated attribute allows. */
  readonly values?: readonly string[];
  /** Whether the attribute is required, optional, fixed, or defaulted. */
  readonly mode: DefaultMode;
  /** The default value, normalized for its type. */
  readonly value?: string;
  /** Whether the declaration sits in the external subset or a parameter entity, which `standalone="yes"` does not count. */
  readonly declaredExternally: boolean;
}

/** An element type declaration (§3.2), such as `<!ELEMENT list (item)*>`. */
export interface ElementDeclaration {
  readonly name: string;
  /** The content model as written, without whitespace: `EMPTY`, `ANY`, or a model such as `(item)*`. */
  readonly content: string;
  /** Whether the declaration sits in the external subset or a parameter entity, which `standalone="yes"` does not count. */
  readonly declaredExternally: boolean;
}

/** A notation declaration (§4.7), which names a format, such as `<!NOTATION gif SYSTEM "image/gif">`. */
export interface NotationDeclaration {
  readonly name: string;
  readonly publicId?: string;
  readonly systemId?: string;
  /** The base URI a relative system id resolves against. */
  readonly baseURI?: string;
}
