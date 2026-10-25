import type { AsyncStreamReader, StreamReader } from '@exemplarjs/xml';
import { XMLNS_NAMESPACE, XML_NAMESPACE, declaredPrefixes } from '@exemplarjs/xml/internal';
import type { XIncludeSettings } from './reader.ts';
import type { Namespaces, Scope } from './scopes.ts';
import { relativeURI } from './uri.ts';

/** A namespace declaration: its prefix and URI. */
export type NamespaceDeclaration = readonly [string, string];

/** An attribute the reader adds: `xml:base`, `xml:lang`, or a namespace declaration. */
export interface AddedAttribute {
  readonly name: string;
  readonly localName: string;
  readonly prefix: string;
  readonly namespaceURI: string;
  readonly value: string;
}

/**
 * How the current start or end tag differs from the one read: attributes kept and added, declarations
 * added. An included `<p xml:base="a/">` moved into a document whose base differs might be given as
 * `kept: []` (its own xml:base dropped) and `added: [xml:base="sub/a/"]`.
 */
export interface Overlay {
  /** The indices of the attributes read that are kept, in order. */
  readonly kept: readonly number[];
  /** The attributes added after them. */
  readonly added: readonly AddedAttribute[];
  /** The namespace declarations added after the tag's own. */
  readonly declarations: readonly NamespaceDeclaration[];
}

/** No fix-ups, for elements that are not included, such as those at the top of a fallback. */
export const NO_FIXUPS: XIncludeSettings = { fixupBaseURIs: false, fixupLanguage: false };

/** No attribute indices, as an end tag has. */
const NO_ATTRIBUTES: readonly number[] = [];

/** The overlay for an end tag: no attributes, and the declarations added to its start tag. */
export function endTagOverlay(declarations: readonly NamespaceDeclaration[]): Overlay {
  return { kept: NO_ATTRIBUTES, added: [], declarations };
}

/** The overlay for a start tag at the top of what replaces an xi:include: its fix-ups and the declarations it needs. */
export function topOverlay(
  tag: StreamReader | AsyncStreamReader,
  scope: Scope,
  parent: Scope,
  fixups: XIncludeSettings,
  namespacePrefixes: boolean
): Overlay | undefined {
  const fixesBase = fixups.fixupBaseURIs && scope.base !== parent.base;
  const base = fixesBase ? xmlAttribute('base', relativeURI(scope.base, parent.base)) : undefined;
  const lang = fixups.fixupLanguage ? langAttribute(tag, scope.lang, parent.lang) : undefined;
  const declarations = missingDeclarations(scope.namespaces, parent.namespaces, tag);
  if (base === undefined && lang === undefined && declarations.length === 0) return undefined;
  const allIndices = indicesBelow(tag.attributeCount());
  // An added xml:base replaces the element's own.
  const kept = base === undefined ? allIndices : allIndices.filter((index) => !isXmlBase(tag, index));
  const added: AddedAttribute[] = [];
  if (base !== undefined) added.push(base);
  if (lang !== undefined) added.push(lang);
  // With namespacePrefixes on, the declarations are attributes too.
  if (namespacePrefixes) for (const [prefix, uri] of declarations) added.unshift(xmlnsAttribute(prefix, uri));
  return { kept, added, declarations };
}

/** The xml:lang an element lacking one is given when its language is not the parent's. */
function langAttribute(
  tag: StreamReader | AsyncStreamReader,
  lang: string | undefined,
  parentLang: string | undefined
): AddedAttribute | undefined {
  if (tag.attributeValue(XML_NAMESPACE, 'lang') !== undefined) return undefined;
  return sameLanguage(lang, parentLang) ? undefined : xmlAttribute('lang', lang ?? '');
}

/** The declarations an element moved under another parent needs: the bindings in its scope that the parent's lacks. */
function missingDeclarations(
  scope: Namespaces,
  parent: Namespaces,
  tag: StreamReader | AsyncStreamReader
): NamespaceDeclaration[] {
  const declared = new Set(declaredPrefixes(tag));
  const missing: NamespaceDeclaration[] = [];
  for (const [prefix, uri] of scope) {
    if (!declared.has(prefix) && (parent.get(prefix) ?? '') !== uri) missing.push([prefix, uri]);
  }
  // The default namespace is undeclared, as the parent's would otherwise apply.
  if (!declared.has('') && !scope.has('') && (parent.get('') ?? '') !== '') missing.push(['', '']);
  return missing;
}

/** An attribute in the XML namespace. */
function xmlAttribute(localName: string, value: string): AddedAttribute {
  return { name: `xml:${localName}`, localName, prefix: 'xml', namespaceURI: XML_NAMESPACE, value };
}

/** A namespace declaration as an attribute. */
function xmlnsAttribute(prefix: string, uri: string): AddedAttribute {
  if (prefix === '')
    return { name: 'xmlns', localName: 'xmlns', prefix: '', namespaceURI: XMLNS_NAMESPACE, value: uri };
  return { name: `xmlns:${prefix}`, localName: prefix, prefix: 'xmlns', namespaceURI: XMLNS_NAMESPACE, value: uri };
}

/** Whether a start tag's attribute is xml:base. */
function isXmlBase(tag: StreamReader | AsyncStreamReader, index: number): boolean {
  return tag.attributeNamespace(index) === XML_NAMESPACE && tag.attributeLocalName(index) === 'base';
}

/** Whether two xml:lang values name the same language, which ignores case; undefined is the empty value. */
function sameLanguage(lang: string | undefined, otherLang: string | undefined): boolean {
  return (lang ?? '').toLowerCase() === (otherLang ?? '').toLowerCase();
}

/** The numbers from 0 to `count` - 1. */
function indicesBelow(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
