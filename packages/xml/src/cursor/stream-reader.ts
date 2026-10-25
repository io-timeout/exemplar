import type { ResolvedOptions } from '../config/options.ts';
import type { EntityDeclaration, NotationDeclaration } from '../dtd/declarations.ts';
import type { DtdItem } from '../dtd/store.ts';
import type { Location } from '../errors/xml-error.ts';
import type { DecoderRegistry } from '../input/decoders.ts';
import type { AsyncOpenedSource, OpenedSource, ChunkSource } from '../input/source.ts';
import { ScanFlag } from '../scan/scanner.ts';
import type { LineSegment } from '../tokenizer/lines.ts';
import { Token, Tokenizer, type TokenizerOptions } from '../tokenizer/tokenizer.ts';
import { isAllWhitespace, isWhitespaceSpan } from '../util/whitespace.ts';
import { AsyncInput } from './async-input.ts';
import { AttributeCollector } from './attribute-collector.ts';
import { DtdLoader } from './dtd-loader.ts';
import { ElementStack } from './element-stack.ts';
import { EntityExpander } from './entity-expander.ts';
import { EntityStack } from './entity-stack.ts';
import { ErrorReporter } from './error-reporter.ts';
import { EventCore } from './event-core.ts';
import { EventProcessing } from './event-processing.ts';
import { EventType } from './event-type.ts';
import {
  ADD_FILTER,
  DTD_COMPLETE,
  INCLUDED_DECLARATIONS,
  INPUT_ENCODING,
  XML_ENCODING,
  DTD_ITEMS,
  EVENT_OFFSET,
  EVENT_POSITION,
  type EntityListener,
  LISTEN_ENTITIES,
  copyString,
  isIndex,
  outOfRange,
} from './internal.ts';
import { NamespaceScopes } from './namespace-scopes.ts';
import * as navigation from './navigation.ts';
import type { AsyncStreamReader, StreamReader as PublicStreamReader } from './readers.ts';
import { doctypeOf, piData, tokenText } from './token-values.ts';
import type { ValidationContext } from './validation.ts';

// Keys of the private methods: symbols rather than #names, which V8 optimizes less well on the hot path.
const VALIDATION_CONTEXT: unique symbol = Symbol('validationContext');
const AS_RETURNED: unique symbol = Symbol('asReturned');
const CREATE_TOKENIZER: unique symbol = Symbol('createTokenizer');
const SLICE_BEFORE_DROP: unique symbol = Symbol('sliceBeforeDrop');
const CURRENT_ELEMENT_DEPTH: unique symbol = Symbol('currentElementDepth');
const CURRENT_NAME_COLON: unique symbol = Symbol('currentNameColon');
const START_LOCAL_NAME: unique symbol = Symbol('startLocalName');
const CURRENT_SCOPE_DEPTH: unique symbol = Symbol('currentScopeDepth');
const TAG_ATTRIBUTE_INDEX: unique symbol = Symbol('tagAttributeIndex');
const GENERAL_TEXT: unique symbol = Symbol('generalText');
const FAILED: unique symbol = Symbol('failed');
const LOCATION_AT: unique symbol = Symbol('locationAt');

/** The ScanFlag bits that mean character data needs normalizing before it is returned: line ends and references. */
const TEXT_NEEDS_NORMALIZING = ScanFlag.CR | ScanFlag.NEL | ScanFlag.REFERENCE;

/** The DOCTYPE's declarations, as the DTD event reports them. */
export interface Doctype {
  /** The DOCTYPE's name, which should match the root element's. */
  readonly name: string;
  /** The public identifier of the external subset, if the DOCTYPE names one. */
  readonly publicId?: string;
  /** The system identifier of the external subset, as written, if the DOCTYPE names one. */
  readonly systemId?: string;
  /** The internal subset as written, between the brackets, if there is one. */
  readonly internalSubset?: string;
  /** The general entities declared, in the order they were read. */
  readonly entities: readonly EntityDeclaration[];
  /** The notations declared, in the order they were read. */
  readonly notations: readonly NotationDeclaration[];
  /** The processing instructions in the DTD, which SAX reports as content but the cursor reports here. */
  readonly processingInstructions: readonly { readonly target: string; readonly data: string }[];
}

