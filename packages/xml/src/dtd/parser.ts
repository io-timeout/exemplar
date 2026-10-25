import { expandAttributeValue, normalizeTokens } from '../entities/attribute-value.ts';
import { ErrorCode } from '../errors/codes.ts';
import { Char, isPubidText } from '../util/chars.ts';
import { PREDEFINED_ENTITIES } from '../util/references.ts';
import { isWhitespaceChar, normalizePublicId } from '../util/whitespace.ts';
import { readContentModel } from './content-model.ts';
import type { AttributeDeclaration, AttributeType, DefaultMode, EntityDeclaration } from './declarations.ts';
import { expandEntityValue } from './entity-value.ts';
import { type DtdContext, DtdInput, type Frame } from './input.ts';
import type { DeclarationStore } from './store.ts';

// Module-level constants, so V8 can inline them.
const { APOSTROPHE, DOUBLE_QUOTE, GREATER_THAN, LEFT_BRACKET, LEFT_PAREN, PERCENT, RIGHT_PAREN, VERTICAL_BAR } = Char;
const { HYPHEN, UPPER_A, UPPER_E, UPPER_N } = Char;

/** The keywords that name an attribute type (§3.3.1); NOTATION and enumerations are read apart. */
const ATTRIBUTE_TYPE_KEYWORDS = new Set([
  'CDATA',
  'ID',
  'IDREF',
  'IDREFS',
  'ENTITY',
  'ENTITIES',
  'NMTOKEN',
  'NMTOKENS',
]);

/**
 * Parses a DTD's markup declarations into a `DeclarationStore` (§2.8, §3.2–§3.4, §4.2, §4.7): element
 * types, attribute lists, entities and notations, with the comments, PIs and conditional sections
 * between them. It reads its text through `DtdInput`, which expands parameter entities on the way.
 *
 * The first declaration of a name binds and later ones are ignored, as the spec says. Once a
 * parameter entity can't be read, later entity and attribute-list declarations aren't applied unless
 * the document is standalone (§5.1), since the unread text might have declared the same names first.
 */
export class DtdParser {
  readonly #store: DeclarationStore;
  readonly #context: DtdContext;
  readonly #input: DtdInput;
  /** The frame the last conditional section closed in. */
  #lastSectionClosedIn: Frame | undefined;

  constructor(store: DeclarationStore, context: DtdContext) {
    this.#store = store;
    this.#context = context;
    this.#input = new DtdInput(store, context);
  }

  /** Reads a whole subset: the internal subset in place, or the external subset's text. */
  parse(frame: Frame): void {
    this.#input.push(frame);
    this.#readDeclarations(false);
  }

  // Between declarations

