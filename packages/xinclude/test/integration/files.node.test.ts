import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@exemplarjs/canonical';
import { DocumentBuilder } from '@exemplarjs/dom';
import { XMLInputFactory } from '@exemplarjs/xml';
import { fileResolver } from '@exemplarjs/xml/resolvers/file';
import { xincludeProcessor } from '@/index.ts';

// Real files need a file system, so these tests run on Node only.
const ROOT = new URL('../fixtures/book/', import.meta.url);
const BOOK = new URL('book.xml', ROOT).href;

/** A factory with XInclude on that reads files below the fixtures. */
function files(): XMLInputFactory {
  return new XMLInputFactory({
    xinclude: xincludeProcessor(),
    accessExternalEntities: ['file'],
    entityResolver: fileResolver({ root: fileURLToPath(ROOT) }),
  });
}

describe('XInclude over files', () => {
  it('includes documents, pointers, fallbacks and text in several encodings', () => {
    const reader = files().createStreamReader({ bytes: readFileSync(new URL(BOOK)), systemId: BOOK });
    expect(canonicalize(reader, { method: 'exc-c14n' })).toBe(
      '<book xml:lang="en">\n' +
        '  <chapter xml:base="chapters/one.xml" xml:lang="fr"><title>Un</title></chapter>\n' +
        '  <para xml:base="chapters/two.xml" xml:id="summary" xml:lang="">In short</para>\n' +
        '  <missing></missing>\n' +
        '  <latin>café</latin>\n' +
        '  <utf16>naïve</utf16>\n' +
        '</book>'
    );
  });

  it('gives the DOM each included element’s file as its base URI', () => {
    const doc = new DocumentBuilder(files()).parse({ bytes: readFileSync(new URL(BOOK)), systemId: BOOK });
    expect(doc.getElementsByTagName('para').item(0)?.baseURI).toBe(new URL('chapters/two.xml', ROOT).href);
  });

  it('reads the document again from its file for an intra-document reference given as chunks', () => {
    const self = new URL('self.xml', ROOT);
    const reader = files().createStreamReader({ chunks: [readFileSync(self)], systemId: self.href });
    expect(canonicalize(reader, { method: 'exc-c14n' })).toBe('<r><x>X</x><x>X</x></r>');
  });
});
