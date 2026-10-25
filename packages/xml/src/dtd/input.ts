import type { ExpansionContext } from '../entities/attribute-value.ts';
import type { ExceededLimit } from '../entities/limits.ts';
import { ErrorCode } from '../errors/codes.ts';
import type { Location } from '../errors/xml-error.ts';
import { ResolutionError } from '../resolvers/resolver.ts';
import { NAME_CLASSES, NameClass } from '../scan/classes.ts';
import { Char } from '../util/chars.ts';
import { ErrorFactory } from '../util/errors.ts';
import { isNcName, isNmtoken, isXmlName, splitQName } from '../util/names.ts';
import { normalizeLineEnds } from '../util/normalize.ts';
import { isWhitespaceChar } from '../util/whitespace.ts';
import type { EntityDeclaration } from './declarations.ts';
import type { DeclarationStore } from './store.ts';

// Module-level constants, so V8 can inline them.
const { APOSTROPHE, CARRIAGE_RETURN, DOUBLE_QUOTE, LINE_FEED, NON_ASCII, PERCENT, SEMICOLON, SPACE, TAB } = Char;

/** Why a parameter-entity reference inside a declaration fails in the internal subset (WFC: PEs in Internal Subset). */
export const PE_IN_INTERNAL_SUBSET =
  'Parameter-entity references are not allowed inside declarations in the internal subset';

/**
 * One stretch of DTD text being read: a subset, or the replacement text of a parameter entity.
 * Reading a parameter-entity reference pushes a frame for its text; reaching the frame's end pops it.
 */
export interface Frame {
  readonly text: string;
  /** Where reading has got to in `text`. */
  pos: number;
  /** Where the frame's text ends in `text`. */
  readonly end: number;
  /** The parameter entity this frame expands, with its `%`; undefined for a subset. */
  readonly entityName: string | undefined;
  /** Whether the frame is the external subset or an external parameter entity, where references may occur inside declarations. */
  readonly isExternal: boolean;
  /** Whether the frame is document text read in place, whose literals still need their line ends normalized. */
  readonly isDocumentText: boolean;
  /** Whether the frame was referenced between declarations, so it must hold whole declarations (WFC: PE Between Declarations). */
  readonly betweenDeclarations: boolean;
  readonly baseURI: string | undefined;
  /** Whether the frame is a parameter entity's replacement text, whose start and end SAX hears of. */
  readonly isEntityExpansion: boolean;
  /** The location of an index in this frame. */
  readonly locate: (index: number) => Location;
}

/** External text a resolver supplied, its text declaration already read. */
export interface ExternalText {
  /** The text after its text declaration, line ends normalized. */
  readonly text: string;
  /** The URI it was read from. */
  readonly systemId: string | undefined;
  /** The location of an index in `text`. */
  readonly locate: (index: number) => Location;
}

/** What the DTD parser needs from its reader. */
export interface DtdContext extends Omit<ExpansionContext, 'fail' | 'error'> {
  /** Throws a fatal error at a location, naming the entities that led there. */
  fail(code: ErrorCode, message: string, location: Location, entities: readonly string[]): never;
  /** Reports a recoverable error. */
  error(code: ErrorCode, message: string, location: Location): void;
  /** Reads an external parameter entity, or returns undefined when it is not read. */
  readParameterEntity(entity: EntityDeclaration): ExternalText | undefined;
  /** Reports a validity constraint the DTD breaks; present only when validating. */
  invalid?(code: ErrorCode, message: string, location: Location): void;
}

/** A parameter entity's replacement text, and where it came from. */
export interface Replacement {
  readonly text: string;
  /** Whether it came from an external entity, whose declarations count as external. */
  readonly isExternal: boolean;
  /** The base URI the entity's own references resolve against. */
  readonly baseURI: string | undefined;
  /** The location of an index in `text`, for an external entity; an internal one reports its reference. */
  readonly locate?: (index: number) => Location;
}

/** The frame a parameter entity expands into, with a space either side of its text (§4.4.8). */
function expansionFrame(
  entityName: string,
  replacement: Replacement,
  from: Frame,
  referenceStart: number,
  betweenDeclarations: boolean
): Frame {
  const text = ` ${replacement.text} `;
  return {
    text,
    pos: 0,
    end: text.length,
    entityName,
    isExternal: replacement.isExternal || from.isExternal,
    isDocumentText: false,
    betweenDeclarations,
    baseURI: replacement.baseURI,
    isEntityExpansion: true,
    // The padding space before the text maps to its first character.
    locate: (index) => (replacement.locate ? replacement.locate(Math.max(0, index - 1)) : from.locate(referenceStart)),
  };
}

