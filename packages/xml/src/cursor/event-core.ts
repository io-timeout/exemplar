import type { ResolvedOptions } from '../config/options.ts';
import { DeclarationStore } from '../dtd/store.ts';
import { ErrorCode } from '../errors/codes.ts';
import { checkDeclaredEncoding } from '../input/detect.ts';
import type { OpenedSource } from '../input/source.ts';
import { scanError, ScanFlag } from '../scan/scanner.ts';
import { Token, type Tokenizer } from '../tokenizer/tokenizer.ts';
import { ErrorFactory } from '../util/errors.ts';
import { isWhitespaceSpan } from '../util/whitespace.ts';
import type { AsyncInput } from './async-input.ts';
import type { AttributeCollector } from './attribute-collector.ts';
import type { DtdLoader } from './dtd-loader.ts';
import type { ElementStack } from './element-stack.ts';
import type { EntityExpander } from './entity-expander.ts';
import type { EntityStack } from './entity-stack.ts';
import type { ErrorReporter } from './error-reporter.ts';
import { EventType } from './event-type.ts';
import { fail } from './internal.ts';
import type { NamespaceScopes } from './namespace-scopes.ts';
import { tokenText } from './token-values.ts';

// Keys of the private methods: symbols rather than #names, which V8 optimizes less well on the hot path.
const CHECK_ENCODING: unique symbol = Symbol('checkEncoding');
const ADVANCE_AFTER: unique symbol = Symbol('advanceAfter');
const NEXT_TOKEN: unique symbol = Symbol('nextToken');
const RESUME_OR_START: unique symbol = Symbol('resumeOrStart');
const AWAIT_RESOLVER: unique symbol = Symbol('awaitResolver');
const END_LITERAL: unique symbol = Symbol('endLiteral');
const END_SELF_CLOSED_ELEMENT: unique symbol = Symbol('endSelfClosedElement');
const TO_EVENT: unique symbol = Symbol('toEvent');
const OTHER_EVENT: unique symbol = Symbol('otherEvent');
const TEXT_EVENT: unique symbol = Symbol('textEvent');
const TEXT_OUTSIDE_ROOT: unique symbol = Symbol('textOutsideRoot');
const CHECK_NORMALIZED: unique symbol = Symbol('checkNormalized');
const START_TAG_EVENT: unique symbol = Symbol('startTagEvent');
const FAIL_START_TAG: unique symbol = Symbol('failStartTag');
const END_TAG_EVENT: unique symbol = Symbol('endTagEvent');
const FAIL_END_TAG: unique symbol = Symbol('failEndTag');
const LEAVE_ELEMENT: unique symbol = Symbol('leaveElement');
const REENTER_ELEMENT: unique symbol = Symbol('reenterElement');
const DOCTYPE_EVENT: unique symbol = Symbol('doctypeEvent');
const READ_DTD: unique symbol = Symbol('readDtd');
const END_OF_INPUT: unique symbol = Symbol('endOfInput');
const REFERENCE_EVENT: unique symbol = Symbol('referenceEvent');
const END_ENTITY: unique symbol = Symbol('endEntity');
const FAIL: unique symbol = Symbol('fail');

/** The declarations of a document without a DOCTYPE; never changed, so documents can share it. */
const NO_DTD = new DeclarationStore();

/** The value `#resumeToken` holds when an asynchronous reader has yet to read the document's start. */
const RESUME_START = -1;

/** The value `#resumeToken` holds once an error has ended the document. */
const RESUME_FAILED = -2;

/** The other parts of the reader that the event core drives; the stream reader builds them and hands them over. */
export interface CoreParts {
  readonly entities: EntityStack;
  readonly errors: ErrorReporter;
  readonly input: AsyncInput;
  readonly dtd: DtdLoader;
  readonly elements: ElementStack;
  readonly scopes: NamespaceScopes;
  readonly attributes: AttributeCollector;
  readonly expander: EntityExpander;
  /** Whether a validator reads the document, which needs every start tag's attributes listed. */
  readonly validating: boolean;
}

