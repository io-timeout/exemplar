import type { AttributeType } from '../dtd/declarations.ts';
import { ErrorCode } from '../errors/codes.ts';
import type { NamespaceBindings } from '../namespaces/namespaces.ts';
import { isNcName } from '../util/names.ts';
import { XMLNS_NAMESPACE, reservedBindingProblem } from '../util/namespaces.ts';

/** How the namespace checks of a start tag report a fatal error. */
export type Fail = (code: ErrorCode, message: string) => never;

/**
 * A start tag's attributes as strings, with those the DTD defaults added after them. The reader
 * uses it for an element the DTD declares attributes for, or whose values refer to entities, and
 * reads straight from the buffer otherwise (see `AttributeCollector`).
 *
 * The attributes are kept in parallel arrays, one entry per attribute, so the list can be reused
 * for every start tag without allocating. Only the first `count` entries are current.
 */
export class AttributeList {
  /** Each attribute's qualified name, as written. */
  readonly names: string[] = [];
  /** Each attribute's value, normalized for its type. */
  readonly values: string[] = [];
  /** Each attribute's type, as the DTD declares it; CDATA when it doesn't. */
  readonly types: AttributeType[] = [];
  /** Whether each attribute was in the start tag rather than defaulted from the DTD. */
  readonly isSpecified: boolean[] = [];
  /** Whether normalizing for the declared type changed the value, which the standalone validity constraint asks about. */
  readonly changedByNormalizing: boolean[] = [];
  /** Each attribute's prefix, `''` for none; set by `resolveNamespaces`. */
  readonly prefixes: string[] = [];
  /** Each attribute's local name; set by `resolveNamespaces`. */
  readonly localNames: string[] = [];
  /** Each attribute's namespace URI, `''` for none; set by `resolveNamespaces`. */
  readonly uris: string[] = [];
  /** The indexes of the attributes the accessors report: all but `xmlns` declarations unless `namespacePrefixes` is on. */
  readonly visible: number[] = [];
  /** How many attributes the list holds now. */
  count = 0;
  /** How many of them the accessors report. */
  visibleCount = 0;

  /** Empties the list for the next start tag. */
  clear(): void {
    this.count = 0;
    this.visibleCount = 0;
  }

  /** Adds one attribute, with no namespace yet. */
  add(name: string, value: string, type: AttributeType, isSpecified: boolean, changedByNormalizing = false): void {
    const i = this.count++;
    this.names[i] = name;
    this.values[i] = value;
    this.changedByNormalizing[i] = changedByNormalizing;
    this.types[i] = type;
    this.isSpecified[i] = isSpecified;
    this.prefixes[i] = '';
    this.localNames[i] = name;
    this.uris[i] = '';
  }

  /** Whether the attribute at `attributeIndex` declares a namespace: `xmlns` or `xmlns:p`. */
  isDeclaration(attributeIndex: number): boolean {
    const name = this.names[attributeIndex] as string;
    return name === 'xmlns' || name.startsWith('xmlns:');
  }

  /** Lists every attribute as visible, for a reader that is not namespace-aware. */
  showAll(): void {
    for (let i = 0; i < this.count; i++) this.visible[i] = i;
    this.visibleCount = this.count;
  }

  /** Applies the namespace declarations among the attributes, calling `onBinding` with each new binding's index. */
  declareNamespaces(
    bindings: NamespaceBindings,
    version11: boolean,
    onBinding: (binding: number) => void,
    fail: Fail
  ): void {
    for (let i = 0; i < this.count; i++) {
      if (!this.isDeclaration(i)) continue;
      const name = this.names[i] as string;
      const prefix = name === 'xmlns' ? '' : name.slice('xmlns:'.length);
      if (name !== 'xmlns' && !isNcName(prefix)) fail(ErrorCode.NS_QNAME, `${name} is not a qualified name`);
      checkDeclaration(prefix, this.values[i] as string, version11, fail);
      this.prefixes[i] = prefix === '' ? '' : 'xmlns';
      this.localNames[i] = prefix === '' ? 'xmlns' : prefix;
      this.uris[i] = XMLNS_NAMESPACE;
      const binding = bindings.bindStrings(prefix, this.values[i] as string);
      if (prefix === '') bindings.defaultIndex = binding;
      onBinding(binding);
    }
  }

  /**
   * Resolves the prefixes of the attributes that aren't declarations, checks their expanded names are
   * unique, and lists the ones to report. `buffer` and `bufferOffset` are the tokenizer's, for bindings
   * still kept as offsets.
   */
  resolveNamespaces(
    bindings: NamespaceBindings,
    buffer: string,
    bufferOffset: number,
    showDeclarations: boolean,
    fail: Fail
  ): void {
    const seen = new Set<string>();
    let visibleCount = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.isDeclaration(i)) {
        if (showDeclarations) this.visible[visibleCount++] = i;
        continue;
      }
      this.#resolvePrefixOf(i, bindings, buffer, bufferOffset, fail);
      const key = `${this.uris[i]}\u0000${this.localNames[i]}`;
      if (seen.has(key))
        fail(ErrorCode.NS_DUPLICATE_ATTRIBUTE, `Attribute ${this.localNames[i]} appears twice in one namespace`);
      seen.add(key);
      this.visible[visibleCount++] = i;
    }
    this.visibleCount = visibleCount;
  }

  /** Splits one attribute's name into prefix and local name, and resolves the prefix to its namespace. */
  #resolvePrefixOf(
    attributeIndex: number,
    bindings: NamespaceBindings,
    buffer: string,
    bufferOffset: number,
    fail: Fail
  ): void {
    const name = this.names[attributeIndex] as string;
    const colon = name.indexOf(':');
    if (colon === -1) return;
    const prefix = name.slice(0, colon);
    const local = name.slice(colon + 1);
    if (prefix === '' || !isNcName(local)) fail(ErrorCode.NS_QNAME, `${name} is not a qualified name`);
    const binding = bindings.findBindingOf(prefix, buffer, bufferOffset);
    if (binding < 0 || bindings.isEmpty(binding))
      fail(ErrorCode.NS_UNBOUND_PREFIX, `The prefix ${prefix} is not bound`);
    this.prefixes[attributeIndex] = prefix;
    this.localNames[attributeIndex] = local;
    this.uris[attributeIndex] = bindings.uri(binding, buffer, bufferOffset);
  }
}

/** Checks a namespace declaration against the reserved prefixes and namespaces (Namespaces §3). */
function checkDeclaration(prefix: string, uri: string, version11: boolean, fail: Fail): void {
  const problem = reservedBindingProblem(prefix, uri);
  if (problem !== undefined) fail(ErrorCode.NS_RESERVED, problem);
  if (prefix !== '' && uri === '' && !version11) {
    fail(ErrorCode.NS_UNDECLARED_PREFIX, 'Namespaces in XML 1.0 do not allow undeclaring a prefix');
  }
}