/**
 * The DTD's text as the parser reads it, a character at a time. A DTD can refer to parameter
 * entities, such as `%common;`, whose text is read in place of the reference; so the text comes as
 * a stack of frames, the subset at the bottom and each parameter entity being read above it.
 *
 * The parser asks for the current character, keywords, names and literals; this class reads them
 * from the innermost frame, expands parameter-entity references where the spec allows them, pops a
 * frame when its text ends, and enforces the rules about where an entity may begin and end.
 */
export class DtdInput {
  readonly #store: DeclarationStore;
  readonly #context: DtdContext;
  readonly #frames: Frame[] = [];
  /** The frame being read, the last of `#frames`. */
  #frame: Frame | undefined;
  /** How many declarations are open, so a frame referenced between declarations cannot end inside one. */
  #openDeclarations = 0;
  /** How many frames being read are external or a parameter entity's, whose declarations count as external. */
  #externalFrames = 0;

  constructor(store: DeclarationStore, context: DtdContext) {
    this.#store = store;
    this.#context = context;
  }

  /** Starts reading a frame. */
  push(frame: Frame): void {
    this.#frames.push(frame);
    this.#frame = frame;
    if (frame.isExternal || frame.entityName !== undefined) this.#externalFrames++;
  }

  /** Notes that a declaration has begun, which a frame referenced between declarations must not end inside. */
  openDeclaration(): void {
    this.#openDeclarations++;
  }

  /** Notes that a declaration has ended. */
  closeDeclaration(): void {
    this.#openDeclarations--;
  }

  /** How many frames are being read. */
  get depth(): number {
    return this.#frames.length;
  }

  /** Whether the document is XML 1.1. */
  get version11(): boolean {
    return this.#context.version11;
  }

  // Characters

  /** The frame being read. */
  currentFrame(): Frame {
    return this.#frame as Frame;
  }

  /** The code unit at the current position, or -1 at the end of the frame. */
  currentChar(): number {
    const frame = this.currentFrame();
    // eslint-disable-next-line prefer-code-point -- callers compare with ASCII delimiters
    return frame.pos < frame.end ? frame.text.charCodeAt(frame.pos) : -1;
  }

  /** The code unit `offset` after the current position, or -1 past the end of the frame. */
  charAhead(offset: number): number {
    const frame = this.currentFrame();
    const i = frame.pos + offset;
    // eslint-disable-next-line prefer-code-point -- callers compare with ASCII delimiters
    return i < frame.end ? frame.text.charCodeAt(i) : -1;
  }

  /** Whether the current frame goes on with `expected`. */
  startsWith(expected: string): boolean {
    const frame = this.currentFrame();
    return frame.pos + expected.length <= frame.end && frame.text.startsWith(expected, frame.pos);
  }

  /** Moves past `n` characters of the current frame. */
  advance(n = 1): void {
    this.currentFrame().pos += n;
  }

  /** The location of the current position. */
  location(): Location {
    const frame = this.currentFrame();
    return frame.locate(frame.pos);
  }

  /** The parameter entities being read, outermost first, for errors. */
  openEntityNames(): string[] {
    return this.#frames.flatMap((frame) => (frame.entityName === undefined ? [] : [frame.entityName]));
  }

  /** Throws a fatal error at the current position. */
  fail(code: ErrorCode, message: string): never {
    return this.failAt(code, message, this.location());
  }

  /** Throws a fatal error at a location, naming the parameter entities being read. */
  failAt(code: ErrorCode, message: string, location: Location): never {
    return this.#context.fail(code, message, location, this.openEntityNames());
  }

  /** Reports a validity constraint broken here, when validating. */
  reportInvalid(code: ErrorCode, message: string): void {
    this.#context.invalid?.(code, message, this.location());
  }

  /** Reports when markup that began in one entity ends in another (the PE nesting constraints). */
  checkSameEntity(startFrame: Frame, description: string): void {
    if (this.currentFrame() !== startFrame)
      this.reportInvalid(ErrorCode.VC_PE_NESTING, `${description} must start and end in the same entity`);
  }

