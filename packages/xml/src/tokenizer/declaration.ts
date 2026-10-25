import { ErrorCode } from '../errors/codes.ts';
import { scanError } from '../scan/scanner.ts';
import { Char } from '../util/chars.ts';
import { isWhitespaceChar } from '../util/whitespace.ts';
import { XML_DECLARATION_OPEN_LENGTH } from './syntax.ts';

// Module-level constants, so V8 can inline them.
const { APOSTROPHE, DOUBLE_QUOTE, EQUALS, LINE_SEPARATOR, NEXT_LINE } = Char;

/** What a declaration says. A field is missing when the declaration leaves it out. */
export interface Declaration {
  /** The XML version as written, such as `"1.0"` or `"1.1"`. */
  readonly version?: string;
  /** The encoding name as written, such as `"UTF-8"`; it is not looked up here. */
  readonly encoding?: string;
  /** True for `standalone="yes"`, false for `standalone="no"`. */
  readonly standalone?: boolean;
}

/** Which declaration to read: a document's XML declaration, or an external entity's text declaration. */
export type DeclarationKind = 'xml' | 'text';

/**
 * `<?xml` followed by whitespace or `?`, which tells an XML or text declaration from a PI such as
 * `<?xml-stylesheet`. The `?` lets `<?xml?>` count, so it fails as a declaration with no version.
 */
const DECLARATION_START = /^<\?xml[\t\n\r ?]/;

/** How many characters it takes to tell whether text starts with a declaration: `<?xml` and one more. */
export const DECLARATION_START_LENGTH = '<?xml '.length;

/** Whether text starts with an XML or text declaration. */
export function startsWithDeclaration(text: string): boolean {
  return DECLARATION_START.test(text);
}

/** Whether text is too short to tell yet, but could still turn out to start with a declaration. */
export function couldStartDeclaration(text: string): boolean {
  return text.length < DECLARATION_START_LENGTH && '<?xml'.startsWith(text);
}

/** A valid version: `1.` and digits (§2.8 [26] VersionNum). */
const VALID_VERSION = /^1\.\d+$/;
/** A valid encoding name: a letter, then letters, digits, `.`, `_` or `-` (§4.3.3 [81] EncName). */
const VALID_ENCODING = /^[A-Za-z][A-Za-z0-9._-]*$/;
/** A valid standalone value (§2.9 [32] SDDecl). */
const VALID_STANDALONE = /^(?:yes|no)$/;

/**
 * Reads the declaration at the top of an XML document or external entity.
 *
 * A document can start with an XML declaration (§2.8). It says which version of XML the
 * document uses, how its bytes are encoded, and whether it needs declarations from outside
 * the document:
 *
 * ```xml
 * <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 * ```
 *
 * An external entity, a file the document pulls in, can start with a text declaration
 * (§4.3.1) instead. It looks the same, but the encoding is required, the version is optional,
 * and `standalone` is not allowed:
 *
 * ```xml
 * <?xml encoding="ISO-8859-1"?>
 * ```
 *
 * The `name="value"` parts look like attributes but aren't: the spec calls them
 * pseudo-attributes. Only these three names exist, and they must come in this order:
 * `version`, `encoding`, `standalone`. Reading them in that order is what enforces it.
 */
export class DeclarationParser {
  readonly #text: string;
  /** Where reading has got to, as an index into the text. */
  #pos: number;
  /** The code a malformed declaration fails with: `WF_XML_DECLARATION` or `WF_TEXT_DECLARATION`. */
  #errorCode: ErrorCode = ErrorCode.WF_XML_DECLARATION;

  /** Reads the declaration at `start` in `text`, which must begin with `<?xml` there; `startsWithDeclaration` checks that. */
  constructor(text: string, start: number) {
    this.#text = text;
    this.#pos = start;
  }

  /** The index just after the declaration's `?>` once it has been parsed; before that, where it starts. */
  get end(): number {
    return this.#pos;
  }