/**
 * Turns the tokenizer's tokens into the reader's events, and checks the structure of the document.
 *
 * The tokenizer only splits text into tokens; it doesn't know which element is open or whether a
 * DOCTYPE may appear here. This class does. For each token it decides the event: a start tag
 * becomes START_ELEMENT once its attributes and namespaces are read, an empty-element tag such as
 * `<br/>` gives START_ELEMENT and then END_ELEMENT, and whitespace outside the root element gives
 * nothing unless asked for. Along the way it checks what the tokenizer can't: one root element,
 * end tags that match, the DOCTYPE before the root, and the depth and attribute limits.
 *
 * Entity references are handed to the entity expander, which may push the entity's own tokenizer.
 * `tokenizer` always follows the innermost one, so the next token comes from the right text.
 *
 * An asynchronous reader may have to wait: for more input, or for a resolver to answer about a DTD
 * or an entity. The core then returns NEED_INPUT and keeps the token in `#resumeToken`, to process
 * it again on the next call.
 */
export class EventCore {
  readonly #options: ResolvedOptions;
  readonly #opened: OpenedSource;
  /** Whether input arrives over time, so that the reader may wait for it. */
  readonly #async: boolean;
  readonly #entities: EntityStack;
  readonly #errors: ErrorReporter;
  readonly #input: AsyncInput;
  readonly #dtd: DtdLoader;
  readonly #elements: ElementStack;
  readonly #scopes: NamespaceScopes;
  readonly #attributes: AttributeCollector;
  readonly #expander: EntityExpander;
  readonly #validating: boolean;

  /** The current event, which the reader's accessors describe. */
  event: EventType = EventType.START_DOCUMENT;
  /** The tokenizer being read: the entity stack's current one, kept here because every token reads it. */
  tokenizer: Tokenizer;
  /** The document offset where the current event's token starts, in the text `tokenizer` reads. */
  offset = 0;
  /** The text of a CHARACTERS event that does not come from the tokenizer: an entity's text without markup, or merged text. */
  literalText: string | undefined;
  /** What the DTD declared, read by start tags, entity references and the DTD event. */
  store = NO_DTD;

  /** Whether the DOCTYPE has been read, which may come only once. */
  #doctypeRead = false;
  /** Whether the last event was an empty-element tag's START_ELEMENT, whose END_ELEMENT comes next. */
  #selfClosedEndPending = false;
  /** Whether the last event was an END_ELEMENT, whose element is closed before the next event. */
  #leavePending = false;
  /** Whether the not-fully-normalized warning has been given; it comes once per document. */
  #warnedNotNormalized = false;
  /** RESUME_START, RESUME_FAILED, or a token to process again once a resolver has answered; 0 when reading as usual. */
  #resumeToken = 0;
  /** The error that ended the document, thrown again by every later call. */
  #endedBy: unknown;

  constructor(options: ResolvedOptions, opened: OpenedSource, async: boolean, parts: CoreParts) {
    this.#options = options;
    this.#opened = opened;
    this.#async = async;
    this.#entities = parts.entities;
    this.#errors = parts.errors;
    this.#input = parts.input;
    this.#dtd = parts.dtd;
    this.#elements = parts.elements;
    this.#scopes = parts.scopes;
    this.#attributes = parts.attributes;
    this.#expander = parts.expander;
    this.#validating = parts.validating;
    this.tokenizer = parts.entities.current;
    if (async) {
      this.event = EventType.NEED_INPUT;
      this.#resumeToken = RESUME_START;
    }
  }

  /** Reads the XML declaration, if there is one, and checks the encoding it names; false while input is pending. */
  begin(): boolean {
    if (!this.tokenizer.readDeclaration()) return false;
    this[CHECK_ENCODING]();
    return true;
  }