  /** Whether declarations read here count as external, which `standalone="yes"` does not count. */
  isInExternal(): boolean {
    return this.#externalFrames > 0;
  }

  // Between declarations

  /** Skips whitespace and parameter-entity references between declarations, leaving entities that end, down to `minDepth` frames. */
  skipSeparators(minDepth: number): void {
    for (;;) {
      this.skipWhitespace();
      const char = this.currentChar();
      if (char === -1 && this.#frames.length > minDepth) {
        this.pop();
        continue;
      }
      if (char !== PERCENT) return;
      this.#expandParameterReference(true);
    }
  }

  /** Leaves the current frame, noting the end of a parameter entity. */
  pop(): void {
    const frame = this.#frames.pop() as Frame;
    this.#frame = this.#frames.at(-1);
    if (frame.isExternal || frame.entityName !== undefined) this.#externalFrames--;
    if (frame.isEntityExpansion) this.#store.items.push({ kind: 'endEntity', name: frame.entityName as string });
  }

  /** Skips whitespace in the current frame; returns how much there was. */
  skipWhitespace(): number {
    const frame = this.currentFrame();
    const start = frame.pos;
    // Only document text still holds NEL and LS; elsewhere line ends are normalized.
    const version11LineEnds = this.#context.version11 && frame.isDocumentText;
    // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
    while (frame.pos < frame.end && isWhitespaceChar(frame.text.charCodeAt(frame.pos), version11LineEnds)) frame.pos++;
    return frame.pos - start;
  }

  // Parameter entities

