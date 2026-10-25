import { XMLNS_NAMESPACE, XML_NAMESPACE, isNcName, isXmlName, splitQName } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';

/** The namespace the DTD's attribute types are named in, and the schema type that names the DTD. */
export const DTD_TYPES = 'http://www.w3.org/TR/REC-xml';

/** Throws the DOMException a name check needs. */
export function fail(name: string, message: string): never {
  throw ErrorFactory.create(DOMException, message, name);
}

/** Checks that a name is an XML name (INVALID_CHARACTER_ERR). */
export function checkName(name: string): void {
  if (!isXmlName(name)) fail('InvalidCharacterError', `${name} is not an XML name`);
}

/** Checks a qualified name: its colons first (NAMESPACE_ERR), as Xerces does, then its characters, then its local part; returns [prefix, localName]. */
export function checkQName(qualifiedName: string): [string, string] {
  const parts = splitQName(qualifiedName);
  if (parts === undefined) fail('NamespaceError', `${qualifiedName} is not a qualified name`);
  checkName(qualifiedName);
  // An XML name's local part can still start with a character no NCName starts with, such as a digit.
  if (parts[0] !== '' && !isNcName(parts[1])) fail('NamespaceError', `${qualifiedName} is not a qualified name`);
  return parts;
}

/** A namespace URI or prefix, with the empty string read as none. */
export function orNull(value: string | null): string | null {
  return value === '' ? null : value;
}

/** Splits a qualified name, checking it as `createElementNS` and `createAttributeNS` do; returns [prefix, localName]. */
export function checkQualifiedName(namespaceURI: string | null, qualifiedName: string): [string | null, string] {
  const [given, localName] = checkQName(qualifiedName);
  const prefix = orNull(given);
  checkPrefix(namespaceURI, prefix, qualifiedName);
  return [prefix, localName];
}

/** The namespace rules a prefix and URI must meet together (NAMESPACE_ERR). */
export function checkPrefix(namespaceURI: string | null, prefix: string | null, qualifiedName: string): void {
  if (prefix !== null && (namespaceURI === null || namespaceURI === '')) {
    fail('NamespaceError', `The prefix of ${qualifiedName} needs a namespace`);
  }
  if (prefix === 'xml' && namespaceURI !== XML_NAMESPACE) {
    fail('NamespaceError', 'The xml prefix is bound to the XML namespace');
  }
  const xmlns = prefix === 'xmlns' || (prefix === null && qualifiedName === 'xmlns');
  if (xmlns !== (namespaceURI === XMLNS_NAMESPACE)) {
    fail('NamespaceError', 'xmlns and its prefix go with the XMLNS namespace, and only they do');
  }
}
