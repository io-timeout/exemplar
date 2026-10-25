import { ErrorCode } from '../errors/codes.ts';
import { NamespaceBindings } from '../namespaces/namespaces.ts';
import { NAME_CLASSES, NameClass, isNameStartCharBmp } from '../scan/classes.ts';
import { holdsAt } from '../scan/scanner.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';
import { Char, isHighSurrogate } from '../util/chars.ts';
import { XML_NAMESPACE, XMLNS_NAMESPACE } from '../util/namespaces.ts';
import { fail, isIndex, outOfRange } from './internal.ts';

// Module-level constants, so V8 can inline them.
const { LOWER_X, NON_ASCII } = Char;

/** The lengths of the reserved names, which names are compared with before their text. */
export const XML_LENGTH = 'xml'.length;
export const XMLNS_LENGTH = 'xmlns'.length;
const XMLNS_PREFIX_LENGTH = 'xmlns:'.length;

/**
 * Checks that the name at buffer indexes `[start, end)` is a QName (Namespaces [7]): at most one
 * colon, with an NCName on each side. `colon` and `colonCount` are what the scanner recorded for it.
 */
export function checkQName(tokenizer: Tokenizer, start: number, end: number, colon: number, colonCount: number): void {
  if (colonCount === 0) return;
  const buffer = tokenizer.buffer;
  // eslint-disable-next-line prefer-code-point -- a lead surrogate in a checked name starts a name
  const afterColon = buffer.charCodeAt(colon + 1);
  const startsName =
    afterColon < NON_ASCII
      ? NAME_CLASSES[afterColon] === NameClass.NAME_START_CHAR
      : isNameStartCharBmp(afterColon) || isHighSurrogate(afterColon);
  if (colonCount > 1 || colon === start || colon === end - 1 || !startsName) {
    fail(tokenizer, ErrorCode.NS_QNAME, `${buffer.slice(start, end)} is not a qualified name`, start);
  }
}

/**
 * The namespace scope of each open element. An element's scope is the bindings in force inside it:
 * those of its parent, plus its own `xmlns` declarations, which end with it.
 *
 * The bindings themselves live in `bindings`, a stack. For each open element this class remembers
 * what to restore when it ends (how many bindings there were, and which was the default) and which
 * bindings it declared, for the reader's `namespaceCount()` and `namespacePrefix(i)`. It also
 * resolves the prefixes of element and attribute names to their bindings.
 */
export class NamespaceScopes {
  readonly bindings = new NamespaceBindings();
  /** The bindings the open elements declared, as binding indexes, innermost element's last. */
  readonly declarations: number[] = [];
  /** How many entries of `declarations` are current. */
  declarationCount = 0;
  /** For each open element, by depth: where its own declarations start in `declarations`. */
  readonly declarationsAt: number[] = [];
  /** For each open element, by depth: how many bindings there were before it declared any. */
  readonly #bindingCountBefore: number[] = [];
  /** For each open element, by depth: the default namespace's binding before it declared any. */
  readonly #defaultBefore: number[] = [];
  /** For each open element, by depth: the binding its own prefix resolved to. */
  readonly elementBindings: number[] = [];
  /** The scope from before the last element was left, for a call that then fails to put back: its declaration count. */
  #previousDeclarationCount = 0;
  /** Its binding count. */
  #previousBindingCount = 0;
  /** Its default namespace's binding. */
  #previousDefault = 0;

  /** Records a declaration of the element being read, by its binding index. */
  recordDeclaration(binding: number): void {
    this.declarations[this.declarationCount++] = binding;
  }

  /** Opens the scope of the element at depth `elementDepth`, which has declared nothing yet. */
  openScope(elementDepth: number): void {
    this.declarationsAt[elementDepth] = this.declarationCount;
  }

  /** Notes the bindings in force before the element at depth `elementDepth` declares namespaces, to restore when it ends. */
  markBindings(elementDepth: number): void {
    this.#bindingCountBefore[elementDepth] = this.bindings.count;
    this.#defaultBefore[elementDepth] = this.bindings.defaultIndex;
  }