  /**
   * Expands `%name;`, between declarations or inside one; returns false for an entity that is not
   * read, which stops later declarations.
   */
  #expandParameterReference(betweenDeclarations: boolean): boolean {
    const frame = this.currentFrame();
    const referenceStart = frame.pos;
    frame.pos++;
    const name = this.readName('a parameter entity name');
    if (this.currentChar() !== SEMICOLON)
      this.fail(ErrorCode.WF_REFERENCE, 'Expected ; after the parameter entity name');
    frame.pos++;
    if (!this.isInExternal()) this.#store.hasParameterReferences = true;
    const replacement = this.replacementOf(name, frame, referenceStart);
    if (replacement === undefined) return false;
    // An entity inside a declaration does not count toward the total, as in the JDK.
    const exceeded = this.countExpansion(replacement, betweenDeclarations);
    if (exceeded) this.fail(exceeded.code, exceeded.message);
    const entity = `%${name}`;
    this.#store.items.push({ kind: 'startEntity', name: entity });
    this.push(expansionFrame(entity, replacement, frame, referenceStart, betweenDeclarations));
    return true;
  }

  /** Counts an expansion of a parameter entity against the limits; returns the limit it goes over. */
  countExpansion(replacement: Replacement, countsTowardTotal: boolean): ExceededLimit | undefined {
    const counter = this.#context.counter;
    return replacement.isExternal
      ? counter.countExternalExpansion()
      : counter.countParameterExpansion(replacement.text.length, countsTowardTotal);
  }

  /** Finds the declared parameter entity `entity`, referred to at `referenceStart` in `frame`, failing on recursion; undefined when not declared. */
  #findParameterEntity(
    name: string,
    entity: string,
    frame: Frame,
    referenceStart: number
  ): EntityDeclaration | undefined {
    if (this.#frames.some((open) => open.entityName === entity)) {
      this.failAt(ErrorCode.WF_RECURSIVE_ENTITY, `The entity %${name}; refers to itself`, frame.locate(referenceStart));
    }
    const declaration = this.#store.parameterEntities.get(name);
    if (declaration === undefined) {
      const location = frame.locate(referenceStart);
      if (this.#store.isStandalone) {
        this.failAt(ErrorCode.WF_UNDECLARED_ENTITY, `The entity %${name}; is not declared`, location);
      }
      this.#context.error(ErrorCode.VC_ENTITY_DECLARED, `The entity %${name}; is not declared`, location);
    }
    return declaration;
  }

  /** The replacement text of a parameter entity, reading an external one; undefined when it is not read. */
  #readReplacement(entity: EntityDeclaration): Replacement | undefined {
    if (entity.value !== undefined)
      return { text: entity.value, isExternal: false, baseURI: this.currentFrame().baseURI };
    let external;
    try {
      external = this.#context.readParameterEntity(entity);
    } catch (error) {
      // A read the access lists refuse is reported and skipped; any other refusal fails the DTD at the reference.
      const refusal = ErrorFactory.expect(error, ResolutionError);
      if (refusal.code !== ErrorCode.ACCESS_REFUSED) this.fail(refusal.code, refusal.message);
      this.#context.error(refusal.code, refusal.message, this.location());
      return undefined;
    }
    if (external === undefined) return undefined;
    return { text: external.text, isExternal: true, baseURI: external.systemId, locate: external.locate };
  }

  /** The replacement text of a parameter entity referred to at `referenceStart`; undefined, and noted as skipped, when it is not read. */
  replacementOf(name: string, frame: Frame, referenceStart: number): Replacement | undefined {
    const entity = `%${name}`;
    const declaration = this.#findParameterEntity(name, entity, frame, referenceStart);
    const replacement = declaration === undefined ? undefined : this.#readReplacement(declaration);
    if (replacement !== undefined) return replacement;
    this.#store.items.push({ kind: 'skippedEntity', name: entity });
    // Declarations after an entity that is not read are not applied, unless the document is standalone (§5.1).
    this.#store.hasUnreadDeclarations = true;
    if (!this.#store.isStandalone) this.#store.stoppedApplying = true;
    return undefined;
  }

  // Tokens inside declarations

  /** Skips whitespace inside a declaration, which must be there; returns how much it skipped. */
  requireWhitespace(): number {
    const skipped = this.optionalWhitespace();
    if (skipped === 0) this.fail(ErrorCode.WF_DECLARATION, 'Expected whitespace');
    return skipped;
  }

  /**
   * Skips any whitespace inside a declaration, expanding parameter-entity references where the
   * frame allows them; returns how much it skipped. The end of an entity counts as a space, and so
   * does a reference to an entity that is not read, so the declaration can still be parsed.
   */
  optionalWhitespace(): number {
    let skipped = 0;
    for (;;) {
      skipped += this.skipWhitespace();
      const char = this.currentChar();
      if (char === -1 && this.#frames.length > 1) {
        this.#leaveEndedFrame();
        skipped++;
      } else if (char === PERCENT && this.#startsReference()) {
        if (!this.currentFrame().isExternal) this.fail(ErrorCode.WF_PE_IN_INTERNAL_SUBSET, PE_IN_INTERNAL_SUBSET);
        if (!this.#expandParameterReference(false)) skipped++;
      } else {
        break;
      }
    }
    return skipped;
  }

  /** Leaves an ended frame inside a declaration; one referenced between declarations must not end inside one. */
  #leaveEndedFrame(): void {
    const frame = this.currentFrame();
    if (frame.betweenDeclarations && this.#openDeclarations > 0) {
      this.fail(
        ErrorCode.WF_PE_BETWEEN_DECLARATIONS,
        'A parameter entity between declarations must hold whole declarations'
      );
    }
    this.pop();
  }

  /** Whether `%` here starts a reference rather than the `%` of a parameter-entity declaration. */
  #startsReference(): boolean {
    const frame = this.currentFrame();
    // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
    const next = frame.text.charCodeAt(frame.pos + 1);
    return frame.pos + 1 < frame.end && !isWhitespaceChar(next, false);
  }

  /** Reads a name in the current frame; `description` names what is expected, for the error. */
  readName(description: string): string {
    const ascii = this.#readAsciiName();
    if (ascii !== undefined) return ascii;
    const name = this.readToken();
    if (!isXmlName(name)) {
      this.currentFrame().pos -= name.length;
      this.fail(ErrorCode.WF_DECLARATION, `Expected ${description}`);
    }
    return name;
  }

  /** Reads an ASCII name up to a delimiter in one pass; undefined, reading nothing, for any other name or none. */
  #readAsciiName(): string | undefined {
    const frame = this.currentFrame();
    const { text, end } = frame;
    const start = frame.pos;
    // eslint-disable-next-line prefer-code-point -- ASCII names only; others take the full check
    const first = text.charCodeAt(start);
    if (start >= end || first >= NON_ASCII || (NAME_CLASSES[first] as number) < NameClass.NAME_START_CHAR)
      return undefined;
    let pos = start + 1;
    while (pos < end) {
      // eslint-disable-next-line prefer-code-point -- ASCII names only
      const char = text.charCodeAt(pos);
      if (char >= NON_ASCII || NAME_CLASSES[char] === NameClass.NONE) break;
      pos++;
    }
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (pos < end && !isDelimiter(text.charCodeAt(pos))) return undefined;
    frame.pos = pos;
    return text.slice(start, pos);
  }

  /** Reads a name and checks it against Namespaces: a QName when `isQName`, for elements and attributes, and no colon for the others. */
  readCheckedName(description: string, isQName: boolean): string {
    const name = this.readName(description);
    this.checkNamespaceName(name, isQName);
    return name;
  }

  /** Reads a name token in the current frame (§2.3 [7]). */
  readNmtoken(): string {
    const token = this.readToken();
    if (!isNmtoken(token)) this.fail(ErrorCode.WF_DECLARATION, 'Expected a name token');
    return token;
  }

  /** Reads up to the next delimiter in the current frame. */
  readToken(): string {
    const frame = this.currentFrame();
    const start = frame.pos;
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    while (frame.pos < frame.end && !isDelimiter(frame.text.charCodeAt(frame.pos))) frame.pos++;
    return frame.text.slice(start, frame.pos);
  }

  /** Reads a keyword, such as `#REQUIRED`, if the current frame goes on with it; returns whether it did. */
  readKeyword(word: string): boolean {
    if (!this.startsWith(word)) return false;
    const frame = this.currentFrame();
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const after = frame.text.charCodeAt(frame.pos + word.length);
    if (frame.pos + word.length < frame.end && !isDelimiter(after)) return false;
    frame.pos += word.length;
    return true;
  }

  /**
   * Reads a quoted literal, which must close in the frame it opened in. Returns its content with
   * line ends normalized, the frame, and where the literal starts, for errors found in it later.
   */
  readLiteral(description: string): { value: string; frame: Frame; start: number } {
    const frame = this.currentFrame();
    const quote = this.currentChar();
    if (quote !== DOUBLE_QUOTE && quote !== APOSTROPHE) {
      this.fail(ErrorCode.WF_DECLARATION, `Expected a quoted ${description}`);
    }
    // eslint-disable-next-line prefer-code-point -- a quote character
    const closingQuote = frame.text.indexOf(String.fromCharCode(quote), frame.pos + 1);
    if (closingQuote === -1 || closingQuote >= frame.end)
      this.fail(ErrorCode.WF_DECLARATION, `Unterminated ${description}`);
    const start = frame.pos;
    const value = frame.text.slice(frame.pos + 1, closingQuote);
    frame.pos = closingQuote + 1;
    return { value: this.normalizeLineEndsOf(frame, value), frame, start };
  }

  /** Text read from a frame, with its line ends normalized if it is document text read in place (§2.11). */
  normalizeLineEndsOf(frame: Frame, text: string): string {
    return frame.isDocumentText ? normalizeLineEnds(text, this.#context.version11) : text;
  }

  /** Checks a name against Namespaces: a QName when `isQName`, for elements and attributes, and no colon for the others. */
  checkNamespaceName(name: string, isQName: boolean): void {
    // A name without a colon is an NCName, so it passes either way.
    if (!this.#context.namespaceAware || !name.includes(':')) return;
    if (!isQName) this.fail(ErrorCode.NS_COLON, `${name} must not contain a colon`);
    const parts = splitQName(name);
    if (parts === undefined || (parts[0] !== '' && !isNcName(parts[1]))) {
      this.fail(ErrorCode.NS_QNAME, `${name} is not a qualified name`);
    }
  }
}

/** Which ASCII code units end a name or keyword in a declaration: whitespace, and these delimiters. */
const DELIMITERS = new Uint8Array(NON_ASCII);
// eslint-disable-next-line prefer-code-point -- ASCII delimiters
for (const char of Array.from('>()|,%"\'?*+[;', (delimiter) => delimiter.charCodeAt(0))) DELIMITERS[char] = 1;
for (const char of [SPACE, TAB, LINE_FEED, CARRIAGE_RETURN]) DELIMITERS[char] = 1;

/** Whether a code unit ends a name or keyword in a declaration. */
function isDelimiter(char: number): boolean {
  return char < NON_ASCII && DELIMITERS[char] === 1;
}
