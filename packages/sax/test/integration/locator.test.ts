import { describe, expect, it } from 'vitest';
import { type Locator, SAXParser } from '@/index.ts';

/** The locator's public and system identifiers at the root element, for a source object. */
function identifiersOf(source: { text: string; systemId?: string; publicId?: string }): string[] {
  let locator: Locator | undefined;
  let seen: string[] = [];
  new SAXParser().parse(source, {
    setDocumentLocator: (given) => {
      locator = given;
    },
    startElement: () => {
      seen = [String(locator?.publicId), String(locator?.systemId)];
    },
  });
  return seen;
}

describe('the locator of a source object (SAX Locator)', () => {
  it('reports the public identifier a source object gives, with or without a system identifier', () => {
    expect(identifiersOf({ text: '<a/>', publicId: '-//D//EN' })).toEqual(['-//D//EN', 'undefined']);
    expect(identifiersOf({ text: '<a/>', publicId: '-//D//EN', systemId: 'file:///d.xml' })).toEqual([
      '-//D//EN',
      'file:///d.xml',
    ]);
  });
});
