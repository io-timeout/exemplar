import { newDocument } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { CDATASection, Text } from '@/index.ts';

describe('CDATASection', () => {
  it('is a CDATA section node named #cdata-section', () => {
    const cdata = newDocument().createCDATASection('<x>');
    expect([cdata.nodeType, cdata.nodeName, cdata.data, cdata instanceof Text]).toEqual([
      4,
      '#cdata-section',
      '<x>',
      true,
    ]);
  });

  it('clones as a CDATA section', () => {
    const clone = newDocument().createCDATASection('c').cloneNode();
    expect([clone instanceof CDATASection, clone.nodeValue]).toEqual([true, 'c']);
  });
});
