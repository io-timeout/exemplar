import type { NamespaceBindings } from './namespaces.ts';

/**
 * The context node, as StAX calls it: the element whose start tag is being written. Its attributes
 * are checked as they come, for duplicates, and its prefixes when the tag closes, since a declaration
 * written after `<p:a` still binds `p`. The arrays are reused from one tag to the next.
 */
export class ContextNode {
  #prefix = '';
  /** The element's URI; undefined when it names none and takes the default namespace its tag ends with. */
  #uri: string | undefined = '';
  /** Each attribute's local name and URI so far, for finding duplicates. */
  readonly #attributeLocalNames: string[] = [];
  readonly #attributeURIs: string[] = [];
  #attributeCount = 0;
  /** Each prefixed attribute's prefix and URI, whose bindings are checked when the tag closes. */
  readonly #attributePrefixes: string[] = [];
  readonly #attributePrefixURIs: string[] = [];

  /** Starts the tag of an element with a prefix and URI. */
  open(prefix: string, uri: string | undefined): void {
    this.#prefix = prefix;
    this.#uri = uri;
    this.#attributeCount = 0;
    if (this.#attributePrefixes.length > 0) {
      this.#attributePrefixes.length = 0;
      this.#attributePrefixURIs.length = 0;
    }
  }

  /** Whether the tag already has an attribute of this expanded name; notes it when it does not. */
  repeatsAttribute(uri: string, localName: string): boolean {
    const count = this.#attributeCount;
    for (let i = 0; i < count; i++) {
      if (this.#attributeLocalNames[i] === localName && this.#attributeURIs[i] === uri) return true;
    }
    this.#attributeLocalNames[count] = localName;
    this.#attributeURIs[count] = uri;
    this.#attributeCount = count + 1;
    return false;
  }

  /** Notes a prefixed attribute, whose prefix the output must bind to its URI by the time the tag closes. */
  notePrefixedAttribute(prefix: string, uri: string): void {
    this.#attributePrefixes.push(prefix);
    this.#attributePrefixURIs.push(uri);
  }

  /** Why the output does not bind a prefix the tag uses to its URI, or undefined when it binds them all. */
  unboundPrefixProblem(bindings: NamespaceBindings): string | undefined {
    const uri = this.#uri;
    if (uri !== undefined && bindings.declaredURIOf(this.#prefix) !== uri) {
      const what = this.#prefix === '' ? 'The default namespace' : `The prefix ${this.#prefix}`;
      return `${what} is not bound to ${uri || 'no namespace'}`;
    }
    for (let i = 0; i < this.#attributePrefixes.length; i++) {
      const prefix = this.#attributePrefixes[i] as string;
      if (prefix !== 'xml' && bindings.declaredURIOf(prefix) !== this.#attributePrefixURIs[i]) {
        return `The prefix ${prefix} is not bound to ${this.#attributePrefixURIs[i]}`;
      }
    }
    return undefined;
  }
}
