/** Every error code exemplar reports, grouped by what it concerns. */
export const ErrorCode = {
  // Encoding (XML 1.0 §4.3.3)
  /** No decoder is registered for the document's encoding. */
  ENCODING_UNSUPPORTED: 'ENCODING_UNSUPPORTED',
  /** Bytes the document's encoding doesn't allow. */
  ENCODING_INVALID_BYTES: 'ENCODING_INVALID_BYTES',
  /** The encoding the XML declaration names contradicts the byte-order mark or the first bytes. */
  ENCODING_MISMATCH: 'ENCODING_MISMATCH',
  /** A document in an encoding detection can't confirm, such as UTF-16 without a byte-order mark, that doesn't declare it. */
  ENCODING_UNDECLARED: 'ENCODING_UNDECLARED',
  /** A document declared as UTF-16 that doesn't start with a byte-order mark. */
  ENCODING_UTF16_WITHOUT_BOM: 'ENCODING_UTF16_WITHOUT_BOM',
  /** An encoding supplied from outside, such as an HTTP charset, overrides a different declared one (a warning). */
  ENCODING_CONFLICT: 'ENCODING_CONFLICT',
  /** A text declaration, `<?xml encoding="…"?>`, that isn't at the start of its entity. */
  TEXT_DECLARATION_MISPLACED: 'TEXT_DECLARATION_MISPLACED',

  // Characters and line ends (§2.2, §2.11)
  /** A character the XML version doesn't allow in the document, such as a C0 control in XML 1.0. */
  WF_INVALID_CHARACTER: 'WF_INVALID_CHARACTER',
  /** NEL (U+0085) or LS (U+2028) inside an XML or text declaration. */
  WF_LINE_END_IN_DECLARATION: 'WF_LINE_END_IN_DECLARATION',

  // The prolog and the document (§2.1, §2.8)
  /** A document without a root element. */
  WF_EMPTY_DOCUMENT: 'WF_EMPTY_DOCUMENT',
  /** A malformed XML declaration. */
  WF_XML_DECLARATION: 'WF_XML_DECLARATION',
  /** An XML declaration that isn't at the very start of the document. */
  WF_XML_DECLARATION_MISPLACED: 'WF_XML_DECLARATION_MISPLACED',
  /** A DOCTYPE after the root element, or a second DOCTYPE. */
  WF_DOCTYPE_MISPLACED: 'WF_DOCTYPE_MISPLACED',
  /** A malformed DOCTYPE. */
  WF_DOCTYPE: 'WF_DOCTYPE',
  /** Text, CDATA or a reference before or after the root element. */
  WF_CONTENT_OUTSIDE_ROOT: 'WF_CONTENT_OUTSIDE_ROOT',
  /** A second root element. */
  WF_SECOND_ROOT: 'WF_SECOND_ROOT',
  /** Input that ends in the middle of a token, such as inside a tag or a comment. */
  WF_UNEXPECTED_END: 'WF_UNEXPECTED_END',

  // Markup (§2.3–§2.7, §3.1)
  /** A name missing where one is expected, such as after `<`. */
  WF_NAME: 'WF_NAME',
  /** Markup after `<!` that is none of a comment, CDATA section or DOCTYPE. */
  WF_MARKUP: 'WF_MARKUP',
  /** A malformed start or end tag. */
  WF_TAG: 'WF_TAG',
  /** An end tag that doesn't match the open element, or one with no start tag (WFC: Element Type Match). */
  WF_END_TAG_MISMATCH: 'WF_END_TAG_MISMATCH',
  /** An element still open at the end of the document. */
  WF_UNCLOSED_ELEMENT: 'WF_UNCLOSED_ELEMENT',
  /** A malformed attribute: no `=`, or a value without quotes. */
  WF_ATTRIBUTE: 'WF_ATTRIBUTE',
  /** An attribute that appears twice in one start tag (WFC: Unique Att Spec). */
  WF_DUPLICATE_ATTRIBUTE: 'WF_DUPLICATE_ATTRIBUTE',
  /** `<` in an attribute value, written or from an entity (WFC: No < in Attribute Values). */
  WF_LT_IN_ATTRIBUTE: 'WF_LT_IN_ATTRIBUTE',
  /** `--` inside a comment, which may only end it. */
  WF_COMMENT: 'WF_COMMENT',
  /** A malformed processing instruction. */
  WF_PI: 'WF_PI',
  /** A PI target that is `xml` in another case, such as `XML`, which is reserved. */
  WF_PI_TARGET_XML: 'WF_PI_TARGET_XML',
  /** `]]>` in character data, outside a CDATA section. */
  WF_CDATA_END_IN_TEXT: 'WF_CDATA_END_IN_TEXT',

  // References (§4.1)
  /** A malformed reference, such as `&` without a name or `;`. */
  WF_REFERENCE: 'WF_REFERENCE',
  /** A character reference that is malformed or names a character the version doesn't allow (WFC: Legal Character). */
  WF_CHARACTER_REFERENCE: 'WF_CHARACTER_REFERENCE',
  /** A reference to an entity that isn't declared, where that is fatal (WFC: Entity Declared). */
  WF_UNDECLARED_ENTITY: 'WF_UNDECLARED_ENTITY',
  /** An entity that refers to itself, directly or through others (WFC: No Recursion). */
  WF_RECURSIVE_ENTITY: 'WF_RECURSIVE_ENTITY',
  /** A reference to an unparsed entity, one declared with NDATA (WFC: Parsed Entity). */
  WF_UNPARSED_ENTITY: 'WF_UNPARSED_ENTITY',
  /** A reference to an external entity in an attribute value (WFC: No External Entity References). */
  WF_EXTERNAL_ENTITY_IN_ATTRIBUTE: 'WF_EXTERNAL_ENTITY_IN_ATTRIBUTE',
  /** An entity whose text doesn't contain whole elements: it ends an element it didn't start, or leaves one open. */
  WF_ENTITY_CONTENT: 'WF_ENTITY_CONTENT',
  /** An XML 1.1 external entity in an XML 1.0 document. */
  WF_ENTITY_VERSION: 'WF_ENTITY_VERSION',
  /** A reference in an attribute value to an entity whose declaration may be in DTD text that wasn't read. */
  UNREAD_ENTITY_IN_ATTRIBUTE: 'UNREAD_ENTITY_IN_ATTRIBUTE',
  /** A reference to an undeclared entity, where that is only a validity error (VC: Entity Declared). */
  VC_ENTITY_DECLARED: 'VC_ENTITY_DECLARED',

  // The DTD (§2.8, §3.2–§3.4, §4.2, §4.7)
  /** A malformed markup declaration in the DTD. */
  WF_DECLARATION: 'WF_DECLARATION',
  /** A parameter-entity reference inside a declaration in the internal subset (WFC: PEs in Internal Subset). */
  WF_PE_IN_INTERNAL_SUBSET: 'WF_PE_IN_INTERNAL_SUBSET',
  /** A parameter entity between declarations whose text doesn't hold whole declarations (WFC: PE Between Declarations). */
  WF_PE_BETWEEN_DECLARATIONS: 'WF_PE_BETWEEN_DECLARATIONS',
  /** A malformed conditional section, or one in the internal subset. */
  WF_CONDITIONAL_SECTION: 'WF_CONDITIONAL_SECTION',
  /** A malformed text declaration at the start of an external entity. */
  WF_TEXT_DECLARATION: 'WF_TEXT_DECLARATION',

  // Namespaces in XML 1.0 and 1.1
  /** A name that isn't a qualified name: more than one colon, or a colon at either end. */
  NS_QNAME: 'NS_QNAME',
  /** A colon in a name that may not have one, such as an entity name or PI target. */
  NS_COLON: 'NS_COLON',
  /** A prefix that no namespace declaration in scope binds. */
  NS_UNBOUND_PREFIX: 'NS_UNBOUND_PREFIX',
  /** A misuse of the reserved `xml` or `xmlns` prefixes or namespaces. */
  NS_RESERVED: 'NS_RESERVED',
  /** `xmlns:p=""` in XML 1.0, which doesn't allow undeclaring a prefix. */
  NS_UNDECLARED_PREFIX: 'NS_UNDECLARED_PREFIX',
  /** Two attributes with the same namespace URI and local name (NSC: Attributes Unique). */
  NS_DUPLICATE_ATTRIBUTE: 'NS_DUPLICATE_ATTRIBUTE',

  // Limits exemplar sets, as the JDK does
  /** More entity expansions than `limits.entityExpansions`. */
  LIMIT_ENTITY_EXPANSIONS: 'LIMIT_ENTITY_EXPANSIONS',
  /** Entities that expand to more characters in all than `limits.totalEntitySize`. */
  LIMIT_TOTAL_ENTITY_SIZE: 'LIMIT_TOTAL_ENTITY_SIZE',
  /** A general entity longer than `limits.generalEntitySize`. */
  LIMIT_GENERAL_ENTITY_SIZE: 'LIMIT_GENERAL_ENTITY_SIZE',
  /** A parameter entity longer than `limits.parameterEntitySize`. */
  LIMIT_PARAMETER_ENTITY_SIZE: 'LIMIT_PARAMETER_ENTITY_SIZE',
  /** More events from inside entities than `limits.entityReferenceNodes`. */
  LIMIT_ENTITY_REPLACEMENT: 'LIMIT_ENTITY_REPLACEMENT',
  /** Elements nested deeper than `limits.elementDepth`. */
  LIMIT_ELEMENT_DEPTH: 'LIMIT_ELEMENT_DEPTH',
  /** An element with more attributes than `limits.attributesPerElement`. */
  LIMIT_ATTRIBUTES: 'LIMIT_ATTRIBUTES',
  /** A name longer than `limits.nameLength`. */
  LIMIT_NAME_LENGTH: 'LIMIT_NAME_LENGTH',

  // XML 1.1 normalization checking (§2.13)
  /** XML 1.1 text that is not fully normalized, with `checkNormalization` on (a warning). */
  NOT_FULLY_NORMALIZED: 'NOT_FULLY_NORMALIZED',

  // Configuration and external access
  /** A DOCTYPE, with `disallowDoctype` on. */
  DOCTYPE_DISALLOWED: 'DOCTYPE_DISALLOWED',
  /** For a resolver to throw, in a ResolutionError, when it fails to supply what it was asked for. */
  RESOLVER_FAILED: 'RESOLVER_FAILED',
  /** A read the access lists do not allow: `accessExternalDTD` or `accessExternalEntities` must name its protocol. */
  ACCESS_REFUSED: 'ACCESS_REFUSED',

  // Validity constraints (XML 1.0 and Namespaces), reported when validating
  /** A root element whose name isn't the DOCTYPE's (VC: Root Element Type). */
  VC_ROOT_ELEMENT: 'VC_ROOT_ELEMENT',
  /** An element that doesn't match its declared content model, or isn't declared (VC: Element Valid). */
  VC_ELEMENT_VALID: 'VC_ELEMENT_VALID',
  /** An attribute that isn't declared for its element, or a value its declared type doesn't allow (VC: Attribute Value Type). */
  VC_ATTRIBUTE_TYPE: 'VC_ATTRIBUTE_TYPE',
  /** An element type declared more than once (VC: Unique Element Type Declaration). */
  VC_UNIQUE_ELEMENT_TYPE: 'VC_UNIQUE_ELEMENT_TYPE',
  /** Markup or a group that starts in one parameter entity and ends in another (VC: Proper Declaration/PE Nesting). */
  VC_PE_NESTING: 'VC_PE_NESTING',
  /** An element type named twice in one mixed content model (VC: No Duplicate Types). */
  VC_NO_DUPLICATE_TYPES: 'VC_NO_DUPLICATE_TYPES',
  /** An ID value used more than once in the document (VC: ID). */
  VC_ID: 'VC_ID',
  /** An element type with more than one ID attribute declared (VC: One ID per Element Type). */
  VC_ONE_ID: 'VC_ONE_ID',
  /** An ID attribute declared with a default other than #IMPLIED or #REQUIRED (VC: ID Attribute Default). */
  VC_ID_DEFAULT: 'VC_ID_DEFAULT',
  /** An IDREF value that no ID in the document matches (VC: IDREF). */
  VC_IDREF: 'VC_IDREF',
  /** An ENTITY or ENTITIES value that doesn't name a declared unparsed entity (VC: Entity Name). */
  VC_ENTITY_NAME: 'VC_ENTITY_NAME',
  /** An NMTOKEN or NMTOKENS value that isn't name tokens (VC: Name Token). */
  VC_NAME_TOKEN: 'VC_NAME_TOKEN',
  /** A NOTATION attribute's value or declaration naming an undeclared notation (VC: Notation Attributes). */
  VC_NOTATION_ATTRIBUTES: 'VC_NOTATION_ATTRIBUTES',
  /** An element type with more than one NOTATION attribute declared (VC: One Notation Per Element Type). */
  VC_ONE_NOTATION: 'VC_ONE_NOTATION',
  /** A NOTATION attribute declared for an element declared EMPTY (VC: No Notation on Empty Element). */
  VC_NOTATION_EMPTY: 'VC_NOTATION_EMPTY',
  /** A name given twice in one enumerated or NOTATION attribute declaration (VC: No Duplicate Tokens). */
  VC_DUPLICATE_TOKENS: 'VC_DUPLICATE_TOKENS',
  /** An enumerated attribute's value that isn't one of its declared values (VC: Enumeration). */
  VC_ENUMERATION: 'VC_ENUMERATION',
  /** A #REQUIRED attribute left out (VC: Required Attribute). */
  VC_REQUIRED_ATTRIBUTE: 'VC_REQUIRED_ATTRIBUTE',
  /** An attribute's declared default that doesn't fit its type (VC: Attribute Default Value Syntactically Correct). */
  VC_DEFAULT_SYNTAX: 'VC_DEFAULT_SYNTAX',
  /** A #FIXED attribute given a different value (VC: Fixed Attribute Default). */
  VC_FIXED_DEFAULT: 'VC_FIXED_DEFAULT',
  /** An unparsed entity whose notation isn't declared (VC: Notation Declared). */
  VC_NOTATION_DECLARED: 'VC_NOTATION_DECLARED',
  /** A notation declared more than once (VC: Unique Notation Name). */
  VC_UNIQUE_NOTATION: 'VC_UNIQUE_NOTATION',
  /** A `standalone="yes"` document that depends on external declarations (VC: Standalone Document Declaration). */
  VC_STANDALONE: 'VC_STANDALONE',
  /** An ID, IDREF, ENTITY or NOTATION value with a colon, which Namespaces doesn't allow. */
  VC_NAMESPACE_COLON: 'VC_NAMESPACE_COLON',

  // Writing
  /** Writing a name that isn't valid, or a namespace declaration or entity reference where it isn't allowed. */
  WRITE_NAME: 'WRITE_NAME',
  /** Writing a character the XML version doesn't allow. */
  WRITE_CHARACTER: 'WRITE_CHARACTER',
  /** Writing a comment that holds `--` or ends with `-`. */
  WRITE_COMMENT: 'WRITE_COMMENT',
  /** Writing a PI whose target isn't allowed or whose data holds `?>`. */
  WRITE_PI: 'WRITE_PI',
  /** Writing a CDATA section that holds `]]>`. */
  WRITE_CDATA: 'WRITE_CDATA',
  /** Writing something where the document's structure doesn't allow it, such as an XML declaration after content. */
  WRITE_STATE: 'WRITE_STATE',
  /** Writing an attribute, or a prefix's declaration, twice on one element. */
  WRITE_DUPLICATE_ATTRIBUTE: 'WRITE_DUPLICATE_ATTRIBUTE',
  /** Writing a name in a namespace no prefix is bound to, or binding a prefix twice on one element. */
  WRITE_UNBOUND_PREFIX: 'WRITE_UNBOUND_PREFIX',
  /** Writing a character the output encoding can't represent where a character reference isn't allowed, or declaring an encoding other than the output's. */
  WRITE_ENCODING: 'WRITE_ENCODING',

  // Canonicalization
  /** Canonicalizing a document whose DTD or an entity wasn't read, so its result would be incomplete. */
  C14N_UNREAD: 'C14N_UNREAD',
  /** Canonicalizing a document with a relative namespace URI, which Canonical XML doesn't define. */
  C14N_RELATIVE_NAMESPACE: 'C14N_RELATIVE_NAMESPACE',
  /** Canonicalizing an XML 1.1 document, which Canonical XML doesn't define. */
  C14N_VERSION: 'C14N_VERSION',
  /** An `xml:id` value that isn't an NCName (xml:id §4). */
  XMLID_NAME: 'XMLID_NAME',
  /** An `xml:id` attribute the DTD declares with a type other than ID (xml:id §4). */
  XMLID_TYPE: 'XMLID_TYPE',
  /** An ID value used twice, where an `xml:id` holds either (xml:id §4). */
  XMLID_DUPLICATE: 'XMLID_DUPLICATE',
  /** XInclude: a resource that cannot be read, with no fallback. */
  XINCLUDE_RESOURCE: 'XINCLUDE_RESOURCE',
  /** XInclude: a document that includes itself, directly or through others. */
  XINCLUDE_LOOP: 'XINCLUDE_LOOP',
  /** XInclude: an attribute of xi:include that is missing, not allowed, or not well-formed. */
  XINCLUDE_ATTRIBUTE: 'XINCLUDE_ATTRIBUTE',
  /** XInclude: xi:include or xi:fallback where it is not allowed. */
  XINCLUDE_STRUCTURE: 'XINCLUDE_STRUCTURE',
  /** XInclude: an `xpointer` that is not well-formed or identifies nothing, with no fallback. */
  XINCLUDE_POINTER: 'XINCLUDE_POINTER',
  /** XInclude: the document element replaced by something other than one element. */
  XINCLUDE_ROOT: 'XINCLUDE_ROOT',
  /** XInclude: included text holding a character XML does not allow. */
  XINCLUDE_TEXT: 'XINCLUDE_TEXT',
  /** XInclude: unparsed entities or notations of one name declared differently. */
  XINCLUDE_DECLARATION: 'XINCLUDE_DECLARATION',
  /** Catalogs: nothing matches a reference, under `resolve: 'strict'`. */
  CATALOG_NO_MATCH: 'CATALOG_NO_MATCH',
  /** Catalogs: a catalog file leads back to itself through nextCatalog or delegation. */
  CATALOG_CIRCULAR: 'CATALOG_CIRCULAR',
} as const;

/** One of exemplar's error codes. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