  /** Applies the namespace declaration that is attribute `attributeIndex` of `tokenizer`'s start tag; `normalized` is its value when it needs normalizing. */
  declareFromAttribute(tokenizer: Tokenizer, attributeIndex: number, normalized: string | undefined): void {
    const nameStart = tokenizer.attributeNameStart[attributeIndex] as number;
    const end = tokenizer.attributeNameEnd[attributeIndex] as number;
    const prefixed = end - nameStart !== XMLNS_LENGTH;
    if (prefixed)
      checkQName(
        tokenizer,
        nameStart,
        end,
        tokenizer.attributeFirstColon[attributeIndex] as number,
        tokenizer.attributeColonCount[attributeIndex] as number
      );
    const prefixStart = prefixed ? nameStart + XMLNS_PREFIX_LENGTH : end;
    this.#checkDeclaration(tokenizer, attributeIndex, prefixStart, normalized);
    const bufferOffset = tokenizer.bufferOffset;
    const valueStart = bufferOffset + (tokenizer.attributeValueStart[attributeIndex] as number);
    const valueEnd = bufferOffset + (tokenizer.attributeValueEnd[attributeIndex] as number);
    const binding = this.bindings.bind(
      bufferOffset + prefixStart,
      bufferOffset + end,
      valueStart,
      valueEnd,
      normalized
    );
    if (!prefixed) this.bindings.defaultIndex = binding;
    this.recordDeclaration(binding);
  }

