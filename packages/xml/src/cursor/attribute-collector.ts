import type { ResolvedOptions } from '../config/options.ts';
import type { AttributeDeclaration, AttributeType } from '../dtd/declarations.ts';
import { normalizeTokens } from '../entities/attribute-value.ts';
import { ErrorCode } from '../errors/codes.ts';
import { ScanFlag, holdsAt, sameSpan } from '../scan/scanner.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';
import { isNcName } from '../util/names.ts';
import { XMLNS_NAMESPACE } from '../util/namespaces.ts';
import { normalizeAttributeValue } from '../util/normalize.ts';
import { AttributeList } from './attributes.ts';
import { fail, outOfRange } from './internal.ts';
import { type NamespaceScopes, XML_LENGTH, XMLNS_LENGTH, checkQName } from './namespace-scopes.ts';

/** Up to this many attributes, duplicates are found by comparing each pair rather than with a set. */
const PAIRWISE_ATTRIBUTES = 16;

/** The ScanFlag bits that mean an attribute value needs normalizing: references, and whitespace or NEL to turn into spaces. */
const VALUE_FLAGS = ScanFlag.REFERENCE | ScanFlag.WHITESPACE | ScanFlag.NEL;
/** A module-level copy, so V8 can inline it. */
const ENTITY_FLAG = ScanFlag.ENTITY;

/** What an attribute is to namespaces; the values are bits, so the kinds a start tag holds can be or-ed together. */
const AttributeKind = { PLAIN: 0, DECLARATION: 1, PREFIXED: 2, XMLID: 4 } as const;

/** Reports a recoverable error at an index in the tokenizer's buffer. */
type Report = (code: ErrorCode, message: string, index: number) => void;

/**
 * Reads the current start tag's attributes: checks them, applies their namespace declarations, and
 * answers the reader's attribute accessors.
 *
 * Usually an attribute is read straight from the tokenizer's buffer, as offsets, and sliced only
 * when asked for. When the DTD declares attributes for the element, a value refers to an entity,
 * or a validator reads the document, the attributes are instead listed as strings in an
 * `AttributeList`, with the DTD's defaults and types added; `listed` says which.
 *
 * Two numberings appear. A tag index counts the attributes as the start tag writes them, followed
 * by any defaults. The reader's callers count only the attributes they are shown: `xmlns`
 * declarations are hidden unless `namespacePrefixes` is on. `tagIndexOf` turns the second into the first.
 */
export class AttributeCollector {
  readonly #options: ResolvedOptions;
  readonly #scopes: NamespaceScopes;
  readonly #report: Report;
  /** Expands the entity references in the value of the attribute at a tag index; the entity expander does it, with the DTD's declarations. */
  readonly #expandValue: (tagIndex: number) => string;
  /** Whether the attributes are listed as strings, with the DTD's defaults, rather than read from the buffer. */
  listed = false;
  #attributeList: AttributeList | undefined;
  /** For attributes read from the buffer, by tag index: what each is to namespaces, an AttributeKind. */
  readonly #kinds: number[] = [];
  /** The namespace binding each prefixed attribute's prefix resolves to, by tag index. */
  readonly #bindings: number[] = [];
  /** The tag indexes of the attributes the accessors report when `xmlns` declarations are hidden. */
  readonly #visible: number[] = [];
  #visibleCount = 0;
  /** Whether the accessors leave out the start tag's `xmlns` declarations. */
  #declarationsHidden = false;
  /** The tag index of the checked `xml:id` attribute, or -1. */
  #xmlIdTagIndex = -1;
  /** Its normalized value. */
  #xmlIdValue = '';
  /** The tag index of the `xml:id` attribute classifying found, before it is checked. */
  #xmlIdCandidate = -1;
  /** The ID values seen so far, each with whether an `xml:id` held it; xml:id must not repeat any of them. */
  #ids: Map<string, boolean> | undefined;

  constructor(options: ResolvedOptions, scopes: NamespaceScopes, report: Report, expand: (tagIndex: number) => string) {
    this.#options = options;
    this.#scopes = scopes;
    this.#report = report;
    this.#expandValue = expand;
  }