/** Decides whether a filtered reader reports the current event, as StAX's `StreamFilter` does. */
export type StreamFilter = (reader: PublicStreamReader | AsyncStreamReader) => boolean;

/** No DTD items, shared so that nothing allocates an empty list. */
const NO_ITEMS: readonly DtdItem[] = [];

/**
 * The pull reader at the core of every API, following StAX's `XMLStreamReader`. The caller asks
 * for one event at a time with `next()` and reads the current event with the accessors, such as
 * `name()`, `attributeValue(i)` and `text()`. The event reader, SAX, the DOM builder and XInclude
 * all read through one of these.
 *
 * The reader is assembled from parts, each holding one concern:
 *
 * - the event core turns tokens into events and checks the document's structure;
 * - the element stack and namespace scopes track the open elements and their prefixes;
 * - the attribute collector reads a start tag's attributes, with the DTD's defaults;
 * - the entity stack and expander handle entity references, each entity read by a tokenizer of its own;
 * - event processing adds what the options ask for on top: merged text, entity boundaries,
 *   validation and filters. Without any of those, `next()` goes straight to the core.
 *
 * The accessors read the tokenizer's buffer directly, slicing strings only when asked; with the
 * `copyStrings` option they return copies, which don't keep the buffer alive.
 */
export class StreamReader {
  readonly #options: ResolvedOptions;
  readonly #opened: OpenedSource;
  /** Whether accessors return copies of their strings, as the `copyStrings` option asks. */
  readonly #copyStrings: boolean;
  /** Turns tokens into events, and holds the current event the accessors describe. */
  readonly #core: EventCore;

  readonly #entities: EntityStack;
  readonly #errors: ErrorReporter;
  readonly #input: AsyncInput;
  readonly #elements = new ElementStack();
  readonly #scopes = new NamespaceScopes();
  readonly #attributes: AttributeCollector;
  readonly #expander: EntityExpander;
  readonly #processing: EventProcessing;
  /** Whether events come straight from the tokens: no coalescing, entity boundaries, validation or filters. */
  #passesStraightThrough: boolean;

