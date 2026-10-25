import { NAME_CLASSES, NAME_LAST, NameClass, isNameCharBmp, isNameStartCharBmp } from '../scan/classes.ts';
import { Char, Unicode } from './chars.ts';

// Module-level constants, so V8 can inline them.
const { NON_ASCII } = Char;
const { SUPPLEMENTARY_FIRST } = Unicode;

/**
 * Whether a string is an XML Name (§2.3 [5], fifth edition): a NameStartChar, such as a letter or
 * `_`, then any NameChars, which add digits, `-`, `.` and a few more. Element, attribute and
 * entity names are Names.
 */
export function isXmlName(name: string): boolean {
  return isNameOrToken(name, true);
}

/** Whether a string is an Nmtoken (§2.3 [7]): like a Name, but any NameChar may start it, as in `2nd`. */
export function isNmtoken(token: string): boolean {
  return isNameOrToken(token, false);
}

/** Whether a string is a Name, when `nameStartFirst`, or else an Nmtoken. */
function isNameOrToken(text: string, nameStartFirst: boolean): boolean {
  if (text === '') return false;
  if (isAsciiNameOrToken(text, nameStartFirst)) return true;
  let first = nameStartFirst;
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    const allowed = first ? isNameStartChar(codePoint) : isNameChar(codePoint);
    if (!allowed) return false;
    first = false;
  }
  return true;
}

/**
 * The quick check for all-ASCII text, by the scanner's class table. False for anything else,
 * including any text with a non-ASCII character, which the full check then decides.
 */
function isAsciiNameOrToken(text: string, nameStartFirst: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line prefer-code-point -- ASCII only; other names take the full check
    const char = text.charCodeAt(i);
    if (char >= NON_ASCII) return false;
    const kind = NAME_CLASSES[char] as number;
    if (kind === NameClass.NONE || (i === 0 && nameStartFirst && kind === NameClass.NAME_CHAR)) return false;
  }
  return true;
}

/** Whether a code point is a NameStartChar (§2.3 [4]), which may start a name. */
function isNameStartChar(codePoint: number): boolean {
  if (codePoint < NON_ASCII) return (NAME_CLASSES[codePoint] as number) >= NameClass.NAME_START_CHAR;
  return codePoint >= SUPPLEMENTARY_FIRST ? codePoint <= NAME_LAST : isNameStartCharBmp(codePoint);
}

/** Whether a code point is a NameChar (§2.3 [4a]), which may appear in a name after its first character. */
function isNameChar(codePoint: number): boolean {
  if (codePoint < NON_ASCII) return (NAME_CLASSES[codePoint] as number) !== NameClass.NONE;
  return codePoint >= SUPPLEMENTARY_FIRST ? codePoint <= NAME_LAST : isNameCharBmp(codePoint);
}

/** Whether a string is an NCName (Namespaces [4]): a Name without colons, as prefixes and local names are. */
export function isNcName(name: string): boolean {
  return !name.includes(':') && isXmlName(name);
}

/**
 * Splits a qualified name such as `xs:element` into its prefix and local part, with `''` for no
 * prefix. Undefined when a colon starts or ends the name, or it has two (Namespaces [7]).
 */
export function splitQName(name: string): [string, string] | undefined {
  const colon = name.indexOf(':');
  if (colon === -1) return ['', name];
  if (colon === 0 || colon === name.length - 1 || name.includes(':', colon + 1)) return undefined;
  return [name.slice(0, colon), name.slice(colon + 1)];
}

/** A qualified name's prefix, `''` for none. */
export function prefixOf(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? '' : name.slice(0, colon);
}

/** A qualified name's local part: what follows its colon, or the whole name. */
export function localPartOf(name: string): string {
  return name.slice(name.indexOf(':') + 1);
}