  /** The attributes as strings, made when first needed. */
  get list(): AttributeList {
    this.#attributeList ??= new AttributeList();
    return this.#attributeList;
  }

  /**
   * Reads the attributes of the start tag `tokenizer` holds, the element at depth `elementDepth`.
   * `listed` asks for them as strings; `declared` holds the DTD's attribute declarations for the element.
   */
  read(
    tokenizer: Tokenizer,
    elementDepth: number,
    listed: boolean,
    declared: ReadonlyMap<string, AttributeDeclaration> | undefined
  ): void {
    this.#declarationsHidden = false;
    this.listed = listed;
    this.#xmlIdTagIndex = -1;
    // Kept small enough to inline: most start tags have no attributes and no prefix, and need nothing more.
    if (listed || tokenizer.attributeCount !== 0 || tokenizer.nameFirstColon >= 0)
      this.#readAll(tokenizer, elementDepth, listed, declared);
  }

  /** Checks, lists or classifies the attributes, and processes the namespaces of the element's name and attributes. */
  #readAll(
    tokenizer: Tokenizer,
    elementDepth: number,
    listed: boolean,
    declared: ReadonlyMap<string, AttributeDeclaration> | undefined
  ): void {
    const options = this.#options;
    if (options.checkWellFormedness && tokenizer.attributeCount > 1) checkDuplicates(tokenizer);
    if (listed) this.#listAll(tokenizer, elementDepth, declared);
    else if (options.namespaceAware) this.#resolveNamespaces(tokenizer, elementDepth);
  }

  /** Sorts the attributes into plain, prefixed and namespace declarations, listing the others; returns the kinds present. */
  #classify(tokenizer: Tokenizer): number {
    const buffer = tokenizer.buffer;
    let present = 0;
    let visibleCount = 0;
    for (let i = 0; i < tokenizer.attributeCount; i++) {
      const start = tokenizer.attributeNameStart[i] as number;
      const colon = tokenizer.attributeFirstColon[i] as number;
      let kind =
        colon < 0
          ? plainKind(buffer, start, tokenizer.attributeNameEnd[i] as number)
          : prefixedKind(buffer, start, colon);
      present |= kind;
      if (kind === (AttributeKind.PREFIXED | AttributeKind.XMLID)) {
        this.#xmlIdCandidate = i;
        kind = AttributeKind.PREFIXED;
      }
      this.#kinds[i] = kind;
      if (kind !== AttributeKind.DECLARATION) this.#visible[visibleCount++] = i;
    }
    this.#visibleCount = visibleCount;
    return present;
  }

  /** Declares, resolves and checks the namespaces of the start tag at depth `elementDepth`, and finds its xml:id. */
  #resolveNamespaces(tokenizer: Tokenizer, elementDepth: number): void {
    const scopes = this.#scopes;
    const present = this.#classify(tokenizer);
    const declarations = (present & AttributeKind.DECLARATION) !== 0;
    if (declarations) {
      scopes.markBindings(elementDepth);
      this.#declareAll(tokenizer);
    }
    if (tokenizer.nameFirstColon >= 0) scopes.bindElement(tokenizer, elementDepth);
    if ((present & AttributeKind.PREFIXED) !== 0) this.#resolveAttributes(tokenizer);
    this.#declarationsHidden = declarations && !this.#options.namespacePrefixes;
    if ((present & AttributeKind.XMLID) !== 0) this.#checkSpanXmlId(tokenizer);
  }

  /** Applies the start tag's `xmlns` declarations, binding their prefixes. */
  #declareAll(tokenizer: Tokenizer): void {
    for (let i = 0; i < tokenizer.attributeCount; i++) {
      if (this.#kinds[i] !== AttributeKind.DECLARATION) continue;
      const normalized =
        ((tokenizer.attributeFlags[i] as number) & VALUE_FLAGS) === 0 ? undefined : spanValue(tokenizer, i);
      this.#scopes.declareFromAttribute(tokenizer, i, normalized);
    }
  }

  /** Normalizes and checks the xml:id of a start tag read from spans, and keeps its value for the accessors. */
  #checkSpanXmlId(tokenizer: Tokenizer): void {
    const i = this.#xmlIdCandidate;
    this.#xmlIdValue = this.#checkXmlId(tokenizer, normalizeTokens(spanValue(tokenizer, i)), undefined);
    this.#xmlIdTagIndex = i;
  }

  /** Resolves the prefixed attributes, then checks that their expanded names are unique. */
  #resolveAttributes(tokenizer: Tokenizer): void {
    const count = tokenizer.attributeCount;
    for (let i = 0; i < count; i++) {
      if (this.#kinds[i] !== AttributeKind.PREFIXED) continue;
      const start = tokenizer.attributeNameStart[i] as number;
      const colon = tokenizer.attributeFirstColon[i] as number;
      checkQName(
        tokenizer,
        start,
        tokenizer.attributeNameEnd[i] as number,
        colon,
        tokenizer.attributeColonCount[i] as number
      );
      this.#bindings[i] = this.#scopes.resolvePrefix(tokenizer, start, colon);
    }
    if (count > 1) this.#checkExpandedDuplicates(tokenizer);
  }

  /** Whether the attributes at tag indexes `first` and `second` have the same namespace URI and local name. */
  #sameExpanded(tokenizer: Tokenizer, first: number, second: number): boolean {
    const firstStart = localStart(tokenizer, first);
    const secondStart = localStart(tokenizer, second);
    const length = (tokenizer.attributeNameEnd[first] as number) - firstStart;
    if (length !== (tokenizer.attributeNameEnd[second] as number) - secondStart) return false;
    return this.#sameUri(tokenizer, first, second) && sameSpan(tokenizer.buffer, firstStart, secondStart, length);
  }

  /** Whether two attributes that are not declarations are in the same namespace. */
  #sameUri(tokenizer: Tokenizer, first: number, second: number): boolean {
    const firstBinding = this.#kinds[first] === AttributeKind.PREFIXED ? (this.#bindings[first] as number) : -1;
    const secondBinding = this.#kinds[second] === AttributeKind.PREFIXED ? (this.#bindings[second] as number) : -1;
    return (
      firstBinding === secondBinding ||
      (firstBinding >= 0 && secondBinding >= 0 && this.#uriOf(tokenizer, first) === this.#uriOf(tokenizer, second))
    );
  }

  /** Checks that no two attributes share an expanded name (NSC: Attributes Unique). */
  #checkExpandedDuplicates(tokenizer: Tokenizer): void {
    const count = tokenizer.attributeCount;
    if (count > PAIRWISE_ATTRIBUTES) {
      this.#checkExpandedDuplicatesByHash(tokenizer);
      return;
    }
    for (let i = 1; i < count; i++) {
      if (this.#kinds[i] === AttributeKind.DECLARATION) continue;
      for (let j = 0; j < i; j++) {
        if (this.#kinds[j] !== AttributeKind.DECLARATION && this.#sameExpanded(tokenizer, i, j))
          this.#failExpandedDuplicate(tokenizer, i);
      }
    }
  }

  /** Checks a long start tag for attributes that share an expanded name, by hash. */
  #checkExpandedDuplicatesByHash(tokenizer: Tokenizer): void {
    const seen = new Set<string>();
    for (let i = 0; i < tokenizer.attributeCount; i++) {
      if (this.#kinds[i] === AttributeKind.DECLARATION) continue;
      const key = `${this.#uriOf(tokenizer, i)}\u0000${this.#localOf(tokenizer, i)}`;
      if (seen.has(key)) this.#failExpandedDuplicate(tokenizer, i);
      seen.add(key);
    }
  }

  /** Throws NS_DUPLICATE_ATTRIBUTE for the attribute at tag index `i`. */
  #failExpandedDuplicate(tokenizer: Tokenizer, i: number): never {
    return fail(
      tokenizer,
      ErrorCode.NS_DUPLICATE_ATTRIBUTE,
      `Attribute ${this.#localOf(tokenizer, i)} appears twice in one namespace`,
      tokenizer.attributeNameStart[i]
    );
  }

  /** Lists the start tag's attributes as strings, with the DTD's defaults and types, then processes their namespaces. */
  #listAll(
    tokenizer: Tokenizer,
    elementDepth: number,
    declared: ReadonlyMap<string, AttributeDeclaration> | undefined
  ): void {
    const list = this.list;
    list.clear();
    for (let i = 0; i < tokenizer.attributeCount; i++) {
      const name = nameOf(tokenizer, i);
      const value =
        ((tokenizer.attributeFlags[i] as number) & ENTITY_FLAG) === 0 ? spanValue(tokenizer, i) : this.#expandValue(i);
      const type: AttributeType = declared?.get(name)?.type ?? 'CDATA';
      const normalized = type === 'CDATA' ? value : normalizeTokens(value);
      list.add(name, normalized, type, true, normalized !== value);
      if (type === 'ID' && name !== 'xml:id') this.#noteId(tokenizer, normalized, false);
    }
    if (declared) this.#addDefaultAttributes(declared);
    if (this.#options.namespaceAware && (declared?.has('xml:id') === true || list.names.includes('xml:id'))) {
      this.#readXmlId(tokenizer, declared);
    }
    if (!this.#options.namespaceAware) {
      list.showAll();
      return;
    }
    const scopes = this.#scopes;
    scopes.markBindings(elementDepth);
    const listFail = (code: ErrorCode, message: string): never => fail(tokenizer, code, message);
    list.declareNamespaces(
      scopes.bindings,
      tokenizer.version11,
      (binding) => scopes.recordDeclaration(binding),
      listFail
    );
    scopes.bindElement(tokenizer, elementDepth);
    list.resolveNamespaces(
      scopes.bindings,
      tokenizer.buffer,
      tokenizer.bufferOffset,
      this.#options.namespacePrefixes,
      listFail
    );
  }

  /** Makes the `xml:id` attribute an ID, normalized as one, and reports what breaks the xml:id rules (xml:id §4). */
  #readXmlId(tokenizer: Tokenizer, declared: ReadonlyMap<string, AttributeDeclaration> | undefined): void {
    const list = this.list;
    const xmlIdIndex = list.names.indexOf('xml:id');
    if (xmlIdIndex === -1 || xmlIdIndex >= list.count) return;
    list.values[xmlIdIndex] = this.#checkXmlId(
      tokenizer,
      normalizeTokens(list.values[xmlIdIndex] as string),
      declared?.get('xml:id')?.type
    );
    list.types[xmlIdIndex] = 'ID';
  }

  /** Reports what an xml:id value breaks: its declared type, its form, its uniqueness; returns the value. */
  #checkXmlId(tokenizer: Tokenizer, value: string, declaredType: AttributeType | undefined): string {
    if (declaredType !== undefined && declaredType !== 'ID') {
      this.#report(ErrorCode.XMLID_TYPE, `xml:id is declared as ${declaredType}, not ID`, tokenizer.nameStart);
    }
    if (!isNcName(value))
      this.#report(ErrorCode.XMLID_NAME, `The xml:id ${value} is not an NCName`, tokenizer.nameStart);
    this.#noteId(tokenizer, value, true);
    return value;
  }

  /** Records an ID value, reporting it when it repeats one and an xml:id holds either. */
  #noteId(tokenizer: Tokenizer, value: string, xmlId: boolean): void {
    this.#ids ??= new Map();
    const earlier = this.#ids.get(value);
    if (earlier !== undefined && (xmlId || earlier)) {
      this.#report(ErrorCode.XMLID_DUPLICATE, `The ID ${value} is used twice`, tokenizer.nameStart);
    }
    this.#ids.set(value, xmlId || earlier === true);
  }

  /** Adds the attributes the DTD defaults that the start tag leaves out. */
  #addDefaultAttributes(declared: ReadonlyMap<string, AttributeDeclaration>): void {
    const list = this.list;
    const given = new Set(list.names.slice(0, list.count));
    for (const declaration of declared.values()) {
      if (declaration.value !== undefined && !given.has(declaration.name)) {
        list.add(declaration.name, declaration.value, declaration.type, false);
      }
    }
  }

  /** How many attributes the accessors report: all but `xmlns` attributes, unless `namespacePrefixes` is on. */
  count(tokenizer: Tokenizer): number {
    if (this.listed) return this.list.visibleCount;
    return this.#declarationsHidden ? this.#visibleCount : tokenizer.attributeCount;
  }

  /** The tag index of the attribute the accessors number `attributeIndex`; throws a RangeError unless `attributeIndex` is below count(). */
  tagIndexOf(tokenizer: Tokenizer, attributeIndex: number): number {
    if (this.listed) {
      const list = this.list;
      return attributeIndex < list.visibleCount
        ? (list.visible[attributeIndex] as number)
        : outOfRange('Attribute', attributeIndex);
    }
    if (!this.#declarationsHidden)
      return attributeIndex < tokenizer.attributeCount ? attributeIndex : outOfRange('Attribute', attributeIndex);
    return attributeIndex < this.#visibleCount
      ? (this.#visible[attributeIndex] as number)
      : outOfRange('Attribute', attributeIndex);
  }

  /** The qualified name of the attribute at a tag index. */
  name(tokenizer: Tokenizer, tagIndex: number): string {
    return this.listed ? (this.list.names[tagIndex] as string) : nameOf(tokenizer, tagIndex);
  }

  /** The local name of the attribute at a tag index. */
  localName(tokenizer: Tokenizer, tagIndex: number): string {
    if (!this.listed) return this.#localOf(tokenizer, tagIndex);
    const list = this.list;
    return (this.#options.namespaceAware ? list.localNames[tagIndex] : list.names[tagIndex]) as string;
  }

  /** The prefix of the attribute at a tag index, or the empty string. */
  prefix(tokenizer: Tokenizer, tagIndex: number): string {
    if (!this.#options.namespaceAware) return '';
    if (this.listed) return this.list.prefixes[tagIndex] as string;
    const colon = tokenizer.attributeFirstColon[tagIndex] as number;
    return colon < 0 ? '' : tokenizer.buffer.slice(tokenizer.attributeNameStart[tagIndex], colon);
  }

  /** The namespace URI of the attribute at a tag index, or the empty string. */
  namespace(tokenizer: Tokenizer, tagIndex: number): string {
    if (!this.listed) return this.#uriOf(tokenizer, tagIndex);
    return this.#options.namespaceAware ? (this.list.uris[tagIndex] as string) : '';
  }

  /** The type the DTD declares for the attribute at a tag index, CDATA when it does not; an enumeration is NMTOKEN, as in SAX. */
  type(tagIndex: number): string {
    if (!this.listed) return tagIndex === this.#xmlIdTagIndex ? 'ID' : 'CDATA';
    const type = this.list.types[tagIndex] as AttributeType;
    return type === 'ENUMERATION' ? 'NMTOKEN' : type;
  }

  /** Whether the attribute at a tag index was in the start tag rather than defaulted from the DTD. */
  specified(tagIndex: number): boolean {
    return !this.listed || this.list.isSpecified[tagIndex] === true;
  }

  /** The normalized value of the attribute at a tag index. */
  value(tokenizer: Tokenizer, tagIndex: number): string {
    if (this.listed) return this.list.values[tagIndex] as string;
    return tagIndex === this.#xmlIdTagIndex ? this.#xmlIdValue : spanValue(tokenizer, tagIndex);
  }

  /** The local name of the attribute at a tag index, read from the buffer. */
  #localOf(tokenizer: Tokenizer, tagIndex: number): string {
    const colon = tokenizer.attributeFirstColon[tagIndex] as number;
    if (colon < 0 || !this.#options.namespaceAware) return nameOf(tokenizer, tagIndex);
    return tokenizer.buffer.slice(colon + 1, tokenizer.attributeNameEnd[tagIndex]);
  }

  /** The namespace URI of the attribute at a tag index, read from the buffer; `''` when it has none. */
  #uriOf(tokenizer: Tokenizer, tagIndex: number): string {
    if (!this.#options.namespaceAware) return '';
    const kind = this.#kinds[tagIndex];
    if (kind === AttributeKind.DECLARATION) return XMLNS_NAMESPACE;
    if (kind !== AttributeKind.PREFIXED) return '';
    return this.#scopes.bindings.uri(this.#bindings[tagIndex] as number, tokenizer.buffer, tokenizer.bufferOffset);
  }
}

/** What an attribute without a prefix is to namespaces: `xmlns` declares one. */
function plainKind(buffer: string, start: number, end: number): number {
  return end - start === XMLNS_LENGTH && holdsAt(buffer, start, 'xmlns')
    ? AttributeKind.DECLARATION
    : AttributeKind.PLAIN;
}

/** What a prefixed attribute is to namespaces: `xmlns:` declares one, and `xml:id` is marked as well. */
function prefixedKind(buffer: string, start: number, colon: number): number {
  if (colon - start === XMLNS_LENGTH && holdsAt(buffer, start, 'xmlns')) return AttributeKind.DECLARATION;
  const xmlId = colon - start === XML_LENGTH && holdsAt(buffer, start, 'xml:id');
  return xmlId ? AttributeKind.PREFIXED | AttributeKind.XMLID : AttributeKind.PREFIXED;
}

/** An attribute's qualified name, by its index in the start tag. */
function nameOf(tokenizer: Tokenizer, tagIndex: number): string {
  return tokenizer.buffer.slice(tokenizer.attributeNameStart[tagIndex], tokenizer.attributeNameEnd[tagIndex]);
}

/** Where an attribute's local name starts in the buffer. */
function localStart(tokenizer: Tokenizer, tagIndex: number): number {
  const colon = tokenizer.attributeFirstColon[tagIndex] as number;
  return colon < 0 ? (tokenizer.attributeNameStart[tagIndex] as number) : colon + 1;
}

/** An attribute's value as the start tag gives it, normalized (§3.3.3). */
function spanValue(tokenizer: Tokenizer, tagIndex: number): string {
  const value = tokenizer.buffer.slice(tokenizer.attributeValueStart[tagIndex], tokenizer.attributeValueEnd[tagIndex]);
  return ((tokenizer.attributeFlags[tagIndex] as number) & VALUE_FLAGS) === 0
    ? value
    : normalizeAttributeValue(value, tokenizer.version11, tokenizer.isReplacementText);
}

/** Whether the attributes at tag indexes `first` and `second` have the same qualified name. */
function sameName(tokenizer: Tokenizer, first: number, second: number): boolean {
  const firstStart = tokenizer.attributeNameStart[first] as number;
  const secondStart = tokenizer.attributeNameStart[second] as number;
  const length = (tokenizer.attributeNameEnd[first] as number) - firstStart;
  return (
    length === (tokenizer.attributeNameEnd[second] as number) - secondStart &&
    sameSpan(tokenizer.buffer, firstStart, secondStart, length)
  );
}

/** Checks that no attribute name appears twice in a start tag (WFC: Unique Att Spec). */
function checkDuplicates(tokenizer: Tokenizer): void {
  const count = tokenizer.attributeCount;
  if (count <= PAIRWISE_ATTRIBUTES) {
    for (let i = 1; i < count; i++) {
      for (let j = 0; j < i; j++) if (sameName(tokenizer, i, j)) failDuplicate(tokenizer, i);
    }
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const name = nameOf(tokenizer, i);
    if (seen.has(name)) failDuplicate(tokenizer, i);
    seen.add(name);
  }
}

/** Throws WF_DUPLICATE_ATTRIBUTE for the attribute at tag index `i`. */
function failDuplicate(tokenizer: Tokenizer, i: number): never {
  return fail(
    tokenizer,
    ErrorCode.WF_DUPLICATE_ATTRIBUTE,
    `Attribute ${nameOf(tokenizer, i)} appears twice`,
    tokenizer.attributeNameStart[i]
  );
}
