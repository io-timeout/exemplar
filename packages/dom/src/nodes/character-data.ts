import { fail } from '../names.ts';
import type { Document } from './document.ts';
import { Node, holdsNoChildren } from './node.ts';

/** Text, comments and CDATA, following DOM's CharacterData. */
export abstract class CharacterData extends Node {
  /** @internal */ declare _data: string;

  constructor(owner: Document | null, data: string) {
    super(owner);
    this._data = data;
  }

  get data(): string {
    return this._data;
  }

  set data(data: string) {
    this._checkWritable();
    this._data = String(data);
  }

  override get nodeValue(): string {
    return this._data;
  }

  override set nodeValue(value: string | null) {
    this.data = value ?? '';
  }

  override get textContent(): string {
    return this._data;
  }

  override set textContent(text: string | null) {
    this.data = text ?? '';
  }

  get length(): number {
    return this._data.length;
  }

  substringData(offset: number, count: number): string {
    checkRange(this, offset, count);
    return this._data.slice(offset, offset + count);
  }

  appendData(data: string): void {
    this._checkWritable();
    this._data += data;
  }

  insertData(offset: number, data: string): void {
    this.replaceData(offset, 0, data);
  }

  deleteData(offset: number, count: number): void {
    this.replaceData(offset, count, '');
  }

  replaceData(offset: number, count: number, data: string): void {
    this._checkWritable();
    checkRange(this, offset, count);
    this._data = this._data.slice(0, offset) + data + this._data.slice(offset + count);
  }
}

/** Throws when an offset or count falls outside the data (INDEX_SIZE_ERR). */
function checkRange(node: CharacterData, offset: number, count = 0): void {
  if (offset < 0 || offset > node._data.length || count < 0) fail('IndexSizeError', 'The offset is outside the data');
}

holdsNoChildren(CharacterData);
