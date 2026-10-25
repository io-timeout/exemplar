import { newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';

describe('DocumentFragment (DOM Level 1)', () => {
  it('is a fragment node named #document-fragment', () => {
    const fragment = newDocument().createDocumentFragment();
    expect([fragment.nodeType, fragment.nodeName, fragment.nodeValue, fragment.textContent]).toEqual([
      11,
      '#document-fragment',
      null,
      '',
    ]);
  });
});
