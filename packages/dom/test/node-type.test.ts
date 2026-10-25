import { describe, expect, it } from 'vitest';
import { DocumentPosition, NodeType } from '@/node-type.ts';
import { Node } from '@/nodes/index.ts';

describe('NodeType', () => {
  it.each(Object.entries(NodeType))('numbers %s %i, as Node does', (name, value) => {
    expect(Node[name as keyof typeof NodeType]).toBe(value);
  });
});

describe('DocumentPosition', () => {
  it('gives each relation a bit of its own, as Node does', () => {
    const bits = Object.values(DocumentPosition);
    expect(bits.reduce((all, bit) => all | bit, 0)).toBe(0x3f);
    for (const [name, bit] of Object.entries(DocumentPosition)) {
      expect(Node[name as keyof typeof DocumentPosition]).toBe(bit);
    }
  });
});
