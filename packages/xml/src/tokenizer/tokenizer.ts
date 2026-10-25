import { ErrorCode } from '../errors/codes.ts';
import type { ChunkSource } from '../input/source.ts';
import { TABLES_XML_10, TABLES_XML_11, TABLES_REPLACEMENT_TEXT } from '../scan/classes.ts';
import {
  MORE,
  scanError,
  ScanFlag,
  type ScanState,
  Terminator,
  type TerminatorKind,
  scanAttributeValue,
  scanName,
  scanText,
  skipSpacesTabsAndLineFeeds,
  scanTo,
} from '../scan/scanner.ts';
import { grown } from '../util/arrays.ts';
import { Char, isChar } from '../util/chars.ts';
import {
  CHARACTER_REFERENCE_OPEN_LENGTH,
  HEX_REFERENCE_OPEN_LENGTH,
  PREDEFINED_ENTITIES,
  readDigits,
} from '../util/references.ts';
import { ChunkReader } from './chunk-reader.ts';
import {
  couldStartDeclaration,
  type Declaration,
  DECLARATION_START_LENGTH,
  DeclarationParser,
  startsWithDeclaration,
} from './declaration.ts';
import { DoctypeToken } from './doctype.ts';
import { LineCounter } from './lines.ts';
import { Needle, SearchCache } from './search.ts';
import {
  bufferEnded,
  CDATA_CLOSE_LENGTH,
  CDATA_OPEN_LENGTH,
  COMMENT_OPEN_LENGTH,
  couldBecomeWord,
  EMPTY_TAG_CLOSE_LENGTH,
  END_TAG_OPEN_LENGTH,
  PI_CLOSE_LENGTH,
  PI_OPEN_LENGTH,
  scanCommentClose,
  scanRequiredName,
  skipWhitespace,
  throwUnexpected,
  XML_DECLARATION_OPEN_LENGTH,
} from './syntax.ts';

// Keys of the private methods: symbols rather than #names, which V8 optimizes less well on the hot path.
const DECLARATION_PENDING: unique symbol = Symbol('declarationPending');
const REPORT_NEED_INPUT: unique symbol = Symbol('reportNeedInput');
const FILL: unique symbol = Symbol('fill');
const DROP_BEFORE_TOKEN: unique symbol = Symbol('dropBeforeToken');
const FIND_TEXT_END: unique symbol = Symbol('findTextEnd');
const FIND_ORDINARY_TEXT_END: unique symbol = Symbol('findOrdinaryTextEnd');
const SEARCH_TEXT_END: unique symbol = Symbol('searchTextEnd');
const FIND_VALUE_END: unique symbol = Symbol('findValueEnd');
const FIND_DATA_END: unique symbol = Symbol('findDataEnd');
const CHECK_DATA_BEFORE: unique symbol = Symbol('checkDataBefore');
const SCAN_TOKEN: unique symbol = Symbol('scanToken');
const SCAN_TEXT_TOKEN: unique symbol = Symbol('scanTextToken');
const SCAN_TEXT_FROM: unique symbol = Symbol('scanTextFrom');
const END_TEXT_TOKEN: unique symbol = Symbol('endTextToken');
const ENTITY_REFERENCE_TOKEN: unique symbol = Symbol('entityReferenceToken');
const SCAN_REFERENCE: unique symbol = Symbol('scanReference');
const SCAN_CHARACTER_REFERENCE: unique symbol = Symbol('scanCharacterReference');
const SCAN_MARKUP: unique symbol = Symbol('scanMarkup');
const SCAN_COMMENT_CDATA_OR_DOCTYPE: unique symbol = Symbol('scanCommentCdataOrDoctype');
const SCAN_START_TAG: unique symbol = Symbol('scanStartTag');
const END_START_TAG: unique symbol = Symbol('endStartTag');
const SCAN_ATTRIBUTES: unique symbol = Symbol('scanAttributes');
const SKIP_ATTRIBUTE_SEPARATOR: unique symbol = Symbol('skipAttributeSeparator');
const SCAN_START_TAG_END: unique symbol = Symbol('scanStartTagEnd');
const SCAN_ATTRIBUTE: unique symbol = Symbol('scanAttribute');
const SCAN_QUOTED_VALUE: unique symbol = Symbol('scanQuotedValue');
const RECORD_ATTRIBUTE: unique symbol = Symbol('recordAttribute');
const GROW_ATTRIBUTE_ARRAYS: unique symbol = Symbol('growAttributeArrays');
const SCAN_END_TAG: unique symbol = Symbol('scanEndTag');
const SCAN_END_TAG_FULLY: unique symbol = Symbol('scanEndTagFully');
const SCAN_PI: unique symbol = Symbol('scanPi');
const SCAN_COMMENT: unique symbol = Symbol('scanComment');
const SCAN_CDATA: unique symbol = Symbol('scanCdata');
const END_CONTENT_TOKEN: unique symbol = Symbol('endContentToken');
const SCAN_DOCTYPE: unique symbol = Symbol('scanDoctype');

// Module-level constants, so V8 can inline them; imported bindings are read again on every use.
const { TAB, LINE_FEED, CARRIAGE_RETURN, SPACE, EXCLAMATION, DOUBLE_QUOTE, HASH, AMPERSAND } = Char;
const { APOSTROPHE, SLASH, SEMICOLON, LESS_THAN, EQUALS, GREATER_THAN, QUESTION } = Char;
const { LOWER_X, NON_ASCII, NEXT_LINE, LINE_SEPARATOR } = Char;

