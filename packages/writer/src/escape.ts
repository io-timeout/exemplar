import { ErrorCode } from '@exemplarjs/xml';
import { Char, Unicode, codePointLabel, isChar, isRestrictedChar } from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { WriterError } from './error.ts';

const { AMPERSAND, CARRIAGE_RETURN, DOUBLE_QUOTE, GREATER_THAN, LESS_THAN, LINE_FEED, LINE_SEPARATOR, NEXT_LINE, TAB } =
  Char;
const { SUPPLEMENTARY_FIRST } = Unicode;

/** How text and attribute values are escaped for one writer. */
export interface EscapeOptions {
  /** Escape only what XML requires, rather than everything re-reading would change. */
  readonly minimal: boolean;
  /** Whether the document is XML 1.1, whose RestrictedChars, NEL and LS are written as references. */
  readonly version11: boolean;
  /** Matches a character the output encoding cannot hold. */
  readonly unencodable: RegExp | undefined;
  /** Throw on characters XML does not allow. */
  readonly checkCharacters: boolean;
}

/** Escapes character data and attribute values. */
export interface Escaper {
  /** What it escapes for. */
  readonly options: EscapeOptions;
  /** Character data, escaped. */
  text(text: string): string;
  /** An attribute value, escaped for writing between double quotes. */
  attribute(value: string): string;
}

/** What XML 1.0 does not allow (XML 1.0 [2] Char). */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const NOT_CHAR_XML_10 = /[\0-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/;
/** What XML 1.1 does not allow or writes as a reference: outside Char, RestrictedChar, NEL and LS (XML 1.1 [2], [2a]). */
// oxlint-disable-next-line no-control-regex -- finding control characters is the point
const SPECIAL_XML_11 = /[\0-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\uD800-\uDFFF\uFFFE\uFFFF]/;

/** Whether XML 1.1 needs a code point written as a reference: restricted characters, and NEL and LS, which re-reading treats as line ends. */
function needsReferenceXml11(code: number): boolean {
  return isRestrictedChar(code) || code === NEXT_LINE || code === LINE_SEPARATOR;
}

/** Whether markup, which cannot hold references, can hold a code point: in XML 1.1 no RestrictedChar. */
function allowedLiterally(code: number, version11: boolean): boolean {
  return isChar(code, version11) && !(version11 && isRestrictedChar(code));
}

/** Builds the escaper for one writer's options. */
export function escaper(options: EscapeOptions): Escaper {
  const { minimal, version11, unencodable, checkCharacters } = options;
  // The character class without its brackets.
  const special = (version11 ? SPECIAL_XML_11 : NOT_CHAR_XML_10).source.slice(1, -1);
  const orUnencodable = unencodable === undefined ? '' : `|${unencodable.source}`;
  // One test finds anything to escape, any character XML forbids, and any the encoding lacks.
  const textClass = minimal ? '[&<' + special + ']|]]>' : String.raw`[&<>\r` + special + ']';
  const attributeClass = minimal ? '[&<"' + special + ']' : String.raw`[&<"\t\n\r` + special + ']';
  const textNeedsEscaping = new RegExp(textClass + orUnencodable);
  const valueNeedsEscaping = new RegExp(attributeClass + orUnencodable);
  /** A character markup does not need escaped: as it is, refused, or a reference when XML 1.1 or the encoding needs one. */
  const escapeCharacter = (char: string, code: number): string => {
    if (!isChar(code, version11)) {
      if (checkCharacters) {
        throw ErrorFactory.create(
          WriterError,
          ErrorCode.WRITE_CHARACTER,
          `${codePointLabel(code)} is not allowed in XML`
        );
      }
      return char;
    }
    if ((version11 && needsReferenceXml11(code)) || (unencodable?.test(char) ?? false)) return `&#${code};`;
    return char;
  };
  /** A character of text escaped: `&` and `<`, `>` after `]]`, and in round-trip mode any `>` and CR. */
  const escapeInText = (char: string, code: number, text: string, index: number): string => {
    if (code === AMPERSAND) return '&amp;';
    if (code === LESS_THAN) return '&lt;';
    if (code === GREATER_THAN && (!minimal || text.slice(index - 2, index) === ']]')) return '&gt;';
    if (code === CARRIAGE_RETURN && !minimal) return `&#${code};`;
    return escapeCharacter(char, code);
  };
  /** A character of an attribute value escaped: `&`, `<` and `"`, and in round-trip mode tab, LF and CR. */
  const escapeInValue = (char: string, code: number): string => {
    if (code === AMPERSAND) return '&amp;';
    if (code === LESS_THAN) return '&lt;';
    if (code === DOUBLE_QUOTE) return '&quot;';
    if (!minimal && (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN)) return `&#${code};`;
    return escapeCharacter(char, code);
  };
  /** Escapes a string a character at a time, a surrogate pair as one. */
  const escapeEach = (text: string, context: 'text' | 'attribute'): string => {
    let escaped = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.codePointAt(i) as number;
      const isPair = code >= SUPPLEMENTARY_FIRST;
      const char = isPair ? text.slice(i, i + 2) : (text[i] as string);
      if (isPair) i++;
      escaped += context === 'attribute' ? escapeInValue(char, code) : escapeInText(char, code, text, i);
    }
    return escaped;
  };
  return {
    options,
    text: (text) => (textNeedsEscaping.test(text) ? escapeEach(text, 'text') : text),
    attribute: (value) => (valueNeedsEscaping.test(value) ? escapeEach(value, 'attribute') : value),
  };
}

/** Throws when markup that cannot hold references holds a character XML or the encoding does not allow. */
export function checkLiteral(text: string, options: EscapeOptions, what: string): void {
  const special = options.version11 ? SPECIAL_XML_11 : NOT_CHAR_XML_10;
  const unencodable = options.unencodable?.exec(text);
  if (unencodable) {
    const code = text.codePointAt(unencodable.index) as number;
    throw ErrorFactory.create(
      WriterError,
      ErrorCode.WRITE_ENCODING,
      `${codePointLabel(code)} cannot be written in ${what} in this encoding`
    );
  }
  if (!options.checkCharacters || !special.test(text)) return;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) as number;
    if (code >= SUPPLEMENTARY_FIRST) i++;
    if (!allowedLiterally(code, options.version11)) {
      throw ErrorFactory.create(
        WriterError,
        ErrorCode.WRITE_CHARACTER,
        `${codePointLabel(code)} is not allowed in ${what}`
      );
    }
  }
}

/** A literal in whichever quotes it does not hold, as a DOCTYPE's identifiers are written. */
export function quotedLiteral(literal: string): string {
  return literal.includes('"') ? `'${literal}'` : `"${literal}"`;
}

/** Text as CDATA sections, split around `]]>`. */
export function cdataSections(text: string): string {
  return `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

/** Text as CDATA sections, with the characters an encoding lacks as references between them. */
export function cdataSectionsAround(text: string, unencodable: RegExp): string {
  let written = '';
  let run = '';
  for (const char of text) {
    if (!unencodable.test(char)) {
      run += char;
      continue;
    }
    if (run !== '') written += cdataSections(run);
    written += `&#${char.codePointAt(0) as number};`;
    run = '';
  }
  return run === '' ? written : written + cdataSections(run);
}
