import { canonical } from '@test/helpers/parse.ts';
import { SINGLE_BYTE_TABLES } from '@/encodings/tables.ts';
import { type InputOptions, type Source, XMLError } from '@/index.ts';
import { PENDING, type TextSource } from '@/input/source.ts';
import { ScanError } from '@/scan/scanner.ts';
import { Token, Tokenizer, type TokenizerOptions } from '@/tokenizer/tokenizer.ts';

/** Bytes from their values. */
export function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** A string's UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Joins byte arrays. */
export function join(...parts: Uint8Array[]): Uint8Array {
  return bytes(...parts.flatMap((part) => [...part]));
}

/** UTF-8 text around raw bytes, such as bytes of another encoding or bad ones. */
export function framed(before: string, raw: readonly number[], after = ''): Uint8Array {
  return join(utf8(before), bytes(...raw), utf8(after));
}

/** A string's UTF-16 code units in one byte order, after a byte-order mark if asked. */
export function utf16(text: string, littleEndian: boolean, bom = false): Uint8Array {
  const units = bom ? `\uFEFF${text}` : text;
  const out = new Uint8Array(units.length * 2);
  const view = new DataView(out.buffer);
  // eslint-disable-next-line prefer-code-point -- UTF-16 is written in code units
  for (let i = 0; i < units.length; i++) view.setUint16(i * 2, units.charCodeAt(i), littleEndian);
  return out;
}

/** A string's code points as four bytes each, in a byte order such as '1234' (big-endian), after a BOM if asked. */
export function utf32(text: string, order: string, bom = false): Uint8Array {
  const points = Array.from(bom ? `\uFEFF${text}` : text, (c) => c.codePointAt(0) as number);
  const out = new Uint8Array(points.length * 4);
  for (const [i, c] of points.entries()) {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = (c >>> ((4 - Number(order[k])) * 8)) & 0xff;
  }
  return out;
}

/** A string in a single-byte encoding exemplar has a table for. */
export function singleByte(name: string, text: string): Uint8Array {
  const table = SINGLE_BYTE_TABLES[name] as string;
  const offset = 256 - table.length;
  return Uint8Array.from(text, (c) => {
    // eslint-disable-next-line prefer-code-point -- single-byte encodings hold BMP characters only
    const code = c.charCodeAt(0);
    if (offset > 0 && code < offset) return code;
    const index = table.indexOf(c);
    if (index === -1) throw new Error(`${name} cannot encode ${c}`);
    return index + offset;
  });
}

/** Splits bytes into chunks of one size. */
export function split(data: Uint8Array, size: number): Uint8Array[] {
  return Array.from({ length: Math.ceil(data.length / size) }, (_, i) => data.subarray(i * size, (i + 1) * size));
}

/** What reading a source gives: `accepted` and the canonical form, or the error's code and location. */
export function verdict(source: Source, options: InputOptions = {}): string {
  try {
    return `accepted ${canonical(source, options)}`;
  } catch (error) {
    if (error instanceof XMLError) return `${error.code} ${error.line}:${error.column}`;
    throw error;
  }
}

/** A text source that gives the strings in turn, and PENDING for each null. */
export function textSource(...chunks: (string | null)[]): TextSource {
  const queue = [...chunks];
  return {
    detection: undefined,
    read() {
      if (queue.length === 0) return undefined;
      return queue.shift() ?? PENDING;
    },
  };
}

/** Describes the tokenizer's current token from its spans. */
export function describeToken(t: Tokenizer): string {
  const slice = (start: number, end: number): string => t.buffer.slice(start, end);
  const name = slice(t.nameStart, t.nameEnd);
  const value = JSON.stringify(slice(t.valueStart, t.valueEnd));
  switch (t.kind) {
    case Token.START_TAG: {
      const attributes = Array.from({ length: t.attributeCount }, (_, i) => {
        const attribute = slice(t.attributeNameStart[i] as number, t.attributeNameEnd[i] as number);
        return ` ${attribute}=${JSON.stringify(slice(t.attributeValueStart[i] as number, t.attributeValueEnd[i] as number))}`;
      });
      return `<${name}${attributes.join('')}${t.selfClosing ? '/' : ''}>`;
    }
    case Token.END_TAG: {
      return `</${name}>`;
    }
    case Token.TEXT: {
      return `text ${value}`;
    }
    case Token.CDATA: {
      return `cdata ${value}`;
    }
    case Token.COMMENT: {
      return `comment ${value}`;
    }
    case Token.PI: {
      return `pi ${name} ${value}`;
    }
    case Token.DOCTYPE: {
      const subset = t.doctype.subsetStart < 0 ? '' : ` [${slice(t.doctype.subsetStart, t.doctype.subsetEnd)}]`;
      return `doctype ${name} ${t.doctype.publicId ?? '-'} ${t.doctype.systemId ?? '-'}${subset}`;
    }
    case Token.ENTITY_REFERENCE: {
      return `&${name};`;
    }
    default: {
      return `kind ${t.kind}`;
    }
  }
}

/** Tokenizes text given in chunks to its end; each token described, and a scan error as its code and document offset. */
export function tokens(chunks: readonly (string | null)[], options: Partial<TokenizerOptions> = {}): string[] {
  const t = new Tokenizer(textSource(...chunks), { maxNameLength: 1000, ...options });
  const out: string[] = [];
  try {
    while (!t.readDeclaration()) out.push('need input');
    for (let kind = t.next(); kind !== Token.END; kind = t.next())
      out.push(kind === Token.NEED_INPUT ? 'need input' : describeToken(t));
  } catch (error) {
    if (!(error instanceof ScanError)) throw error;
    out.push(`${error.code} @${t.bufferOffset + error.index}`);
  }
  return out;
}

/** Splits a string into pieces of one size. */
export function pieces(text: string, size: number): string[] {
  return Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
}
