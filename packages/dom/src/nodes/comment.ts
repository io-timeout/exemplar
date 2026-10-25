import { NodeType } from '../node-type.ts';
import { CharacterData } from './character-data.ts';
import type { Document } from './document.ts';
import type { Node } from './node.ts';

// Module-level constants, so V8 can inline them.
const { COMMENT_NODE } = NodeType;

/** A comment. */
export class Comment extends CharacterData {
  get nodeType(): number {
    return COMMENT_NODE;
  }

  get nodeName(): string {
    return '#comment';
  }

  _shallow(owner: Document): Node {
    return new Comment(owner, this._data);
  }
}