  /** Reads declarations to the end of the frame, or of a conditional section. */
  #readDeclarations(inConditionalSection: boolean): void {
    let depth = this.#input.depth;
    for (;;) {
      this.#input.skipSeparators(depth);
      if (this.#input.depth === depth && this.#input.currentChar() === -1) {
        // A section may end outside the entity it began in.
        if (inConditionalSection && depth > 1 && this.#input.currentFrame().entityName !== undefined) {
          this.#input.pop();
          depth--;
          continue;
        }
        if (inConditionalSection)
          this.#input.fail(ErrorCode.WF_CONDITIONAL_SECTION, 'Unterminated inConditionalSection section');
        this.#input.pop();
        return;
      }
      if (inConditionalSection && this.#input.startsWith(']]>')) {
        this.#lastSectionClosedIn = this.#input.currentFrame();
        this.#input.advance(']]>'.length);
        return;
      }
      this.#readMarkupDeclaration();
    }
  }

  /** Reads one markup declaration, comment, PI or conditional section, chosen by its third character. */
  #readMarkupDeclaration(): void {
    const input = this.#input;
    switch (input.startsWith('<!') ? input.charAhead(2) : -1) {
      case UPPER_E: {
        if (input.startsWith('<!ENTITY')) return this.#readDeclaration('<!ENTITY', () => this.#readEntityDeclaration());
        if (input.startsWith('<!ELEMENT'))
          return this.#readDeclaration('<!ELEMENT', () => this.#readElementDeclaration());
        break;
      }
      case UPPER_A: {
        if (input.startsWith('<!ATTLIST'))
          return this.#readDeclaration('<!ATTLIST', () => this.#readAttlistDeclaration());
        break;
      }
      case HYPHEN: {
        if (input.startsWith('<!--')) return this.#readComment();
        break;
      }
      case LEFT_BRACKET: {
        return this.#readConditionalSection();
      }
      case UPPER_N: {
        if (input.startsWith('<!NOTATION'))
          return this.#readDeclaration('<!NOTATION', () => this.#readNotationDeclaration());
        break;
      }
      default: {
        if (input.startsWith('<?')) return this.#readPi();
      }
    }
    return input.fail(ErrorCode.WF_DECLARATION, 'Expected a markup declaration');
  }

  /** Reads a declaration after its keyword, up to its `>`. */
  #readDeclaration(keyword: string, body: () => void): void {
    const start = this.#input.currentFrame();
    this.#input.advance(keyword.length);
    this.#input.openDeclaration();
    body();
    this.#input.optionalWhitespace();
    if (this.#input.currentChar() !== GREATER_THAN)
      this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected > to end the declaration');
    this.#input.checkSameEntity(start, 'A markup declaration');
    this.#input.advance();
    this.#input.closeDeclaration();
  }

  // Declarations

  /** `<!ELEMENT name contentspec>` (§3.2). */
  #readElementDeclaration(): void {
    this.#input.requireWhitespace();
    const name = this.#input.readCheckedName('an element name', true);
    this.#input.requireWhitespace();
    let content: string;
    if (this.#input.readKeyword('EMPTY')) content = 'EMPTY';
    else if (this.#input.readKeyword('ANY')) content = 'ANY';
    else content = readContentModel(this.#input);
    if (!this.#store.declareElement({ name, content, declaredExternally: this.#input.isInExternal() })) {
      this.#input.reportInvalid(
        ErrorCode.VC_UNIQUE_ELEMENT_TYPE,
        `The element type ${name} is declared more than once`
      );
    }
  }

  /** `<!ATTLIST element (name type default)*>` (§3.3). */
  #readAttlistDeclaration(): void {
    this.#input.requireWhitespace();
    const element = this.#input.readCheckedName('an element name', true);
    for (;;) {
      const skipped = this.#input.optionalWhitespace();
      if (this.#input.currentChar() === GREATER_THAN) return;
      if (skipped === 0) this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected whitespace before the attribute name');
      const name = this.#input.readCheckedName('an attribute name', true);
      this.#input.requireWhitespace();
      const [type, values] = this.#readAttributeType();
      this.#input.requireWhitespace();
      const declaration = this.#readDefaultDeclaration(element, name, type, values);
      if (!this.#store.stoppedApplying) this.#store.declareAttribute(declaration);
    }
  }

  /** An attribute type: CDATA, a tokenized type, NOTATION (…) or an enumeration (§3.3.1). */
  #readAttributeType(): [AttributeType, readonly string[] | undefined] {
    if (this.#input.readKeyword('NOTATION')) {
      this.#input.requireWhitespace();
      return ['NOTATION', this.#readEnumeration(false)];
    }
    if (this.#input.currentChar() === LEFT_PAREN) return ['ENUMERATION', this.#readEnumeration(true)];
    const type = this.#input.readToken();
    if (!ATTRIBUTE_TYPE_KEYWORDS.has(type))
      this.#input.fail(ErrorCode.WF_DECLARATION, `${type} is not an attribute type`);
    return [type as AttributeType, undefined];
  }

  /** `(a | b | c)`: name tokens for an enumeration, names for NOTATION. */
  #readEnumeration(ofNmtokens: boolean): string[] {
    if (this.#input.currentChar() !== LEFT_PAREN) this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected (');
    this.#input.advance();
    const values: string[] = [];
    for (;;) {
      this.#input.optionalWhitespace();
      values.push(ofNmtokens ? this.#input.readNmtoken() : this.#input.readName('a notation name'));
      this.#input.optionalWhitespace();
      const char = this.#input.currentChar();
      this.#input.advance();
      if (char === RIGHT_PAREN) return values;
      if (char !== VERTICAL_BAR) this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected | or )');
    }
  }

  /** `#REQUIRED`, `#IMPLIED`, or a value, `#FIXED` or not (§3.3.2). */
  #readDefaultDeclaration(
    element: string,
    name: string,
    type: AttributeType,
    values: readonly string[] | undefined
  ): AttributeDeclaration {
    const input = this.#input;
    const declaredExternally = input.isInExternal();
    // In AttributeDeclaration's property order, which reads faster (design.md, DTD).
    const declared = { element, name, type, ...(values !== undefined && { values }) };
    if (input.readKeyword('#REQUIRED')) return { ...declared, mode: 'REQUIRED', declaredExternally };
    if (input.readKeyword('#IMPLIED')) return { ...declared, mode: 'IMPLIED', declaredExternally };
    const fixed = input.readKeyword('#FIXED');
    if (fixed) input.requireWhitespace();
    const mode: DefaultMode = fixed ? 'FIXED' : 'DEFAULT';
    const literal = input.readLiteral('default value');
    const value = this.#normalizeDefaultValue(literal.value, literal.frame, literal.start);
    return {
      ...declared,
      mode,
      value: type === 'CDATA' ? value : normalizeTokens(value),
      declaredExternally,
    };
  }

  /** Normalizes a default value as an attribute value is, failing at the literal. */
  #normalizeDefaultValue(literalValue: string, frame: Frame, literalStart: number): string {
    return expandAttributeValue(
      literalValue,
      {
        ...this.#context,
        fail: (code, message) =>
          this.#context.fail(code, message, frame.locate(literalStart), this.#input.openEntityNames()),
        error: (code, message) => this.#context.error(code, message, frame.locate(literalStart)),
      },
      true
    );
  }

  /** `<!ENTITY name value>`, `<!ENTITY name ExternalID NDATA n>` or `<!ENTITY % name …>` (§4.2). */
  #readEntityDeclaration(): void {
    this.#input.requireWhitespace();
    let isParameterEntity = false;
    if (this.#input.currentChar() === PERCENT) {
      this.#input.advance();
      isParameterEntity = true;
      this.#input.requireWhitespace();
    }
    const name = this.#input.readCheckedName('an entity name', false);
    this.#input.requireWhitespace();
    const baseURI = this.#input.currentFrame().baseURI;
    const declaredExternally = this.#input.isInExternal();
    const char = this.#input.currentChar();
    let declaration: EntityDeclaration;
    if (char === DOUBLE_QUOTE || char === APOSTROPHE) {
      declaration = {
        name,
        isParameterEntity,
        value: this.#readEntityValue(),
        declaredExternally,
      };
    } else {
      const id = this.#readExternalId(false);
      const notation = isParameterEntity ? undefined : this.#readNdata();
      declaration = {
        name,
        isParameterEntity,
        ...id,
        ...(notation !== undefined && { notation }),
        ...(baseURI !== undefined && { baseURI }),
        declaredExternally,
      };
    }
    if (!this.#store.stoppedApplying && !(declaration.isParameterEntity === false && PREDEFINED_ENTITIES.has(name))) {
      this.#store.declareEntity(declaration);
    }
  }

  /** An optional `NDATA name` after a general entity's external id. */
  #readNdata(): string | undefined {
    const skipped = this.#input.optionalWhitespace();
    if (!this.#input.readKeyword('NDATA')) return undefined;
    if (skipped === 0) this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected whitespace before NDATA');
    this.#input.requireWhitespace();
    return this.#input.readCheckedName('a notation name', false);
  }

  /** Reads an entity value and builds its replacement text (§4.5). */
  #readEntityValue(): string {
    const literal = this.#input.readLiteral('entity value');
    return expandEntityValue(this.#input, literal.value, literal.frame, literal.start, []);
  }

  /** `SYSTEM "…"` or `PUBLIC "…" "…"`; for a notation the system literal may be absent (§4.2.2, §4.7). */
  #readExternalId(forNotation: boolean): { publicId?: string; systemId?: string } {
    if (this.#input.readKeyword('SYSTEM')) {
      this.#input.requireWhitespace();
      return { systemId: this.#input.readLiteral('system literal').value };
    }
    if (!this.#input.readKeyword('PUBLIC'))
      this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected SYSTEM, PUBLIC or a quoted value');
    this.#input.requireWhitespace();
    const publicId = this.#readPublicId();
    const skipped = this.#input.optionalWhitespace();
    const char = this.#input.currentChar();
    if (forNotation && char !== DOUBLE_QUOTE && char !== APOSTROPHE) return { publicId };
    if (skipped === 0) this.#input.fail(ErrorCode.WF_DECLARATION, 'Expected whitespace before the system literal');
    return { publicId, systemId: this.#input.readLiteral('system literal').value };
  }

  /** A public id literal, its whitespace normalized for matching (§4.2.2). */
  #readPublicId(): string {
    const { value: publicId } = this.#input.readLiteral('public identifier');
    if (!isPubidText(publicId)) {
      this.#input.fail(ErrorCode.WF_DECLARATION, 'The public identifier holds a character PubidChar does not allow');
    }
    return normalizePublicId(publicId);
  }

  /** `<!NOTATION name ExternalID>` or `<!NOTATION name PUBLIC "…">` (§4.7). */
  #readNotationDeclaration(): void {
    this.#input.requireWhitespace();
    const name = this.#input.readCheckedName('a notation name', false);
    this.#input.requireWhitespace();
    const baseURI = this.#input.currentFrame().baseURI;
    if (
      !this.#store.declareNotation({ name, ...this.#readExternalId(true), ...(baseURI !== undefined && { baseURI }) })
    ) {
      this.#input.reportInvalid(ErrorCode.VC_UNIQUE_NOTATION, `The notation ${name} is declared more than once`);
    }
  }

  /** `<!-- … -->`, in one frame. */
  #readComment(): void {
    const frame = this.#input.currentFrame();
    const start = frame.pos + '<!--'.length;
    const end = frame.text.indexOf('--', start);
    const after = end + '--'.length;
    if (end === -1 || after >= frame.end) this.#input.fail(ErrorCode.WF_COMMENT, 'Unterminated comment');
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const closed = frame.text.charCodeAt(after) === GREATER_THAN;
    if (!closed) {
      frame.pos = end;
      this.#input.fail(ErrorCode.WF_COMMENT, '-- is not allowed inside a comment');
    }
    const text = frame.text.slice(start, end);
    this.#store.items.push({ kind: 'comment', text: this.#input.normalizeLineEndsOf(frame, text) });
    frame.pos = end + '-->'.length;
  }

  /** `<?target …?>`, in one frame; the target must not be xml. */
  #readPi(): void {
    const frame = this.#input.currentFrame();
    frame.pos += 2;
    const target = this.#input.readName('a processing instruction target');
    if (target.toLowerCase() === 'xml') {
      const code = target === 'xml' ? ErrorCode.WF_XML_DECLARATION_MISPLACED : ErrorCode.WF_PI_TARGET_XML;
      this.#input.fail(code, 'Processing instruction targets matching xml are reserved');
    }
    this.#input.checkNamespaceName(target, false);
    const end = frame.text.indexOf('?>', frame.pos);
    if (end === -1 || end + 1 >= frame.end) this.#input.fail(ErrorCode.WF_PI, 'Unterminated processing instruction');
    // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
    const unspaced = end > frame.pos && !isWhitespaceChar(frame.text.charCodeAt(frame.pos), false);
    if (unspaced) {
      this.#input.fail(ErrorCode.WF_PI, 'Expected whitespace after the target');
    }
    this.#input.skipWhitespace();
    const data = frame.text.slice(frame.pos, end);
    this.#store.addProcessingInstruction(target, this.#input.normalizeLineEndsOf(frame, data));
    frame.pos = end + 2;
  }

  /** `<![INCLUDE[ … ]]>` or `<![IGNORE[ … ]]>`, allowed only outside the internal subset (§3.4). */
  #readConditionalSection(): void {
    if (!this.#input.currentFrame().isExternal) {
      this.#input.fail(ErrorCode.WF_CONDITIONAL_SECTION, 'Conditional sections are not allowed in the internal subset');
    }
    const start = this.#input.currentFrame();
    this.#input.advance('<!['.length);
    this.#input.optionalWhitespace();
    const include = this.#input.readKeyword('INCLUDE');
    if (!include && !this.#input.readKeyword('IGNORE'))
      this.#input.fail(ErrorCode.WF_CONDITIONAL_SECTION, 'Expected INCLUDE or IGNORE');
    this.#input.optionalWhitespace();
    if (this.#input.currentChar() !== LEFT_BRACKET)
      this.#input.fail(ErrorCode.WF_CONDITIONAL_SECTION, 'Expected [ to open the section');
    this.#input.checkSameEntity(start, 'A conditional section');
    this.#input.advance();
    if (!include) {
      this.#skipIgnoreSection();
      return;
    }
    this.#readDeclarations(true);
    // The `]]>` must come in the entity the `<![` did.
    if (this.#lastSectionClosedIn !== start) {
      this.#input.reportInvalid(ErrorCode.VC_PE_NESTING, 'A conditional section must start and end in the same entity');
    }
  }

  /** Skips an IGNORE section, nested sections included, to its `]]>`. */
  #skipIgnoreSection(): void {
    const frame = this.#input.currentFrame();
    let depth = 1;
    while (depth > 0) {
      const open = frame.text.indexOf('<![', frame.pos);
      const close = frame.text.indexOf(']]>', frame.pos);
      if (close === -1 || close >= frame.end)
        this.#input.fail(ErrorCode.WF_CONDITIONAL_SECTION, 'Unterminated IGNORE section');
      if (open !== -1 && open < close) {
        depth++;
        frame.pos = open + '<!['.length;
      } else {
        depth--;
        frame.pos = close + ']]>'.length;
      }
    }
  }
}
