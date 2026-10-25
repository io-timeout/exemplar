import { describe, expect, it } from 'vitest';
import { EventType, XMLInputFactory } from '@/index.ts';

/** The text of each character-data, CDATA and comment event in a document, in order. */
function texts(xml: string): string[] {
  const reader = new XMLInputFactory().createStreamReader(xml);
  const found: string[] = [];
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) {
    if (event === EventType.CHARACTERS || event === EventType.CDATA || event === EventType.COMMENT)
      found.push(reader.text());
  }
  return found;
}

describe('tokenText', () => {
  it('normalizes CR LF and lone CR in text, CDATA and comments (§2.11)', () => {
    expect(texts('<a>x\r\ny\rz<![CDATA[c\r\nd]]><!--e\rf--></a>')).toEqual(['x\ny\nz', 'c\nd', 'e\nf']);
  });

  it('decodes references in text with line ends to normalize, and leaves text without references as it is', () => {
    expect(texts('<a>x&amp;\r\n&#13;y</a>')).toEqual(['x&\n\ry']);
    expect(texts('<a>&lt;\r\r\n</a><!-- &amp;\r -->')).toEqual(['<\n\n', ' &amp;\n ']);
  });
});
