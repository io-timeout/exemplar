import { XMLNS_NAMESPACE, XML_NAMESPACE } from '@exemplarjs/xml/internal';

/**
 * The namespace bindings in scope while writing: those declared in the output, and those set for
 * look-ups only, as StAX's `setPrefix` sets them. A writer checks names against the declared ones,
 * since only they bind anything in the output, and finds prefixes for URIs among both.
 */
export class NamespaceBindings {
  // Innermost last: each binding's prefix and URI, and whether its declaration was written.
  readonly #prefixes: string[] = ['xml', 'xmlns'];
  readonly #uris: string[] = [XML_NAMESPACE, XMLNS_NAMESPACE];
  readonly #isDeclared: boolean[] = [true, true];
  /** Where each open element's bindings begin. */
  readonly #elementStarts: number[] = [];
  /** How many `nsN` prefixes have been made. */
  #generatedCount = 0;

  /** Starts the bindings of an element. */
  enter(): void {
    this.#elementStarts.push(this.#prefixes.length);
  }

  /** Forgets the bindings of the innermost element. */
  leave(): void {
    const start = this.#elementStarts.pop() as number;
    if (this.#prefixes.length > start) {
      this.#prefixes.length = start;
      this.#uris.length = start;
      this.#isDeclared.length = start;
    }
  }

  /** Binds a prefix whose declaration is written in the output. */
  declare(prefix: string, uri: string): void {
    this.#bind(prefix, uri, true);
  }

  /** Binds a prefix for look-ups only, without a declaration. */
  setForLookups(prefix: string, uri: string): void {
    this.#bind(prefix, uri, false);
  }

  #bind(prefix: string, uri: string, isDeclared: boolean): void {
    this.#prefixes.push(prefix);
    this.#uris.push(uri);
    this.#isDeclared.push(isDeclared);
  }

  /** The URI the innermost element's start tag declares a prefix for; undefined when it does not, or no element is open. */
  declaredOnTag(prefix: string): string | undefined {
    const start = this.#elementStarts.at(-1);
    if (start === undefined) return undefined;
    const index = this.#findDeclared(prefix, start);
    return index === -1 ? undefined : this.#uris[index];
  }

  /** The URI a prefix is bound to in the output, or undefined; the empty prefix is bound to no namespace at first. */
  declaredURIOf(prefix: string): string | undefined {
    const index = this.#findDeclared(prefix, 0);
    if (index !== -1) return this.#uris[index];
    return prefix === '' ? '' : undefined;
  }

  /** The URI a prefix is bound to, declared or set, or undefined. */
  uriOf(prefix: string): string | undefined {
    const index = this.#prefixes.lastIndexOf(prefix);
    return index === -1 ? undefined : this.#uris[index];
  }

  /** Where the innermost declared binding of a prefix is, at `from` or after; -1 for none. */
  #findDeclared(prefix: string, from: number): number {
    for (let index = this.#prefixes.length - 1; index >= from; index--) {
      if (this.#prefixes[index] === prefix && this.#isDeclared[index] === true) return index;
    }
    return -1;
  }

  /** The prefix bound to a URI, declared or set, that no later binding hides, or undefined. */
  prefixOf(uri: string): string | undefined {
    for (let index = this.#prefixes.length - 1; index >= 0; index--) {
      const prefix = this.#prefixes[index] as string;
      if (this.#uris[index] === uri && this.uriOf(prefix) === uri) return prefix;
    }
    return undefined;
  }

  /** A prefix of the form `nsN` that nothing binds yet. */
  newPrefix(): string {
    let prefix: string;
    do prefix = `ns${++this.#generatedCount}`;
    while (this.uriOf(prefix) !== undefined);
    return prefix;
  }
}
