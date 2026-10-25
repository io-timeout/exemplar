import type { AsyncStreamReader, StreamReader } from '@exemplarjs/xml';
import { isNcName, isXmlName } from '@exemplarjs/xml/internal';

/** One part of an XPointer: an `element()` pointer, a shorthand being one with no steps, or a scheme left unsupported. */
export type PointerPart =
  | { readonly kind: 'element'; readonly id: string | undefined; readonly steps: readonly number[] }
  | { readonly kind: 'unsupported'; readonly scheme: string };

/** A child sequence, the `childseq` of XPointer's `element()` scheme: `/1/3`, positions counted from 1. */
const CHILD_SEQUENCE = /^(\/[1-9]\d*)+$/;

/** Parses `element()` scheme data: an NCName, a child sequence such as `/1/3`, or both. */
function parseElementPart(data: string): PointerPart | undefined {
  const slash = data.indexOf('/');
  const id = slash === -1 ? data : data.slice(0, slash);
  const sequence = slash === -1 ? '' : data.slice(slash);
  if (id !== '' && !isNcName(id)) return undefined;
  if (sequence !== '' && !CHILD_SEQUENCE.test(sequence)) return undefined;
  if (id === '' && sequence === '') return undefined;
  const steps = sequence === '' ? [] : sequence.slice(1).split('/').map(Number);
  return { kind: 'element', id: id === '' ? undefined : id, steps };
}

/** Reads one part's scheme data from just after its `(`, undoing `^` escapes; returns it and the index after its `)`. */
function readSchemeData(value: string, start: number): [string, number] | undefined {
  let data = '';
  let depth = 0;
  for (let i = start; i < value.length; i++) {
    const char = value[i] as string;
    if (char === '^') {
      const next = value[i + 1] ?? '';
      if (!'()^'.includes(next) || next === '') return undefined;
      data += next;
      i++;
      continue;
    }
    if (char === ')' && depth === 0) return [data, i + 1];
    if (char === '(') depth++;
    if (char === ')') depth--;
    data += char;
  }
  return undefined;
}

/** Parses an `xpointer` attribute: a shorthand pointer or scheme-based parts (XPointer Framework); undefined if it is not well-formed. */
export function parsePointer(value: string): PointerPart[] | undefined {
  if (isNcName(value)) return [{ kind: 'element', id: value, steps: [] }];
  const parts: PointerPart[] = [];
  let i = 0;
  while (i < value.length) {
    while (/\s/.test(value[i] ?? '')) i++;
    if (i === value.length) break;
    const open = value.indexOf('(', i);
    const scheme = open === -1 ? '' : value.slice(i, open);
    if (!isXmlName(scheme)) return undefined;
    const read = readSchemeData(value, open + 1);
    if (read === undefined) return undefined;
    const [data, after] = read;
    // An element() part whose data is not well-formed identifies nothing, as a part in an unknown scheme does.
    parts.push((scheme === 'element' ? parseElementPart(data) : undefined) ?? { kind: 'unsupported', scheme });
    i = after;
  }
  return parts.length === 0 ? undefined : parts;
}

/** The element facts a matcher needs at a start tag: its ID values. */
export interface PointerElement {
  readonly ids: readonly string[];
}

/** What a matcher needs of a start tag: the values of its attributes of type ID. */
function pointerElementOf(tag: StreamReader | AsyncStreamReader): PointerElement {
  const ids: string[] = [];
  for (let i = 0; i < tag.attributeCount(); i++) if (tag.attributeType(i) === 'ID') ids.push(tag.attributeValue(i));
  return { ids };
}

/**
 * Follows a document's start and end tags and tells which part of a pointer, if any, the current
 * element is. Each element's place is its child sequence: `/1/3` is the third child of the document
 * element. A part such as `element(intro/2)` identifies the second child of the element whose ID is
 * `intro`. The leftmost part that identifies anything wins (XPointer Framework §3.3), so a later
 * part's match is only noted, in case the earlier parts identify nothing.
 */