  /** Checks the encoding the XML declaration names against what detection found. */
  private [CHECK_ENCODING](): void {
    const problem = checkDeclaredEncoding(this.#opened.text.detection, this.#entities.document.declaration?.encoding);
    if (!problem) return;
    if (problem.level === 'fatal') throw scanError(problem.code, 0, problem.message);
    if (problem.level === 'error') this.#errors.error(problem.code, problem.message, this.#entities.documentStart());
    else this.#errors.warn(problem.code, problem.message, this.#entities.documentStart());
  }

  /** Reads tokens until one makes an event, and returns it; first finishes what the last event left to do. */
  advance(): EventType {
    if (this.event === EventType.END_DOCUMENT || this.literalText !== undefined || this.#resumeToken !== 0) {
      return this[ADVANCE_AFTER]();
    }
    if (this.#leavePending) this[LEAVE_ELEMENT]();
    if (this.#selfClosedEndPending) return this[END_SELF_CLOSED_ELEMENT]();
    return this[NEXT_TOKEN]();
  }

  /** Moves on from the end of the document, an entity's text, or a token that waited for a resolver. */
  private [ADVANCE_AFTER](): EventType {
    if (this.#resumeToken === RESUME_FAILED) throw this.#endedBy;
    if (this.event === EventType.END_DOCUMENT) throw ErrorFactory.create(Error, 'There are no more events');
    if (this.literalText !== undefined) this[END_LITERAL]();
    if (this.#resumeToken !== 0) {
      const event = this[RESUME_OR_START]();
      if (event !== undefined) return event;
    }
    return this[NEXT_TOKEN]();
  }

  /** As in StAX, a call that fails leaves the reader at its last event, so an element whose end it was comes back. */
  recover(): void {
    if (this.event === EventType.END_ELEMENT && !this.#leavePending && this.#elements.justLeft) this[REENTER_ELEMENT]();
  }

  /** Ends the document at an error: no more events, and every later call throws it again (§1.2). */
  stop(error: unknown): void {
    this.#endedBy = error;
    this.#resumeToken = RESUME_FAILED;
  }

  /** Points the location at the token the last call failed on, where the events reported before its error are. */
  pointAtFailedToken(): void {
    this.offset = this.tokenizer.bufferOffset + this.tokenizer.tokenStart;
  }

  /** Reads tokens until one makes an event; counts the event toward the entity limits when an entity produced it. */
  private [NEXT_TOKEN](): EventType {
    for (;;) {
      const tokenizer = this.tokenizer;
      const kind = tokenizer.next();
      this.offset = tokenizer.bufferOffset + tokenizer.tokenStart;
      const event = this[TO_EVENT](kind);
      if (event === undefined) continue;
      if (this.#entities.depth > 0 && event !== EventType.NEED_INPUT) this.#expander.countNode();
      return event;
    }
  }

  /** Starts the document, or processes again the token that waited for a resolver; undefined to read on. */
  private [RESUME_OR_START](): EventType | undefined {
    const kind = this.#resumeToken;
    if (kind === RESUME_START) {
      if (!this.begin()) return this.#input.needInput();
      this.#resumeToken = 0;
      return EventType.START_DOCUMENT;
    }
    this.#resumeToken = 0;
    const event = this[TO_EVENT](kind);
    if (event !== undefined && this.#entities.depth > 0 && event !== EventType.NEED_INPUT) this.#expander.countNode();
    return event;
  }

  /** Keeps a token to process again once a resolver has answered, and reports NEED_INPUT. */
  private [AWAIT_RESOLVER](kind: number): EventType {
    this.#resumeToken = kind;
    return this.#input.needInput();
  }

  /** Drops the text the last event held, telling those who hear of entities when it was an entity's that has now ended. */
  private [END_LITERAL](): void {
    this.literalText = undefined;
    this.#expander.endLiteral();
  }

  /** The END_ELEMENT of an empty-element tag. */
  private [END_SELF_CLOSED_ELEMENT](): EventType {
    this.#selfClosedEndPending = false;
    this.#leavePending = true;
    if (this.#entities.depth > 0) this.#expander.countNode();
    return EventType.END_ELEMENT;
  }

  /** Turns a token into an event, or undefined for whitespace outside the root that is not reported. */
  private [TO_EVENT](kind: number): EventType | undefined {
    if (kind === Token.TEXT) return this[TEXT_EVENT]();
    if (kind === Token.START_TAG) return this[START_TAG_EVENT]();
    if (kind === Token.END_TAG) return this[END_TAG_EVENT]();
    return this[OTHER_EVENT](kind);
  }

  /** Turns a token other than text and tags into an event. */
  private [OTHER_EVENT](kind: number): EventType | undefined {
    if (kind === Token.COMMENT) return EventType.COMMENT;
    if (kind === Token.CDATA) {
      if (this.#elements.depth === 0)
        this[FAIL](ErrorCode.WF_CONTENT_OUTSIDE_ROOT, 'CDATA is not allowed outside the root element');
      return EventType.CDATA;
    }
    if (kind === Token.PI) {
      if (this.#options.namespaceAware && this.tokenizer.nameColonCount > 0) {
        this[FAIL](ErrorCode.NS_COLON, 'A processing instruction target must not contain a colon');
      }
      return EventType.PROCESSING_INSTRUCTION;
    }
    if (kind === Token.ENTITY_REFERENCE) return this[REFERENCE_EVENT]();
    if (kind === Token.DOCTYPE) return this[DOCTYPE_EVENT]();
    return kind === Token.NEED_INPUT ? this.#input.needInput() : this[END_OF_INPUT]();
  }

  /** Character data inside the root, or whitespace outside it. */
  private [TEXT_EVENT](): EventType | undefined {
    if (this.#elements.depth === 0) return this[TEXT_OUTSIDE_ROOT]();
    const tokenizer = this.tokenizer;
    if (this.#options.checkNormalization && tokenizer.version11) this[CHECK_NORMALIZED](tokenText(tokenizer));
    return EventType.CHARACTERS;
  }

  /** Whitespace outside the root, which is reported only when asked for; anything else fails. */
  private [TEXT_OUTSIDE_ROOT](): EventType | undefined {
    const tokenizer = this.tokenizer;
    if (
      (tokenizer.valueFlags & ScanFlag.REFERENCE) !== 0 ||
      !isWhitespaceSpan(tokenizer.buffer, tokenizer.valueStart, tokenizer.valueEnd, tokenizer.version11)
    ) {
      this[FAIL](
        ErrorCode.WF_CONTENT_OUTSIDE_ROOT,
        'Only whitespace, comments and processing instructions may appear outside the root element'
      );
    }
    return this.#options.reportPrologWhitespace ? EventType.SPACE : undefined;
  }

  /** Reports, once, text that is not fully normalized (XML 1.1 §2.13). */
  private [CHECK_NORMALIZED](text: string): void {
    if (this.#warnedNotNormalized || (text.normalize('NFC') === text && !/^\p{M}/u.test(text))) return;
    this.#warnedNotNormalized = true;
    const tokenizer = this.tokenizer;
    const location = this.#entities.locationIn(tokenizer, this.offset - tokenizer.bufferOffset);
    this.#errors.warn(ErrorCode.NOT_FULLY_NORMALIZED, 'The document is not fully normalized', location);
  }

  /**
   * A start tag's event: checks the root and limits, opens the element and its namespace scope, and
   * reads its attributes. Listing them all is needed only when the DTD declares some for the
   * element, an attribute refers to an entity, or a validator reads them.
   */
  private [START_TAG_EVENT](): EventType {
    const tokenizer = this.tokenizer;
    const { limits } = this.#options;
    const outOfPlace = this.#elements.rootEnded || this.#elements.depth >= limits.elementDepth;
    if (outOfPlace || tokenizer.attributeCount > limits.attributesPerElement) this[FAIL_START_TAG]();
    const elementDepth = this.#elements.push(tokenizer);
    this.#scopes.openScope(elementDepth);
    const store = this.store;
    const declared =
      store.attributes.size > 0 ? store.attributes.get(this.#elements.nameAt(elementDepth, tokenizer)) : undefined;
    const listed = declared !== undefined || (tokenizer.allAttributeFlags & ScanFlag.ENTITY) !== 0 || this.#validating;
    this.#attributes.read(tokenizer, elementDepth, listed, declared);
    this.#selfClosedEndPending = tokenizer.selfClosing;
    return EventType.START_ELEMENT;
  }

  /** Throws for a start tag after the root element, or one past the depth or attribute limits. */
  private [FAIL_START_TAG](): never {
    const { limits } = this.#options;
    if (this.#elements.rootEnded) this[FAIL](ErrorCode.WF_SECOND_ROOT, 'A document has only one root element');
    if (this.#elements.depth >= limits.elementDepth) {
      this[FAIL](ErrorCode.LIMIT_ELEMENT_DEPTH, `Elements are nested more than ${limits.elementDepth} deep`);
    }
    return this[FAIL](ErrorCode.LIMIT_ATTRIBUTES, `An element has more than ${limits.attributesPerElement} attributes`);
  }

  /** An end tag's event, after checking it closes the open element; the element is left when the next event is read. */
  private [END_TAG_EVENT](): EventType {
    const elementDepth = this.#elements.depth - 1;
    if (elementDepth < this.#entities.entityStartDepth) this[FAIL_END_TAG](elementDepth);
    const tokenizer = this.tokenizer;
    if (
      this.#options.checkWellFormedness &&
      !tokenizer.endTagMatchesOpenElement &&
      !this.#elements.endTagMatches(elementDepth, tokenizer)
    ) {
      this[FAIL_END_TAG](elementDepth);
    }
    this.#leavePending = true;
    return EventType.END_ELEMENT;
  }

  /** Throws for an end tag with no start tag, one that closes an element an entity didn't open, or one that doesn't match. */
  private [FAIL_END_TAG](elementDepth: number): never {
    if (elementDepth < 0) this[FAIL](ErrorCode.WF_END_TAG_MISMATCH, 'An end tag has no matching start tag');
    if (elementDepth < this.#entities.entityStartDepth) {
      this[FAIL](ErrorCode.WF_ENTITY_CONTENT, 'An entity cannot end an element that started outside it');
    }
    const tokenizer = this.tokenizer;
    return this[FAIL](
      ErrorCode.WF_END_TAG_MISMATCH,
      `Expected </${this.#elements.nameAt(elementDepth, tokenizer)}>`,
      tokenizer.nameStart
    );
  }

  /** Closes the element whose END_ELEMENT was the last event. */
  private [LEAVE_ELEMENT](): void {
    this.#leavePending = false;
    const elementDepth = this.#elements.leave(this.tokenizer, this.#entities.entityStartDepth);
    this.#scopes.leave(elementDepth);
  }

  /** Puts back the element whose end was the last event, which a call that then failed had left. */
  private [REENTER_ELEMENT](): void {
    const elementDepth = this.#elements.reenter();
    this.#leavePending = true;
    this.#scopes.reenter(elementDepth);
  }

  /** The DOCTYPE's event, after reading the DTD; it may come only once, before the root element. */
  private [DOCTYPE_EVENT](): EventType {
    if (!this.#elements.inProlog || this.#doctypeRead) {
      this[FAIL](ErrorCode.WF_DOCTYPE_MISPLACED, 'The DOCTYPE must come once, before the root element');
    }
    if (this.#options.disallowDoctype) {
      this[FAIL](ErrorCode.DOCTYPE_DISALLOWED, 'This parser does not accept a DOCTYPE');
    }
    if (!this[READ_DTD]()) return this[AWAIT_RESOLVER](Token.DOCTYPE);
    this.#doctypeRead = true;
    return EventType.DTD;
  }

  /** Reads the DTD; an asynchronous reader reads it again each time a resolver answers, and returns false while one has yet to. */
  private [READ_DTD](): boolean {
    const tokenizer = this.tokenizer;
    // Current from the start, so that a DTD that fails part-way reports what it declared.
    const store = new DeclarationStore();
    this.store = store;
    if (!this.#async) {
      this.#dtd.load(tokenizer, store, this.#expander.external, this.#expander.counter);
      return true;
    }
    // Read again from the start, the DTD's expansions are counted again too.
    this.#expander.restartCounts();
    return this.#dtd.loadAgain(tokenizer, store, this.#expander.external, this.#expander.counter);
  }

  /** What the end of the current text means: the end of an entity, or of the document if every element is closed. */
  private [END_OF_INPUT](): EventType | undefined {
    if (this.#entities.depth > 0) return this[END_ENTITY]();
    if (this.#elements.inProlog) this[FAIL](ErrorCode.WF_EMPTY_DOCUMENT, 'The document has no root element');
    if (this.#elements.depth > 0) {
      this[FAIL](
        ErrorCode.WF_UNCLOSED_ELEMENT,
        `The element ${this.#elements.nameAt(this.#elements.depth - 1, this.tokenizer)} is not closed`
      );
    }
    this.#entities.document.lines.finish();
    return EventType.END_DOCUMENT;
  }

  /** A reference in content, which the expander expands or reports; NEED_INPUT waits for a resolver and reads it again. */
  private [REFERENCE_EVENT](): EventType | undefined {
    let event;
    try {
      event = this.#expander.expandReference(this.store, this.offset);
    } finally {
      this.tokenizer = this.#entities.current;
    }
    if (event === EventType.CHARACTERS) this.literalText = this.#expander.literalText;
    return event === EventType.NEED_INPUT ? this[AWAIT_RESOLVER](Token.ENTITY_REFERENCE) : event;
  }

  /** Reads on around an entity whose text has ended; the reference to it comes now if only the validator saw it expand. */
  private [END_ENTITY](): EventType | undefined {
    let event;
    try {
      event = this.#expander.endEntity();
    } finally {
      this.tokenizer = this.#entities.current;
    }
    if (event !== undefined) this.offset = this.#expander.hiddenOffset;
    return event;
  }

  /** Throws a fatal error at an index in the current text, the current token's start by default. */
  private [FAIL](code: ErrorCode, message: string, index?: number): never {
    return fail(this.tokenizer, code, message, index);
  }
}