  /** Reads the declaration and returns what it says; throws a `ScanError` at the first thing wrong with it. */
  parse(kind: DeclarationKind): Declaration {
    const isTextDeclaration = kind === 'text';
    if (isTextDeclaration) this.#errorCode = ErrorCode.WF_TEXT_DECLARATION;
    this.#pos += XML_DECLARATION_OPEN_LENGTH;
    const version = this.#readPseudoAttribute('version', !isTextDeclaration, VALID_VERSION);
    const encoding = this.#readPseudoAttribute('encoding', isTextDeclaration, VALID_ENCODING);
    const standalone = isTextDeclaration ? undefined : this.#readPseudoAttribute('standalone', false, VALID_STANDALONE);
    this.#skipWhitespace();
    if (!this.#text.startsWith('?>', this.#pos)) this.#fail('Expected ?> to end the declaration');
    this.#pos += 2;
    return {
      ...(version !== undefined && { version }),
      ...(encoding !== undefined && { encoding }),
      ...(standalone !== undefined && { standalone: standalone === 'yes' }),
    };
  }

  /**
   * Reads `name="value"` if that pseudo-attribute comes next, and returns its value.
   * Returns undefined, having read nothing, if it isn't there and isn't required.
   */
  #readPseudoAttribute(name: string, required: boolean, validValue: RegExp): string | undefined {
    const originalPos = this.#pos;
    const spaceBefore = this.#skipWhitespace() > 0;
    if (!this.#text.startsWith(name, this.#pos)) {
      if (required) this.#fail(`Expected ${name} in the declaration`);
      this.#pos = originalPos;
      return undefined;
    }
    if (!spaceBefore) this.#fail(`Expected whitespace before ${name}`);
    this.#pos += name.length;
    this.#skipWhitespace();
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    if (this.#text.charCodeAt(this.#pos) !== EQUALS) this.#fail(`Expected = after ${name}`);
    this.#pos++;
    this.#skipWhitespace();
    // eslint-disable-next-line prefer-code-point -- ASCII is never half a surrogate pair
    const quote = this.#text.charCodeAt(this.#pos);
    if (quote !== DOUBLE_QUOTE && quote !== APOSTROPHE) this.#fail(`Expected a quoted value for ${name}`);
    // eslint-disable-next-line prefer-code-point -- a quote character
    const closingQuote = this.#text.indexOf(String.fromCharCode(quote), this.#pos + 1);
    if (closingQuote === -1) this.#fail(`Unterminated value for ${name}`);
    const value = this.#text.slice(this.#pos + 1, closingQuote);
    if (!validValue.test(value)) this.#fail(`${JSON.stringify(value)} is not a valid ${name}`);
    this.#pos = closingQuote + 1;
    return value;
  }

  /** Skips whitespace and returns how much there was. */
  #skipWhitespace(): number {
    const start = this.#pos;
    for (;;) {
      // eslint-disable-next-line prefer-code-point -- spaces and line ends are single code units
      const char = this.#text.charCodeAt(this.#pos);
      // XML 1.1 ends lines with these too, but they can't be recognised until the declaration
      // has said which version and encoding apply, so they are an error inside it (XML 1.1 §2.11).
      if (char === NEXT_LINE || char === LINE_SEPARATOR) {
        throw scanError(
          ErrorCode.WF_LINE_END_IN_DECLARATION,
          this.#pos,
          'Next line (U+0085) and line separator (U+2028) characters are not allowed in a declaration'
        );
      }
      // Only space, tab, CR and LF count, whatever the version.
      if (!isWhitespaceChar(char, /* version11 */ false)) return this.#pos - start;
      this.#pos++;
    }
  }

  /** Throws the declaration's error code at the current position. */
  #fail(message: string): never {
    throw scanError(this.#errorCode, this.#pos, message);
  }
}