  /** Checks a namespace declaration against the reserved prefixes and namespaces (Namespaces §3). */
  #checkDeclaration(
    tokenizer: Tokenizer,
    attributeIndex: number,
    prefixStart: number,
    normalized: string | undefined
  ): void {
    const at = tokenizer.attributeNameStart[attributeIndex] as number;
    const length = (tokenizer.attributeNameEnd[attributeIndex] as number) - prefixStart;
    // Only a prefix that starts with x can be reserved.
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const startsWithX = tokenizer.buffer.charCodeAt(prefixStart) === LOWER_X;
    if (startsWithX && length === XMLNS_LENGTH && holdsAt(tokenizer.buffer, prefixStart, 'xmlns')) {
      fail(tokenizer, ErrorCode.NS_RESERVED, 'The prefix xmlns must not be declared', at);
    }
    const xml = startsWithX && length === XML_LENGTH && holdsAt(tokenizer.buffer, prefixStart, 'xml');
    if (xml !== attributeValueIs(tokenizer, attributeIndex, normalized, XML_NAMESPACE)) {
      fail(
        tokenizer,
        ErrorCode.NS_RESERVED,
        'Only the prefix xml may be bound to the XML namespace, and only to it',
        at
      );
    }
    if (attributeValueIs(tokenizer, attributeIndex, normalized, XMLNS_NAMESPACE)) {
      fail(tokenizer, ErrorCode.NS_RESERVED, 'No prefix may be bound to the xmlns namespace', at);
    }
    if (length > 0 && !tokenizer.version11 && attributeValueIs(tokenizer, attributeIndex, normalized, '')) {
      fail(tokenizer, ErrorCode.NS_UNDECLARED_PREFIX, 'Namespaces in XML 1.0 do not allow undeclaring a prefix', at);
    }
  }

  /** Checks the name of `tokenizer`'s start tag as a QName and records the binding its prefix resolves to, for depth `elementDepth`. */
  bindElement(tokenizer: Tokenizer, elementDepth: number): void {
    checkQName(tokenizer, tokenizer.nameStart, tokenizer.nameEnd, tokenizer.nameFirstColon, tokenizer.nameColonCount);
    if (tokenizer.nameFirstColon < 0) {
      this.elementBindings[elementDepth] = this.bindings.defaultIndex;
      return;
    }
    if (
      tokenizer.nameFirstColon - tokenizer.nameStart === XMLNS_LENGTH &&
      holdsAt(tokenizer.buffer, tokenizer.nameStart, 'xmlns')
    ) {
      fail(tokenizer, ErrorCode.NS_RESERVED, 'An element must not have the prefix xmlns', tokenizer.nameStart);
    }
    this.elementBindings[elementDepth] = this.resolvePrefix(tokenizer, tokenizer.nameStart, tokenizer.nameFirstColon);
  }

  /** The binding of the prefix at buffer indexes `[start, end)`; throws NS_UNBOUND_PREFIX if it isn't bound. */
  resolvePrefix(tokenizer: Tokenizer, start: number, end: number): number {
    const binding = this.bindings.findBinding(tokenizer.buffer, tokenizer.bufferOffset, start, end);
    if (binding < 0 || this.bindings.isEmpty(binding)) {
      fail(
        tokenizer,
        ErrorCode.NS_UNBOUND_PREFIX,
        `The prefix ${tokenizer.buffer.slice(start, end)} is not bound`,
        start
      );
    }
    return binding;
  }

  /** How many namespaces the innermost open element, at depth `elementDepth`, declares; 0 for -1, no element. */
  declaredCount(elementDepth: number): number {
    return elementDepth < 0 ? 0 : this.declarationCount - (this.declarationsAt[elementDepth] as number);
  }

  /** The prefix the element at depth `elementDepth` binds in its declaration `declarationIndex`; `''` for the default namespace. */
  declaredPrefix(elementDepth: number, declarationIndex: number, tokenizer: Tokenizer): string {
    const binding = this.#bindingOfDeclaration(elementDepth, declarationIndex);
    return this.bindings.prefix(binding, tokenizer.buffer, tokenizer.bufferOffset);
  }

  /** The namespace URI the element at depth `elementDepth` binds in its declaration `declarationIndex`. */
  declaredUri(elementDepth: number, declarationIndex: number, tokenizer: Tokenizer): string {
    const binding = this.#bindingOfDeclaration(elementDepth, declarationIndex);
    return this.bindings.uri(binding, tokenizer.buffer, tokenizer.bufferOffset);
  }

  /** The binding of an element's declaration `declarationIndex`; throws a RangeError unless that is below its declaration count. */
  #bindingOfDeclaration(elementDepth: number, declarationIndex: number): number {
    if (!isIndex(declarationIndex) || declarationIndex >= this.declaredCount(elementDepth)) {
      return outOfRange('Namespace', declarationIndex);
    }
    return this.declarations[(this.declarationsAt[elementDepth] as number) + declarationIndex] as number;
  }

  /** The namespace URI of the open element at depth `elementDepth`: its prefix's binding, or the default namespace. */
  elementUri(elementDepth: number, prefixed: boolean, tokenizer: Tokenizer): string {
    // An unprefixed element's binding is the default namespace, unchanged until it ends.
    const binding = prefixed ? (this.elementBindings[elementDepth] as number) : this.bindings.defaultIndex;
    return this.bindings.uri(binding, tokenizer.buffer, tokenizer.bufferOffset);
  }

  /** Closes the scope of the element at depth `elementDepth`, which has ended, keeping it for `reenter`. */
  leave(elementDepth: number): void {
    this.#previousDeclarationCount = this.declarationCount;
    if (this.declarationCount === this.declarationsAt[elementDepth]) return;
    this.#previousBindingCount = this.bindings.count;
    this.#previousDefault = this.bindings.defaultIndex;
    this.bindings.count = this.#bindingCountBefore[elementDepth] as number;
    this.bindings.defaultIndex = this.#defaultBefore[elementDepth] as number;
    this.declarationCount = this.declarationsAt[elementDepth] as number;
  }

  /** Puts back the scope of the element at depth `elementDepth`, which a call that then failed had left. */
  reenter(elementDepth: number): void {
    if (this.#previousDeclarationCount === this.declarationsAt[elementDepth]) return;
    this.bindings.count = this.#previousBindingCount;
    this.bindings.defaultIndex = this.#previousDefault;
    this.declarationCount = this.#previousDeclarationCount;
  }

  /** Slices the bindings whose text starts before document offset `offset`, which `tokenizer` is about to drop. */
  sliceBeforeDrop(tokenizer: Tokenizer, offset: number): void {
    this.bindings.sliceBeforeDrop(tokenizer.buffer, tokenizer.bufferOffset, offset);
  }
}

/** Whether attribute `attributeIndex`'s value, or its normalized form when it has one, is `uri`. */
function attributeValueIs(
  tokenizer: Tokenizer,
  attributeIndex: number,
  normalized: string | undefined,
  uri: string
): boolean {
  if (normalized !== undefined) return normalized === uri;
  const start = tokenizer.attributeValueStart[attributeIndex] as number;
  return (
    (tokenizer.attributeValueEnd[attributeIndex] as number) - start === uri.length &&
    holdsAt(tokenizer.buffer, start, uri)
  );
}
