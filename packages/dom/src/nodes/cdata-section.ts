import { NodeType } from '../node-type.ts';
import type { Document } from './document.ts';
import type { Node } from './node.ts';
import { Text } from './text.ts';

// Module-level constants, so V8 can inline them.
const { CDATA_SECTION_NODE } = NodeType;

/** A CDATA section. */
export class CDATASection extends Text {
  override get nodeType(): number {
    return CDATA_SECTION_NODE;
  }

  override get nodeName(): string {
    return '#cdata-section';
  }

  override _shallow(owner: Document): Node {
    return new CDATASection(owner, this._data);
  }
}