export class PointerMatcher {
  readonly #parts: readonly PointerPart[];
  /** The child sequence of the current element: each open element's position among its siblings, from 1. */
  readonly #childSequence: number[] = [];
  /** How many children each open element, and the document, has had so far. */
  readonly #childCounts: number[] = [0];
  /** For each part with an ID, the child sequence of the element bearing it once found. */
  readonly #anchors: (number[] | undefined)[];
  /** The first part in a scheme exemplar supports, which wins as soon as it identifies an element. */
  readonly #firstSupportedPart: number;
  /** For each part, the child sequence of the first element it identified, while an earlier part may still win. */
  readonly #laterMatches: (readonly number[] | undefined)[];

  constructor(parts: readonly PointerPart[]) {
    this.#parts = parts;
    this.#anchors = parts.map(() => undefined);
    this.#firstSupportedPart = parts.findIndex((part) => part.kind === 'element');
    this.#laterMatches = parts.map(() => undefined);
  }

  /** Enters an element; true when the winning part identifies it, noting what later parts identify. */
  select(element: PointerElement): boolean {
    const part = this.#enterElement(element);
    if (part === this.#firstSupportedPart) return part !== -1;
    if (part !== -1) this.#laterMatches[part] ??= [...this.#childSequence];
    return false;
  }

  /** The child sequence of the element the leftmost later part identified, if any. */
  get laterMatch(): readonly number[] | undefined {
    return this.#laterMatches.find((sequence) => sequence !== undefined);
  }

  /** Enters an element; returns the index of the first part that identifies it, or -1. */
  #enterElement(element: PointerElement): number {
    const depth = this.#childSequence.length;
    const position = (this.#childCounts[depth] as number) + 1;
    this.#childCounts[depth] = position;
    this.#childSequence.push(position);
    this.#childCounts[depth + 1] = 0;
    let found = -1;
    for (const [partIndex, part] of this.#parts.entries()) {
      if (part.kind !== 'element') continue;
      if (part.id !== undefined && this.#anchors[partIndex] === undefined && element.ids.includes(part.id)) {
        this.#anchors[partIndex] = [...this.#childSequence];
      }
      if (found === -1 && this.#identifies(partIndex, part)) found = partIndex;
    }
    return found;
  }

  /** Leaves the current element. */
  end(): void {
    this.#childSequence.pop();
  }

  /** Whether a part identifies the current element: its child sequence is the anchor's, if the part has an ID, then the steps. */
  #identifies(
    partIndex: number,
    part: { readonly id: string | undefined; readonly steps: readonly number[] }
  ): boolean {
    const anchor = part.id === undefined ? [] : this.#anchors[partIndex];
    if (anchor === undefined) return false;
    const path = this.#childSequence;
    if (path.length !== anchor.length + part.steps.length) return false;
    for (let i = 0; i < anchor.length; i++) if (path[i] !== anchor[i]) return false;
    for (let i = 0; i < part.steps.length; i++) if (path[anchor.length + i] !== part.steps[i]) return false;
    return true;
  }
}

/** What a pointer selects from a document as it is read: the selected element's depth, once it is found. */
export class Selection {
  readonly #matcher: PointerMatcher;
  /** The selected element's depth, undefined until it is found. */
  depth: number | undefined;

  constructor(parts: readonly PointerPart[]) {
    this.#matcher = new PointerMatcher(parts);
  }

  /** Enters a start tag at a depth, before the selected element is found; whether it is that element. */
  select(tag: StreamReader | AsyncStreamReader, depth: number): boolean {
    if (!this.#matcher.select(pointerElementOf(tag))) return false;
    this.depth = depth;
    return true;
  }

  /** Leaves an end tag, before the selected element is found. */
  end(): void {
    this.#matcher.end();
  }

  /** 'selected' once the element is found, else the child sequence of one only a later part identified. */
  outcome(): 'selected' | readonly number[] | undefined {
    return this.depth === undefined ? this.#matcher.laterMatch : 'selected';
  }
}
