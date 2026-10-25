import { XMLNS_NAMESPACE } from '@exemplarjs/xml/internal';
import { orNull } from '../names.ts';
import type { Element } from './element.ts';
import { elementAbove } from './tree.ts';

/** The namespace a prefix is bound to in an element's scope (DOM Level 3 Appendix B.4). */
export function namespaceOf(element: Element, prefix: string | null): string | null {
  for (let current: Element | null = element; current !== null; current = elementAbove(current)) {
    if (current._namespaceURI !== null && current.prefix === prefix) return current._namespaceURI;
    const uri = declaredNamespace(current, prefix);
    if (uri !== undefined) return uri;
  }
  return null;
}

/** The namespace an element's own attributes declare for a prefix; undefined when they declare none. */
function declaredNamespace(element: Element, prefix: string | null): string | null | undefined {
  for (const attr of element._attributes) {
    if (attr._namespaceURI !== XMLNS_NAMESPACE) continue;
    const declares = prefix === null ? attr._name === 'xmlns' : attr.prefix === 'xmlns' && attr._localName === prefix;
    if (declares) return orNull(attr.value);
  }
  return undefined;
}

/** The prefix bound to a namespace in an element's scope (DOM Level 3 Appendix B.2). */
export function boundPrefix(element: Element, uri: string): string | null {
  const bound = (prefix: string | null) => namespaceOf(element, prefix) === uri;
  for (let current: Element | null = element; current !== null; current = elementAbove(current)) {
    const prefix = current.prefix;
    if (current._namespaceURI === uri && prefix !== null && bound(prefix)) return prefix;
    const declaration = current._attributes.find(
      (attr) => attr.prefix === 'xmlns' && attr.value === uri && bound(attr._localName)
    );
    if (declaration !== undefined) return declaration._localName;
  }
  return null;
}