  constructor(opened: OpenedSource, options: ResolvedOptions, registry: DecoderRegistry, input?: AsyncOpenedSource) {
    this.#opened = opened;
    this.#options = options;
    this.#copyStrings = options.copyStrings;
    const async = input !== undefined;
    this.#input = new AsyncInput(input);
    this.#entities = new EntityStack(this[CREATE_TOKENIZER](opened.text, {}), opened.systemId);
    this.#errors = new ErrorReporter(options.errorHandler, this.#entities);
    this.#attributes = new AttributeCollector(
      options,
      this.#scopes,
      (code, message, index) => this.#errors.error(code, message, this[LOCATION_AT](index)),
      (tagAttributeIndex) => this.#expander.expandedAttributeValue(tagAttributeIndex, this.#core.store)
    );
    const validating = options.validator !== undefined;
    this.#processing = new EventProcessing(this, options.coalescing, options.reportEntityBoundaries);
    this.#expander = new EntityExpander(options, registry, async, {
      entities: this.#entities,
      elements: this.#elements,
      errors: this.#errors,
      processing: this.#processing,
      createTokenizer: (source, tokenizerOptions) => this[CREATE_TOKENIZER](source, tokenizerOptions),
      sliceBeforeLeaving: (tokenizer) => this[SLICE_BEFORE_DROP](tokenizer, Number.POSITIVE_INFINITY),
    });
    this.#core = new EventCore(options, opened, async, {
      entities: this.#entities,
      errors: this.#errors,
      input: this.#input,
      dtd: new DtdLoader(options, opened, this.#entities, this.#errors, validating),
      elements: this.#elements,
      scopes: this.#scopes,
      attributes: this.#attributes,
      expander: this.#expander,
      validating,
    });
    this.#processing.connect(this.#core, options.validator?.create(this[VALIDATION_CONTEXT]()));
    this.#passesStraightThrough = this.#processing.passesStraightThrough;
    if (async) return;
    try {
      this.#core.begin();
    } catch (error) {
      throw this.#errors.toXmlError(error);
    }
  }

  /** Waits for more input: the stream's next chunk, the next `feed`, or a resolver's answer. A sync reader never waits. */
  fill(): Promise<void> {
    return this.#input.fill(this.#expander.takePending());
  }

  /** Gives an asynchronous reader created without a source its next chunk of bytes. */
  feed(chunk: Uint8Array): void {
    this.#input.feed(chunk);
  }

  /** Tells an asynchronous reader created without a source that no more input will come. */
  endOfInput(): void {
    this.#input.end();
  }

  /** Moves to the next event and returns its type. */
  next(): EventType {
    const core = this.#core;
    try {
      const event = this.#passesStraightThrough ? core.advance() : this.#processing.next();
      core.event = event;
      return event;
    } catch (error) {
      throw this[FAILED](error);
    }
  }

  /** What a failed `next()` throws: the error as an XMLError, which ends the document when it is one that does. */
  private [FAILED](error: unknown): unknown {
    const core = this.#core;
    core.recover();
    const thrown = this.#errors.toXmlError(error);
    if (thrown === this.#errors.endedBy) core.stop(thrown);
    return thrown;
  }

  /** What the validator sees of this document. */
  private [VALIDATION_CONTEXT](): ValidationContext {
    return {
      reader: this,
      store: () => this.#core.store,
      attributes: () => this.#attributes.list,
      namespaceAware: this.#options.namespaceAware,
      standalone: () => this.#entities.document.declaration?.standalone === true,
      textHasReferences: () =>
        this.#core.literalText === undefined && (this.#core.tokenizer.valueFlags & ScanFlag.REFERENCE) !== 0,
      error: (code, message, location) =>
        this.#errors.error(
          code,
          message,
          location === undefined ? this.location() : this.#entities.withDocumentSystemId(location)
        ),
    };
  }

  /** Adds a filter that every event must pass. @internal */
  [ADD_FILTER](filter: StreamFilter): void {
    this.#processing.addFilter(filter);
    this.#passesStraightThrough = false;
  }

  /** Tells a listener where expanded entities start and end. @internal */
  [LISTEN_ENTITIES](listener: EntityListener): void {
    this.#processing.listener = listener;
  }

  /** The current event's position: a line segment that finds its line later, or its location now. @internal */
  [EVENT_POSITION](): LineSegment | Location {
    const processing = this.#processing;
    if (
      this.#entities.depth > 0 ||
      processing.textLocation !== undefined ||
      processing.boundaryLocation !== undefined
    ) {
      return this.location();
    }
    return this.#entities.document.lines.recordLineStarts(this.#opened.systemId);
  }

  /** The current event's document offset. @internal */
  get [EVENT_OFFSET](): number {
    return this.#core.offset;
  }

  /** The encoding detection chose for the document; undefined for text given as a string. @internal */
  get [INPUT_ENCODING](): string | undefined {
    return this.#opened.text.detection?.decoderName;
  }

  /** The unparsed entities and notations included content has added to the document, which XInclude reports. @internal */
  [INCLUDED_DECLARATIONS](): readonly DtdItem[] {
    return NO_ITEMS;
  }

  /** The encoding the XML declaration names, if it names one. @internal */
  get [XML_ENCODING](): string | undefined {
    return this.#entities.document.declaration?.encoding;
  }

  /** Whether every declaration the DTD refers to was read. @internal */
  get [DTD_COMPLETE](): boolean {
    return !this.#core.store.hasUnreadDeclarations;
  }

  /** What the DTD held, in order, for SAX. @internal */
  [DTD_ITEMS](): readonly DtdItem[] {
    return this.#core.store.items;
  }

  /** A string as the accessors return it: copied when `copyStrings` is on. */
  private [AS_RETURNED](s: string): string {
    return this.#copyStrings ? copyString(s) : s;
  }

  /** Whether there are more events after this one. */
  hasNext(): boolean {
    return this.#core.event !== EventType.END_DOCUMENT;
  }

  /** The current event's type. */
  eventType(): EventType {
    return this.#core.event;
  }

  /** Releases nothing and changes nothing, as the JDK's does; there for StAX compatibility. */
  close(): void {
    // Nothing to release: the caller owns the source.
  }

  /** Creates a tokenizer for a text, which tells the reader before it drops text the open elements or bindings still point into. */
  private [CREATE_TOKENIZER](source: ChunkSource, options: Omit<TokenizerOptions, 'maxNameLength'>): Tokenizer {
    const tokenizer = new Tokenizer(source, { maxNameLength: this.#options.limits.nameLength, ...options });
    tokenizer.onDrop = (offset) => this[SLICE_BEFORE_DROP](tokenizer, offset);
    return tokenizer;
  }

  /** Slices the open elements' names and the bindings whose text starts before `offset`, which `tokenizer` is about to drop. */
  private [SLICE_BEFORE_DROP](tokenizer: Tokenizer, offset: number): void {
    this.#elements.sliceBeforeDrop(this.#entities.current, offset);
    this.#scopes.sliceBeforeDrop(tokenizer, offset);
  }

  // Accessors

  /** The depth of the element the current START_ELEMENT or END_ELEMENT is about, or -1 for any other event. */
  private [CURRENT_ELEMENT_DEPTH](): number {
    const event = this.#core.event;
    return event === EventType.START_ELEMENT || event === EventType.END_ELEMENT ? this.#elements.depth - 1 : -1;
  }

  /** Where the colon is in the current element's name, or -1 when it has none or namespaces are off. */
  private [CURRENT_NAME_COLON](): number {
    const elementDepth = this[CURRENT_ELEMENT_DEPTH]();
    return elementDepth < 0 || !this.#options.namespaceAware
      ? -1
      : (this.#elements.nameFirstColons[elementDepth] as number);
  }

  /** The current element's qualified name, or the entity's name for ENTITY_REFERENCE. */
  name(): string {
    const core = this.#core;
    if (core.event === EventType.ENTITY_REFERENCE) return this.#expander.name;
    if (core.event >= EventType.START_ENTITY) return this.#processing.boundaryName;
    const elementDepth = this[CURRENT_ELEMENT_DEPTH]();
    return elementDepth < 0 ? '' : this[AS_RETURNED](this.#elements.nameAt(elementDepth, this.#core.tokenizer));
  }

  /** The current element's local name, read from the open element without going through name(). */
  localName(): string {
    const event = this.#core.event;
    if (event === EventType.START_ELEMENT) return this[AS_RETURNED](this[START_LOCAL_NAME]());
    if (event !== EventType.END_ELEMENT) return this.name();
    const elementDepth = this.#elements.depth - 1;
    const name = this[AS_RETURNED](this.#elements.nameAt(elementDepth, this.#core.tokenizer));
    const colon = this.#options.namespaceAware ? (this.#elements.nameFirstColons[elementDepth] as number) : -1;
    return colon < 0 ? name : name.slice(colon + 1);
  }

  /** The start tag's local name: from its cached qualified name, or sliced from the tag the tokenizer still holds. */
  private [START_LOCAL_NAME](): string {
    const tokenizer = this.#core.tokenizer;
    const colon = this.#options.namespaceAware ? tokenizer.nameFirstColon : -1;
    const cached = this.#elements.names[this.#elements.depth - 1];
    if (cached !== undefined) return colon < 0 ? cached : cached.slice(colon + 1 - tokenizer.nameStart);
    return tokenizer.buffer.slice(colon < 0 ? tokenizer.nameStart : colon + 1, tokenizer.nameEnd);
  }

  /** The current element's prefix, or the empty string. */
  prefix(): string {
    const colon = this[CURRENT_NAME_COLON]();
    return colon < 0 ? '' : this.name().slice(0, colon);
  }

  /** The depth of the element the current event is about, or -1 when namespaces are off or the event is no element's. */
  private [CURRENT_SCOPE_DEPTH](): number {
    return this.#options.namespaceAware ? this[CURRENT_ELEMENT_DEPTH]() : -1;
  }

  /** The current element's namespace URI (the empty string for none), or, given an index, the URI of that namespace declaration. */
  namespaceURI(index?: number): string {
    const elementDepth = this[CURRENT_SCOPE_DEPTH]();
    if (index !== undefined)
      return this[AS_RETURNED](this.#scopes.declaredUri(elementDepth, index, this.#core.tokenizer));
    if (elementDepth < 0) return '';
    return this[AS_RETURNED](
      this.#scopes.elementUri(
        elementDepth,
        (this.#elements.nameFirstColons[elementDepth] as number) >= 0,
        this.#core.tokenizer
      )
    );
  }

  /** How many namespaces the current element declares. */
  namespaceCount(): number {
    return this.#scopes.declaredCount(this[CURRENT_SCOPE_DEPTH]());
  }

  /** The prefix of a namespace declaration, the empty string for the default namespace. */
  namespacePrefix(index: number): string {
    return this[AS_RETURNED](this.#scopes.declaredPrefix(this[CURRENT_SCOPE_DEPTH](), index, this.#core.tokenizer));
  }

  /** How many attributes the current start tag has, without `xmlns` attributes unless `namespacePrefixes` is on. */
  attributeCount(): number {
    return this.#core.event === EventType.START_ELEMENT ? this.#attributes.count(this.#core.tokenizer) : 0;
  }

  /**
   * The index in the start tag of the attribute the caller numbers `attributeIndex`, which differs when
   * `xmlns` attributes are hidden. Throws a RangeError unless `attributeIndex` is an integer below attributeCount().
   */
  private [TAG_ATTRIBUTE_INDEX](attributeIndex: number): number {
    if (this.#core.event !== EventType.START_ELEMENT || !isIndex(attributeIndex))
      return outOfRange('Attribute', attributeIndex);
    return this.#attributes.tagIndexOf(this.#core.tokenizer, attributeIndex);
  }

  /** An attribute's qualified name. */
  attributeName(index: number): string {
    return this[AS_RETURNED](this.#attributes.name(this.#core.tokenizer, this[TAG_ATTRIBUTE_INDEX](index)));
  }

  /** An attribute's local name. */
  attributeLocalName(index: number): string {
    return this[AS_RETURNED](this.#attributes.localName(this.#core.tokenizer, this[TAG_ATTRIBUTE_INDEX](index)));
  }

  /** An attribute's prefix, or the empty string. */
  attributePrefix(index: number): string {
    return this[AS_RETURNED](this.#attributes.prefix(this.#core.tokenizer, this[TAG_ATTRIBUTE_INDEX](index)));
  }

  /** An attribute's namespace URI, or the empty string. */
  attributeNamespace(index: number): string {
    return this[AS_RETURNED](this.#attributes.namespace(this.#core.tokenizer, this[TAG_ATTRIBUTE_INDEX](index)));
  }

  /** An attribute's type as the DTD declares it, CDATA when it does not; an enumeration reports NMTOKEN, as in SAX. */
  attributeType(index: number): string {
    return this.#attributes.type(this[TAG_ATTRIBUTE_INDEX](index));
  }

  /** Whether an attribute was in the start tag rather than defaulted from the DTD. */
  isAttributeSpecified(index: number): boolean {
    return this.#attributes.specified(this[TAG_ATTRIBUTE_INDEX](index));
  }

  /** An attribute's normalized value, by index or by namespace URI (`''` for none) and local name. */
  attributeValue(index: number): string;
  attributeValue(namespaceURI: string, localName: string): string | undefined;
  attributeValue(indexOrNamespace: number | string, localName?: string): string | undefined {
    if (typeof indexOrNamespace === 'number') {
      return this[AS_RETURNED](
        this.#attributes.value(this.#core.tokenizer, this[TAG_ATTRIBUTE_INDEX](indexOrNamespace))
      );
    }
    for (let i = 0; i < this.attributeCount(); i++) {
      if (this.attributeLocalName(i) === localName && this.attributeNamespace(i) === indexOrNamespace) {
        return this.attributeValue(i);
      }
    }
    return undefined;
  }

  /** The text of CHARACTERS, SPACE, CDATA and COMMENT events, the DOCTYPE for DTD, and an entity's replacement text for ENTITY_REFERENCE. */
  text(): string {
    const core = this.#core;
    const tokenizer = core.tokenizer;
    // Plain text, with no entity or merged text, line ends, references or copying, needs none of the general path.
    const plain =
      tokenizer.kind === Token.TEXT &&
      core.literalText === undefined &&
      core.event !== EventType.ENTITY_REFERENCE &&
      (tokenizer.valueFlags & TEXT_NEEDS_NORMALIZING) === 0 &&
      !this.#copyStrings;
    if (!plain) return this[AS_RETURNED](this[GENERAL_TEXT]());
    const start = tokenizer.valueStart;
    return tokenizer.valueEnd - start === 1
      ? tokenizer.buffer.charAt(start)
      : tokenizer.buffer.slice(start, tokenizer.valueEnd);
  }

  /** The current event's text, when it needs more than a slice of the buffer: merged or entity text, or text to normalize. */
  private [GENERAL_TEXT](): string {
    const core = this.#core;
    if (core.literalText !== undefined) return core.literalText;
    if (core.event === EventType.ENTITY_REFERENCE) return this.#expander.text;
    return tokenText(this.#core.tokenizer);
  }

  /** Whether the current character data is all whitespace. */
  isWhitespace(): boolean {
    const { event, literalText, tokenizer } = this.#core;
    if (literalText !== undefined) return isAllWhitespace(literalText);
    return (
      event === EventType.SPACE ||
      (event === EventType.CHARACTERS &&
        isWhitespaceSpan(tokenizer.buffer, tokenizer.valueStart, tokenizer.valueEnd, tokenizer.version11))
    );
  }

  /** The current processing instruction's target. */
  piTarget(): string {
    const tokenizer = this.#core.tokenizer;
    return this[AS_RETURNED](tokenizer.buffer.slice(tokenizer.nameStart, tokenizer.nameEnd));
  }

  /** The current processing instruction's data, without the whitespace after the target. */
  piData(): string {
    return piData(this.#core.tokenizer, this.#copyStrings);
  }

  /** For the DTD event: the DOCTYPE's name and identifiers, its internal subset, and the entities and notations declared. */
  doctype(): Doctype {
    return doctypeOf(this.#core.tokenizer, this.#core.store);
  }

  /** The version the XML declaration names, if there is one. */
  version(): string | undefined {
    return this.#entities.document.declaration?.version;
  }

  /** The encoding the XML declaration names, or else the one detection chose. */
  encoding(): string | undefined {
    return this.#entities.document.declaration?.encoding ?? this.#opened.text.detection?.decoderName;
  }

  /** The standalone value the XML declaration gives, if any. */
  standalone(): boolean | undefined {
    return this.#entities.document.declaration?.standalone;
  }

  /** Where the current event starts; inside an internal entity, where the entity was referred to. */
  location(): Location {
    const core = this.#core;
    const processing = this.#processing;
    return (
      processing.textLocation ??
      processing.boundaryLocation ??
      this[LOCATION_AT](core.offset - core.tokenizer.bufferOffset)
    );
  }

  /** The location of a buffer index in the text being read, with the system id of the entity it is in. */
  private [LOCATION_AT](index: number): Location {
    return this.#entities.locationIn(this.#core.tokenizer, index);
  }

  // Navigation

  /** Skips whitespace, comments and PIs to the next start or end tag. */
  nextTag(): EventType {
    return navigation.nextTag(this);
  }

  /** Like `nextTag()`, awaiting input when an asynchronous reader needs it. */
  nextTagAsync(): Promise<EventType> {
    return navigation.nextTagAsync(this);
  }

  /** Reads a text-only element's text and stops at its end tag. */
  elementText(): string {
    return navigation.elementText(this);
  }

  /** Like `elementText()`, awaiting input when an asynchronous reader needs it. */
  elementTextAsync(): Promise<string> {
    return navigation.elementTextAsync(this);
  }

  /** Calls `handle` for each event to the end of the document, awaiting input as it is needed. */
  forEachEvent(handle: (type: Exclude<EventType, typeof EventType.NEED_INPUT>, reader: this) => void): Promise<void> {
    return navigation.forEachEvent(this, handle);
  }
}

/** Whether a value is a reader rather than a source. */
export function isReader(value: unknown): value is PublicStreamReader | AsyncStreamReader {
  return value instanceof StreamReader;
}