/** The kinds of token the tokenizer produces. */
export const Token = {
  START_TAG: 1,
  END_TAG: 2,
  /** Character data, which may include character references and references to the predefined entities. */
  TEXT: 3,
  CDATA: 4,
  COMMENT: 5,
  PI: 6,
  DOCTYPE: 7,
  /** A reference to an entity that is neither predefined nor a character reference, such as `&chapter;`. */
  ENTITY_REFERENCE: 8,
  /** The end of the input. */
  END: 9,
  /** More input has yet to arrive from an asynchronous source. */
  NEED_INPUT: 10,
} as const;

/** One of the token kinds. */
export type TokenKind = (typeof Token)[keyof typeof Token];

/** The needle that ends a comment, a PI and a CDATA section, by terminator. */
const TERMINATOR_NEEDLES = [Needle.DOUBLE_HYPHEN, Needle.PI_END, Needle.CDATA_END];

/** The attribute arrays before a start tag needs them; growing replaces it, so tokenizers can share it. */
const NO_ATTRIBUTES = new Int32Array(0);

/** The markup that can start with `<!`. */
const COMMENT_CDATA_DOCTYPE_OPENERS = ['<!--', '<![CDATA[', '<!DOCTYPE'];

/**
 * A code unit XML 1.0 never allows literally, or a surrogate, which the character scan must check
 * is paired. The fast paths hand any stretch holding one to the character scan.
 */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const FORBIDDEN_OR_SURROGATE_XML_10 = /[\0-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/;
/** A run of ordinary XML 1.0 character data, which needs no handling: no `<`, `&`, `]`, CR, nor what FORBIDDEN_OR_SURROGATE_XML_10 finds. */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const ORDINARY_TEXT_RUN_XML_10 = /[^<&\]\r\0-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]*/y;
/** What FORBIDDEN_OR_SURROGATE_XML_10 finds, or a CR. */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const FORBIDDEN_SURROGATE_OR_CR_XML_10 = /[\0-\u0008\u000B-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/;
/** A code unit above U+00FF, without which V8 keeps the buffer at one byte a character. */
const ABOVE_LATIN_1 = /[\u0100-\uFFFF]/;
/**
 * Runs of ordinary XML 1.0 attribute values, one for each quote: no closing quote, `&`, `<`,
 * whitespace to normalize, nor what FORBIDDEN_OR_SURROGATE_XML_10 finds.
 */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const ORDINARY_DOUBLE_QUOTED_RUN_XML_10 = /[^"&<\0-\u001F\uD800-\uDFFF\uFFFE\uFFFF]*/y;
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const ORDINARY_SINGLE_QUOTED_RUN_XML_10 = /[^'&<\0-\u001F\uD800-\uDFFF\uFFFE\uFFFF]*/y;

/** The capacity an attribute array starts at when it first grows. */
const FIRST_CAPACITY = 16;

/** Whether buffer indexes `[start, end)` hold what FORBIDDEN_OR_SURROGATE_XML_10 finds. */
function hasForbiddenOrSurrogate(text: string, start: number, end: number): boolean {
  return end > start && FORBIDDEN_OR_SURROGATE_XML_10.test(text.slice(start, end));
}

/** Where a sticky pattern's match from `start` ends, or `start` if it doesn't match there. */
function matchEnd(pattern: RegExp, text: string, start: number): number {
  pattern.lastIndex = start;
  return pattern.test(text) ? pattern.lastIndex : start;
}

/** Settings the tokenizer needs. */
export interface TokenizerOptions {
  /** The longest name allowed, from `limits.nameLength`. */
  readonly maxNameLength: number;
  /** The text is an entity's replacement text: its line ends are not normalized again and its characters were checked. */
  readonly replacementText?: boolean;
  /** The text is an external entity, which may start with a text declaration rather than an XML declaration. */
  readonly textDeclaration?: boolean;
  /** The document's version, for an entity of it; otherwise the XML declaration decides. */
  readonly version11?: boolean;
}

/**
 * Splits decoded text into tokens: start tags, end tags, runs of text, comments, PIs, CDATA
 * sections, the DOCTYPE, and references to entities.
 *
 * The tokenizer never builds strings. It records where each part of a token is in its buffer,
 * and the cursor slices out only what it needs. After `next()` returns a kind, these fields
 * describe the token:
 *
 * - START_TAG: `nameStart`/`nameEnd`, `selfClosing`, and `attributeCount` entries in the
 *   `attribute…` arrays, one per attribute.
 * - END_TAG: `nameStart`/`nameEnd`, and `endTagMatchesOpenElement`.
 * - TEXT, CDATA, COMMENT: `valueStart`/`valueEnd` and `valueFlags`.
 * - PI: the target in `nameStart`/`nameEnd`, the data in `valueStart`/`valueEnd`.
 * - DOCTYPE: the name in `nameStart`/`nameEnd`, the rest in `doctype`.
 * - ENTITY_REFERENCE: the entity's name in `nameStart`/`nameEnd`.
 *
 * Positions are buffer indexes. `buffer` holds the part of the document not yet consumed: text
 * before the current token is dropped as chunks arrive, and `bufferOffset` is the document
 * offset of the buffer's first character.
 *
 * When a token runs past the end of the buffer, the scans return MORE (see `syntax.ts`) and
 * `next()` fills the buffer and scans the token again. If an asynchronous source has nothing yet,
 * `next()` returns NEED_INPUT, and the next call carries on.
 *
 * XML 1.0 text, attribute values and comments take fast paths: native searches and regular
 * expressions that skip characters needing no check. XML 1.1 allows more characters and line
 * ends, so it always goes through the character scan in `scan/scanner.ts`.
 */
export class Tokenizer implements ScanState {
  /** The part of the document not yet dropped. */
  buffer = '';
  /** The document offset of the buffer's first character. */
  bufferOffset = 0;
  /** Whether the source has no more text to give. */
  final = false;
  version11 = false;
  /** The character classes the scanner checks text against: XML 1.0, XML 1.1, or replacement text's. */
  tables = TABLES_XML_10;
  /** ScanFlag bits the current scan has set. */
  flags = 0;
  /** The index of the first colon in the last name scanned, or -1. */
  firstColon = -1;
  /** How many colons the last name scanned held. */
  colonCount = 0;

  /** Where the next token starts, as a buffer index. */
  nextTokenStart = 0;
  /** The kind of the token `next()` returned last, or 0 before the first. */
  kind: TokenKind | 0 = 0;
  /** Where the current token starts, as a buffer index. */
  tokenStart = 0;

  /** The current token's name: an element name, PI target, DOCTYPE name or entity name. */
  nameStart = 0;
  nameEnd = 0;
  /** The index of the first colon in that name, or -1, and how many colons it holds. */
  nameFirstColon = -1;
  nameColonCount = 0;
  /** The current token's content: text, CDATA, a comment or a PI's data. */
  valueStart = 0;
  valueEnd = 0;
  /** The ScanFlag bits found in that content, such as CR, which line-end normalization must handle. */
  valueFlags = 0;
  /** Whether the start tag ended with `/>`. */
  selfClosing = false;
  /** The document offset and length of the open element's name, when this tokenizer read its start tag; length -1 if not. */
  openElementNameOffset = 0;
  openElementNameLength = -1;
  /** Whether the last end tag repeated that name, so it needs no other comparison. */
  endTagMatchesOpenElement = false;

  /** How many attributes the start tag has. */
  attributeCount = 0;
  /** The ScanFlag bits of all the start tag's attributes, or-ed together. */
  allAttributeFlags = 0;
  /**
   * The start tag's attributes, one entry per attribute in parallel arrays: the name's span and its
   * colons, the value's span, and the ScanFlag bits found in the value. They are allocated on the
   * first attribute, so a tokenizer for replacement text without attributes allocates none.
   */
  attributeNameStart = NO_ATTRIBUTES;
  attributeNameEnd = NO_ATTRIBUTES;
  attributeFirstColon = NO_ATTRIBUTES;
  attributeColonCount = NO_ATTRIBUTES;
  attributeValueStart = NO_ATTRIBUTES;
  attributeValueEnd = NO_ATTRIBUTES;
  attributeFlags = NO_ATTRIBUTES;

  /** The XML or text declaration the text starts with, once `readDeclaration()` has read it. */
  declaration: Declaration | undefined;
  /** The DOCTYPE token's external identifier and internal subset. */
  readonly doctype = new DoctypeToken();
  /** The lines of the text, counted when a location is asked for. */
  readonly lines: LineCounter;
  /** Whether the text is replacement text, whose line ends are not normalized again. */
  readonly isReplacementText: boolean;
  readonly maxNameLength: number;
  /** Called with a document offset before the text in front of it is dropped from the buffer. */
  onDrop: ((offset: number) => void) | undefined;

  readonly #options: TokenizerOptions;
  readonly #chunks: ChunkReader;
  /** Where the fast paths' needles next occur in the buffer. */
  readonly #search = new SearchCache();
  /** Whether `readDeclaration()` has read the declaration, or found there is none. */
  #declarationRead = false;
  /** Whether the last fill ran out of input before the token could be scanned again, so the next call fills first. */
  #waitingForInput = false;
  /** Whether character references follow XML 1.1's Char, which allows the C0 controls. */
  #characterReferences11 = false;
  /** Whether no chunk has held a code unit above U+00FF, so native searches beat the ordinary-run pattern. */
  #allOneByte = true;

  constructor(source: ChunkSource, options: TokenizerOptions) {
    this.#options = options;
    this.#chunks = new ChunkReader(source);
    this.lines = new LineCounter(this, this.#search);
    this.maxNameLength = options.maxNameLength;
    this.isReplacementText = options.replacementText === true;
    if (options.version11 === true) this.#useVersion11();
    else if (this.isReplacementText) this.tables = TABLES_REPLACEMENT_TEXT;
  }

  /** Switches to XML 1.1's rules; replacement text keeps its own character classes and line ends. */
  #useVersion11(): void {
    this.version11 = !this.isReplacementText;
    this.#characterReferences11 = true;
    this.tables = this.isReplacementText ? TABLES_REPLACEMENT_TEXT : TABLES_XML_11;
  }

  /** Starts over on new text, keeping the arrays already grown, to tokenize another entity's replacement text. */
  reset(source: ChunkSource): this {
    this.#chunks.reset(source);
    this.#waitingForInput = false;
    this.buffer = '';
    this.bufferOffset = 0;
    this.final = false;
    this.flags = 0;
    this.nextTokenStart = 0;
    this.kind = 0;
    this.tokenStart = 0;
    this.attributeCount = 0;
    this.allAttributeFlags = 0;
    this.openElementNameLength = -1;
    this.declaration = undefined;
    this.#declarationRead = false;
    this.#search.clear();
    this.lines.reset();
    this.#allOneByte = true;
    return this;
  }

  /** Reads the XML declaration, if the document starts with one; returns false while input is pending. */
  readDeclaration(): boolean {
    if (this.#declarationRead) return true;
    while (!this.final && this[DECLARATION_PENDING]()) {
      if (!this.#chunks.read(this)) return false;
    }
    this.#declarationRead = true;
    const text = this.buffer;
    if (this.isReplacementText || !startsWithDeclaration(text)) return true;
    this.tokenStart = 0;
    const parser = new DeclarationParser(text, 0);
    this.declaration = parser.parse(this.#options.textDeclaration === true ? 'text' : 'xml');
    this.nextTokenStart = parser.end;
    if (this.declaration.version === '1.1' && this.#options.version11 === undefined) this.#useVersion11();
    return true;
  }

  /** Whether the buffer may begin an XML declaration that has not all arrived. */
  private [DECLARATION_PENDING](): boolean {
    const text = this.buffer;
    // Short replacement text is read to its end here, which spares its last token a rescan.
    if (text.length < DECLARATION_START_LENGTH) return this.isReplacementText || couldStartDeclaration(text);
    return startsWithDeclaration(text) && !text.includes('?>');
  }

  /** Reads the next token, pulling more text when a token runs past the buffer. */
  next(): TokenKind {
    if (this.#waitingForInput && !this[FILL]()) return this[REPORT_NEED_INPUT]();
    for (;;) {
      this.tokenStart = this.nextTokenStart;
      this.flags = 0;
      const kind = this[SCAN_TOKEN]();
      if (kind !== MORE) {
        this.kind = kind;
        return kind;
      }
      this.nextTokenStart = this.tokenStart;
      if (!this[FILL]()) return this[REPORT_NEED_INPUT]();
    }
  }

  /** Reports that the source has nothing more yet. */
  private [REPORT_NEED_INPUT](): TokenKind {
    this.kind = Token.NEED_INPUT;
    return Token.NEED_INPUT;
  }

  /** Fills the buffer to scan the current token again; false while the source has nothing yet. */
  private [FILL](): boolean {
    this.#waitingForInput = !this.#chunks.fill(this);
    return !this.#waitingForInput;
  }

  /** Appends a chunk to the buffer, dropping the text before the current token first. */
  append(chunk: string): void {
    this[DROP_BEFORE_TOKEN]();
    this.buffer += chunk;
    if (this.#allOneByte && ABOVE_LATIN_1.test(chunk)) this.#allOneByte = false;
    this.#search.clear();
  }

  /** Notes that the source has no more text. */
  markFinal(): void {
    this.final = true;
  }

  /** Records the name a scan has just read, from `start` to `end`, with the colons the scan counted in it. */
  recordName(start: number, end: number): void {
    this.nameStart = start;
    this.nameEnd = end;
    this.nameFirstColon = this.firstColon;
    this.nameColonCount = this.colonCount;
  }

  /** Drops the text before the current token, which no token needs again. */
  private [DROP_BEFORE_TOKEN](): void {
    const dropped = this.tokenStart;
    if (dropped === 0) return;
    this.onDrop?.(this.bufferOffset + dropped);
    this.lines.drop(dropped);
    this.buffer = this.buffer.slice(dropped);
    this.bufferOffset += dropped;
    this.nextTokenStart -= dropped;
    this.tokenStart = 0;
  }

  /** Finds where character data from `start` stops, at `<`, `&` or the end of the input; MORE when more text may follow. */
  private [FIND_TEXT_END](start: number): number {
    if (this.version11) return scanText(this, start);
    const text = this.buffer;
    // Once a run needs checking, the rest of it stays on the ordinary runs, so no search goes over it twice.
    let pos = this.#allOneByte ? this[SEARCH_TEXT_END](start) : this[FIND_ORDINARY_TEXT_END](start);
    for (;;) {
      if (pos >= text.length) return this.final ? pos : MORE;
      // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
      const char = text.charCodeAt(pos);
      if (char === LESS_THAN || char === AMPERSAND) return pos;
      // The character scan takes the one code unit the ordinary run stopped at.
      pos = scanText(this, pos, pos + 1);
      if (pos === MORE) return MORE;
      pos = this[FIND_ORDINARY_TEXT_END](pos);
    }
  }

  /** Where the ordinary run of character data from `start` stops: the first code unit that needs handling. */
  private [FIND_ORDINARY_TEXT_END](start: number): number {
    return matchEnd(ORDINARY_TEXT_RUN_XML_10, this.buffer, start);
  }

  /**
   * As `[FIND_ORDINARY_TEXT_END]`, but by native searches for `<` and `&`, which are faster on one-byte
   * text. Falls back to the ordinary run if the stretch holds `]]>` or anything that needs checking.
   */
  private [SEARCH_TEXT_END](start: number): number {
    const text = this.buffer;
    const search = this.#search;
    const stop = Math.min(
      search.find(text, Needle.LESS_THAN, start),
      search.find(text, Needle.AMPERSAND, start),
      text.length
    );
    if (search.find(text, Needle.CDATA_END, start) < stop || hasForbiddenOrSurrogate(text, start, stop)) {
      return this[FIND_ORDINARY_TEXT_END](start);
    }
    if (!this.isReplacementText && search.find(text, Needle.CARRIAGE_RETURN, start) < stop) this.flags |= ScanFlag.CR;
    return stop;
  }

  /** Finds where an attribute value from `start` stops, at its closing quote or `&`; MORE when it runs past the buffer. */
  private [FIND_VALUE_END](start: number, quote: number): number {
    if (this.version11) return scanAttributeValue(this, start, quote);
    const text = this.buffer;
    const ordinaryRun = quote === DOUBLE_QUOTE ? ORDINARY_DOUBLE_QUOTED_RUN_XML_10 : ORDINARY_SINGLE_QUOTED_RUN_XML_10;
    let pos = start;
    for (;;) {
      pos = matchEnd(ordinaryRun, text, pos);
      if (pos >= text.length) return MORE;
      // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
      const char = text.charCodeAt(pos);
      if (char === quote || char === AMPERSAND) return pos;
      // The character scan takes the one code unit the ordinary run stopped at.
      pos = scanAttributeValue(this, pos, quote, pos + 1);
      if (pos === MORE) return MORE;
    }
  }

  /** Finds the end of a comment, PI or CDATA section's content from `start`: its `--`, `?>` or `]]>`; MORE when it isn't buffered yet. */
  private [FIND_DATA_END](start: number, terminator: TerminatorKind): number {
    if (this.version11) return scanTo(this, start, terminator);
    const end = this.#search.find(this.buffer, TERMINATOR_NEEDLES[terminator] as number, start);
    if (end >= this.buffer.length) return MORE;
    if (end > start && FORBIDDEN_SURROGATE_OR_CR_XML_10.test(this.buffer.slice(start, end))) {
      return this[CHECK_DATA_BEFORE](start, terminator, end);
    }
    return end;
  }

  /** Checks content the quick test flagged: by the character scan if it holds something to check, else it only holds a CR. */
  private [CHECK_DATA_BEFORE](start: number, terminator: TerminatorKind, end: number): number {
    if (hasForbiddenOrSurrogate(this.buffer, start, end)) return scanTo(this, start, terminator);
    this.flags |= ScanFlag.CR;
    return end;
  }

  /** Recognizes the token at `nextTokenStart` from its first character. */
  private [SCAN_TOKEN](): TokenKind | typeof MORE {
    const start = this.nextTokenStart;
    if (start >= this.buffer.length) return this.final ? Token.END : MORE;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    return this.buffer.charCodeAt(start) === LESS_THAN ? this[SCAN_MARKUP](start) : this[SCAN_TEXT_TOKEN](start);
  }

  /** Scans character data, which runs over character and predefined references up to markup or another reference. */
  private [SCAN_TEXT_TOKEN](start: number): TokenKind | typeof MORE {
    this.valueStart = start;
    // Indentation between tags is common, and every text table classes it as ordinary.
    const blankEnd = skipSpacesTabsAndLineFeeds(this.buffer, start);
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const onlyBlankBeforeTag = blankEnd < this.buffer.length && this.buffer.charCodeAt(blankEnd) === LESS_THAN;
    return onlyBlankBeforeTag ? this[END_TEXT_TOKEN](blankEnd) : this[SCAN_TEXT_FROM](start, blankEnd);
  }

  /** Scans character data and its references on from `from`, in a text token that began at `start`. */
  private [SCAN_TEXT_FROM](start: number, from: number): TokenKind | typeof MORE {
    let pos = from;
    for (;;) {
      pos = this[FIND_TEXT_END](pos);
      if (pos === MORE) return MORE;
      // A read past the end would make V8 call charCodeAt generically here from then on.
      // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
      if (pos >= this.buffer.length || this.buffer.charCodeAt(pos) !== AMPERSAND) break;
      const afterReference = this[SCAN_REFERENCE](pos);
      if (afterReference === MORE) return MORE;
      if (afterReference < 0) {
        // An entity reference is a token of its own: end the text before it, or return it.
        if (pos > start) break;
        return this[ENTITY_REFERENCE_TOKEN](pos, -afterReference);
      }
      this.flags |= ScanFlag.REFERENCE;
      pos = afterReference;
    }
    return this[END_TEXT_TOKEN](pos);
  }

  /** Ends a text token at `end`. */
  private [END_TEXT_TOKEN](end: number): TokenKind {
    this.valueEnd = end;
    this.valueFlags = this.flags;
    this.nextTokenStart = end;
    return Token.TEXT;
  }

  /** Records the entity reference from the `&` at `ampersand` to `afterSemicolon`. */
  private [ENTITY_REFERENCE_TOKEN](ampersand: number, afterSemicolon: number): TokenKind {
    this.recordName(ampersand + 1, afterSemicolon - 1);
    this.nextTokenStart = afterSemicolon;
    return Token.ENTITY_REFERENCE;
  }

  /**
   * Scans a reference at the `&` at `ampersand`. Returns the index after its `;`, negated when it
   * names an entity other than the predefined ones, or MORE. The sign carries that answer so
   * the hot text loop needs no second result.
   */
  private [SCAN_REFERENCE](ampersand: number): number {
    const text = this.buffer;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (text.charCodeAt(ampersand + 1) === HASH) return this[SCAN_CHARACTER_REFERENCE](ampersand);
    const nameEnd = scanName(this, ampersand + 1);
    if (nameEnd === MORE) return MORE;
    if (nameEnd === ampersand + 1) throw scanError(ErrorCode.WF_REFERENCE, ampersand, 'Expected a name or # after &');
    if (nameEnd >= text.length) return bufferEnded(this, ampersand, 'Unterminated reference');
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const hasSemicolon = text.charCodeAt(nameEnd) === SEMICOLON;
    if (!hasSemicolon) throw scanError(ErrorCode.WF_REFERENCE, nameEnd, 'Expected ; to end the reference');
    const namesEntity = this.colonCount !== 0 || !PREDEFINED_ENTITIES.has(text.slice(ampersand + 1, nameEnd));
    return namesEntity ? -(nameEnd + 1) : nameEnd + 1;
  }

  /** Scans `&#…;` or `&#x…;` at `ampersand`, checking that it names a Char; returns the index after it, or MORE. */
  private [SCAN_CHARACTER_REFERENCE](ampersand: number): number {
    const text = this.buffer;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const isHex = text.charCodeAt(ampersand + CHARACTER_REFERENCE_OPEN_LENGTH) === LOWER_X;
    const digitsStart = ampersand + (isHex ? HEX_REFERENCE_OPEN_LENGTH : CHARACTER_REFERENCE_OPEN_LENGTH);
    const [digitsEnd, value] = readDigits(text, digitsStart, isHex);
    if (digitsEnd >= text.length) return bufferEnded(this, ampersand, 'Unterminated reference');
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const malformed = digitsEnd === digitsStart || text.charCodeAt(digitsEnd) !== SEMICOLON;
    if (malformed) {
      throw scanError(ErrorCode.WF_CHARACTER_REFERENCE, ampersand, 'Malformed character reference');
    }
    if (!isChar(value, this.#characterReferences11)) {
      throw scanError(ErrorCode.WF_CHARACTER_REFERENCE, ampersand, `&#${value}; does not refer to a legal character`);
    }
    return digitsEnd + 1;
  }

  /** Recognizes the markup that starts with the `<` at `lessThan`, from the character after it. */
  private [SCAN_MARKUP](lessThan: number): TokenKind | typeof MORE {
    // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
    const afterLessThan = this.buffer.charCodeAt(lessThan + 1);
    if (Number.isNaN(afterLessThan)) return bufferEnded(this, lessThan, 'Unexpected end after <');
    if (afterLessThan === SLASH) return this[SCAN_END_TAG](lessThan);
    if (afterLessThan === QUESTION) return this[SCAN_PI](lessThan);
    if (afterLessThan !== EXCLAMATION) return this[SCAN_START_TAG](lessThan);
    return this[SCAN_COMMENT_CDATA_OR_DOCTYPE](lessThan);
  }

  /** Recognizes a comment, CDATA section or DOCTYPE from its `<!`. */
  private [SCAN_COMMENT_CDATA_OR_DOCTYPE](lessThan: number): TokenKind | typeof MORE {
    const text = this.buffer;
    if (text.startsWith('<!--', lessThan)) return this[SCAN_COMMENT](lessThan);
    if (text.startsWith('<![CDATA[', lessThan)) return this[SCAN_CDATA](lessThan);
    if (text.startsWith('<!DOCTYPE', lessThan)) return this[SCAN_DOCTYPE](lessThan);
    if (couldBecomeWord(this, lessThan, COMMENT_CDATA_DOCTYPE_OPENERS)) return MORE;
    throw scanError(ErrorCode.WF_MARKUP, lessThan, 'Unrecognized markup after <!');
  }

  /** Scans `<name attributes… >` or `<name… />`. */
  private [SCAN_START_TAG](lessThan: number): TokenKind | typeof MORE {
    const nameEnd = scanRequiredName(this, lessThan + 1, ErrorCode.WF_NAME, 'an element name');
    if (nameEnd === MORE) return MORE;
    this.nameStart = lessThan + 1;
    this.nameEnd = nameEnd;
    this.nameFirstColon = this.firstColon;
    this.nameColonCount = this.colonCount;
    this.attributeCount = 0;
    this.allAttributeFlags = 0;
    // Most start tags have no attributes, and these touch none of the attribute state.
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const afterName = this.buffer.charCodeAt(nameEnd);
    if (afterName === GREATER_THAN) return this[END_START_TAG](nameEnd + 1, false);
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (afterName === SLASH && this.buffer.charCodeAt(nameEnd + 1) === GREATER_THAN) {
      return this[END_START_TAG](nameEnd + EMPTY_TAG_CLOSE_LENGTH, true);
    }
    return this[SCAN_ATTRIBUTES](nameEnd);
  }

  /** Ends a start tag, with the next token at `next`. */
  private [END_START_TAG](next: number, selfClosing: boolean): TokenKind {
    this.selfClosing = selfClosing;
    this.nextTokenStart = next;
    return Token.START_TAG;
  }

  /** Scans a start tag's attributes from `nameEnd`, just after the element name, to the tag's end. */
  private [SCAN_ATTRIBUTES](nameEnd: number): TokenKind | typeof MORE {
    const text = this.buffer;
    let pos = nameEnd;
    for (;;) {
      const beforeSeparator = pos;
      pos = this[SKIP_ATTRIBUTE_SEPARATOR](pos);
      if (pos === MORE) return MORE;
      // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
      const char = text.charCodeAt(pos);
      if (char === GREATER_THAN || char === SLASH) return this[SCAN_START_TAG_END](pos, char);
      if (Number.isNaN(char)) return bufferEnded(this, pos, 'Unexpected end in a start tag');
      if (pos === beforeSeparator)
        throw scanError(ErrorCode.WF_TAG, pos, 'Expected whitespace, > or /> in a start tag');
      pos = this[SCAN_ATTRIBUTE](pos);
      if (pos === MORE) return MORE;
    }
  }

  /** Skips the whitespace before an attribute or the tag's end; a single space takes the quick path. */
  private [SKIP_ATTRIBUTE_SEPARATOR](start: number): number {
    const text = this.buffer;
    // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
    const first = text.charCodeAt(start);
    // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
    if (first === SPACE && text.charCodeAt(start + 1) > SPACE) return start + 1;
    return first <= SPACE || first === NEXT_LINE || first === LINE_SEPARATOR ? skipWhitespace(this, start) : start;
  }

  /** Scans the `>` or `/>` at `pos` that ends a start tag; `char` is the code unit there. */
  private [SCAN_START_TAG_END](pos: number, char: number): TokenKind | typeof MORE {
    if (char === GREATER_THAN) {
      this.selfClosing = false;
      this.nextTokenStart = pos + 1;
      return Token.START_TAG;
    }
    // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
    const afterSlash = this.buffer.charCodeAt(pos + 1);
    if (Number.isNaN(afterSlash)) return bufferEnded(this, pos, 'Unexpected end in a start tag');
    if (afterSlash !== GREATER_THAN) throw scanError(ErrorCode.WF_TAG, pos, 'Expected > after /');
    this.selfClosing = true;
    this.nextTokenStart = pos + EMPTY_TAG_CLOSE_LENGTH;
    return Token.START_TAG;
  }

  /** Scans `name = "value"` at `nameStart` and records it; returns the index after it, or MORE. */
  private [SCAN_ATTRIBUTE](nameStart: number): number {
    const nameEnd = scanRequiredName(this, nameStart, ErrorCode.WF_TAG, 'an attribute name, > or />');
    if (nameEnd === MORE) return MORE;
    const colon = this.firstColon;
    const colons = this.colonCount;
    const text = this.buffer;
    // Most attributes have no whitespace around `=`.
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    let pos = text.charCodeAt(nameEnd) === EQUALS ? nameEnd : skipWhitespace(this, nameEnd);
    if (pos === MORE) return MORE;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (text.charCodeAt(pos) !== EQUALS) {
      return throwUnexpected(this, pos, ErrorCode.WF_ATTRIBUTE, 'Expected = after the attribute name');
    }
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const afterEquals = text.charCodeAt(pos + 1);
    pos = afterEquals === DOUBLE_QUOTE || afterEquals === APOSTROPHE ? pos + 1 : skipWhitespace(this, pos + 1);
    if (pos === MORE) return MORE;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const quote = text.charCodeAt(pos);
    if (quote !== DOUBLE_QUOTE && quote !== APOSTROPHE) {
      return throwUnexpected(this, pos, ErrorCode.WF_ATTRIBUTE, 'Expected a quoted attribute value');
    }
    const valueEnd = this[SCAN_QUOTED_VALUE](pos + 1, quote);
    if (valueEnd === MORE) return MORE;
    this[RECORD_ATTRIBUTE](nameStart, nameEnd, colon, colons, pos + 1, valueEnd);
    return valueEnd + 1;
  }

  /** Scans an attribute value from `start`, just inside its quote, parsing its references; returns the closing quote's index, or MORE. */
  private [SCAN_QUOTED_VALUE](start: number, quote: number): number {
    this.flags = 0;
    let pos = start;
    for (;;) {
      pos = this[FIND_VALUE_END](pos, quote);
      if (pos === MORE) return bufferEnded(this, start, 'Unterminated attribute value');
      // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
      if (this.buffer.charCodeAt(pos) === quote) return pos;
      const afterReference = this[SCAN_REFERENCE](pos);
      if (afterReference === MORE) return MORE;
      this.flags |= afterReference < 0 ? ScanFlag.REFERENCE | ScanFlag.ENTITY : ScanFlag.REFERENCE;
      pos = Math.abs(afterReference);
    }
  }

  /** Records one attribute's spans, growing the arrays when full. */
  private [RECORD_ATTRIBUTE](
    nameStart: number,
    nameEnd: number,
    colon: number,
    colons: number,
    valueStart: number,
    valueEnd: number
  ): void {
    const index = this.attributeCount;
    if (index === this.attributeNameStart.length) this[GROW_ATTRIBUTE_ARRAYS]();
    this.attributeNameStart[index] = nameStart;
    this.attributeNameEnd[index] = nameEnd;
    this.attributeFirstColon[index] = colon;
    this.attributeColonCount[index] = colons;
    this.attributeValueStart[index] = valueStart;
    this.attributeValueEnd[index] = valueEnd;
    this.attributeFlags[index] = this.flags;
    this.allAttributeFlags |= this.flags;
    this.attributeCount = index + 1;
  }

  /** Doubles the capacity of every attribute array, or gives them their first. */
  private [GROW_ATTRIBUTE_ARRAYS](): void {
    this.attributeNameStart = grown(this.attributeNameStart, FIRST_CAPACITY);
    this.attributeNameEnd = grown(this.attributeNameEnd, FIRST_CAPACITY);
    this.attributeFirstColon = grown(this.attributeFirstColon, FIRST_CAPACITY);
    this.attributeColonCount = grown(this.attributeColonCount, FIRST_CAPACITY);
    this.attributeValueStart = grown(this.attributeValueStart, FIRST_CAPACITY);
    this.attributeValueEnd = grown(this.attributeValueEnd, FIRST_CAPACITY);
    this.attributeFlags = grown(this.attributeFlags, FIRST_CAPACITY);
  }

  /**
   * Scans `</name S? >`. Most end tags simply repeat the open element's name, so that case is
   * checked first by comparing code units with the start tag, if it is still in the buffer.
   */
  private [SCAN_END_TAG](lessThan: number): TokenKind | typeof MORE {
    const text = this.buffer;
    const openNameLength = this.openElementNameLength;
    const nameStart = lessThan + END_TAG_OPEN_LENGTH;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const closesAtSameLength = openNameLength > 0 && text.charCodeAt(nameStart + openNameLength) === GREATER_THAN;
    if (closesAtSameLength) {
      const openNameStart = this.openElementNameOffset - this.bufferOffset;
      let matched = 0;
      if (openNameStart >= 0) {
        while (
          matched < openNameLength &&
          // eslint-disable-next-line prefer-code-point -- compares code units
          text.charCodeAt(nameStart + matched) === text.charCodeAt(openNameStart + matched)
        )
          matched++;
      }
      if (matched === openNameLength) {
        this.nameStart = nameStart;
        this.nameEnd = nameStart + openNameLength;
        this.endTagMatchesOpenElement = true;
        this.nextTokenStart = nameStart + openNameLength + 1;
        return Token.END_TAG;
      }
    }
    this.endTagMatchesOpenElement = false;
    return this[SCAN_END_TAG_FULLY](lessThan);
  }

  /** Scans an end tag that doesn't simply repeat the open element's name, reading its name in full. */
  private [SCAN_END_TAG_FULLY](lessThan: number): TokenKind | typeof MORE {
    const text = this.buffer;
    const nameStart = lessThan + END_TAG_OPEN_LENGTH;
    // ASCII names are read here; anything above ASCII goes to scanName, which checks it.
    let nameEnd = nameStart;
    for (; nameEnd < text.length; nameEnd++) {
      // eslint-disable-next-line prefer-code-point -- steps by code unit; scanName checks surrogate pairs
      const char = text.charCodeAt(nameEnd);
      if (
        char === GREATER_THAN ||
        char === SPACE ||
        char === LINE_FEED ||
        char === TAB ||
        char === CARRIAGE_RETURN ||
        char >= NON_ASCII
      )
        break;
    }
    // eslint-disable-next-line prefer-code-point -- anything above ASCII goes to scanName
    if (nameEnd < text.length && text.charCodeAt(nameEnd) >= NON_ASCII) nameEnd = scanName(this, nameStart);
    if (nameEnd === MORE) return MORE;
    if (nameEnd >= text.length) return bufferEnded(this, nameEnd, 'Unexpected end in an end tag');
    if (nameEnd === nameStart) throw scanError(ErrorCode.WF_NAME, nameEnd, 'Expected an element name');
    this.nameStart = nameStart;
    this.nameEnd = nameEnd;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const closeAt = text.charCodeAt(nameEnd) === GREATER_THAN ? nameEnd : skipWhitespace(this, nameEnd);
    if (closeAt === MORE) return MORE;
    // eslint-disable-next-line prefer-code-point -- NaN past the end marks the end
    const char = text.charCodeAt(closeAt);
    if (Number.isNaN(char)) return bufferEnded(this, closeAt, 'Unexpected end in an end tag');
    if (char !== GREATER_THAN) throw scanError(ErrorCode.WF_TAG, closeAt, 'Expected > to end the end tag');
    this.nextTokenStart = closeAt + 1;
    return Token.END_TAG;
  }

  /** Scans `<?target data?>`; the target goes in the name fields and the data in the value fields. */
  private [SCAN_PI](lessThan: number): TokenKind | typeof MORE {
    const targetStart = lessThan + PI_OPEN_LENGTH;
    const targetEnd = scanRequiredName(this, targetStart, ErrorCode.WF_PI, 'a processing instruction target');
    if (targetEnd === MORE) return MORE;
    this.recordName(targetStart, targetEnd);
    // `xml` in any case is reserved, and `<?xml` itself is a declaration that isn't at the start.
    const threeCharacterTarget = targetEnd - lessThan === XML_DECLARATION_OPEN_LENGTH;
    if (threeCharacterTarget && this.buffer.slice(targetStart, targetEnd).toLowerCase() === 'xml') {
      const declaration = this.buffer.slice(targetStart, targetEnd) === 'xml';
      throw scanError(
        declaration ? ErrorCode.WF_XML_DECLARATION_MISPLACED : ErrorCode.WF_PI_TARGET_XML,
        lessThan,
        declaration ? 'The XML declaration must come first' : 'Processing instruction targets matching xml are reserved'
      );
    }
    if (targetEnd + 1 >= this.buffer.length) {
      return bufferEnded(this, targetEnd, 'Unexpected end in a processing instruction');
    }
    let dataStart = targetEnd;
    if (!this.buffer.startsWith('?>', targetEnd)) {
      dataStart = skipWhitespace(this, targetEnd);
      if (dataStart === MORE) return MORE;
      if (dataStart === targetEnd) throw scanError(ErrorCode.WF_PI, targetEnd, 'Expected whitespace after the target');
    }
    const dataEnd = this[FIND_DATA_END](dataStart, Terminator.PI);
    if (dataEnd === MORE) return bufferEnded(this, dataStart, 'Unterminated processing instruction');
    return this[END_CONTENT_TOKEN](Token.PI, dataStart, dataEnd, dataEnd + PI_CLOSE_LENGTH);
  }

  /** Scans `<!-- … -->`, where `--` may only end the comment. */
  private [SCAN_COMMENT](lessThan: number): TokenKind | typeof MORE {
    const hyphens = this[FIND_DATA_END](lessThan + COMMENT_OPEN_LENGTH, Terminator.COMMENT);
    if (hyphens === MORE) return bufferEnded(this, lessThan, 'Unterminated comment');
    const afterClose = scanCommentClose(this, hyphens);
    if (afterClose === MORE) return MORE;
    return this[END_CONTENT_TOKEN](Token.COMMENT, lessThan + COMMENT_OPEN_LENGTH, hyphens, afterClose);
  }

  /** Scans `<![CDATA[ … ]]>`. */
  private [SCAN_CDATA](lessThan: number): TokenKind | typeof MORE {
    const dataEnd = this[FIND_DATA_END](lessThan + CDATA_OPEN_LENGTH, Terminator.CDATA);
    if (dataEnd === MORE) return bufferEnded(this, lessThan, 'Unterminated CDATA section');
    return this[END_CONTENT_TOKEN](Token.CDATA, lessThan + CDATA_OPEN_LENGTH, dataEnd, dataEnd + CDATA_CLOSE_LENGTH);
  }

  /** Records the content of a PI, comment or CDATA section, and where the next token starts. */
  private [END_CONTENT_TOKEN](kind: TokenKind, start: number, end: number, next: number): TokenKind {
    this.valueStart = start;
    this.valueEnd = end;
    this.valueFlags = this.flags;
    this.nextTokenStart = next;
    return kind;
  }

  /** Scans `<!DOCTYPE … >`, whose parts after the name the DOCTYPE token keeps. */
  private [SCAN_DOCTYPE](lessThan: number): TokenKind | typeof MORE {
    const end = this.doctype.scan(this, lessThan);
    if (end === MORE) return MORE;
    this.nextTokenStart = end;
    return Token.DOCTYPE;
  }
}
