import { describe, expect, it } from 'vitest';
import { type StreamReader, XMLInputFactory } from '@exemplarjs/xml';
import { NO_FIXUPS, endTagOverlay, topOverlay } from '@/overlay.ts';
import type { Scope } from '@/scopes.ts';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const FIXUPS = { fixupBaseURIs: true, fixupLanguage: true };
const BASE = 'file:///doc/main.xml';

/** A reader at a document's first start tag. */
function startTag(xml: string): StreamReader {
  const reader = new XMLInputFactory().createStreamReader(xml);
  reader.next();
  return reader;
}

/** What is in scope at an element: its base URI, language and namespace bindings. */
function scope(base: string, lang?: string, namespaces: Record<string, string> = {}): Scope {
  return { base, lang, namespaces: new Map(Object.entries(namespaces)) };
}

describe('topOverlay (XInclude §4.5.5, §4.5.6)', () => {
  it('changes nothing when the element has its parent’s base URI, language and namespaces', () => {
    expect(topOverlay(startTag('<a/>'), scope(BASE, 'en'), scope(BASE, 'en'), FIXUPS, false)).toBeUndefined();
  });

  it('adds an xml:base relative to the parent’s, in place of the element’s own', () => {
    const overlay = topOverlay(
      startTag('<a xml:base="x/" b="1"/>'),
      scope('file:///doc/x/'),
      scope(BASE),
      FIXUPS,
      false
    );
    expect(overlay).toEqual({
      kept: [1],
      added: [{ name: 'xml:base', localName: 'base', prefix: 'xml', namespaceURI: XML_NS, value: 'x/' }],
      declarations: [],
    });
  });

  it('adds an xml:lang when the language differs, ignoring case, and an empty one under a parent with one', () => {
    /** The attributes the overlay for `<a/>` adds, as names and values. */
    const lang = (own: string | undefined, parent: string): string[][] | undefined => {
      const overlay = topOverlay(startTag('<a/>'), scope(BASE, own), scope(BASE, parent), FIXUPS, false);
      return overlay?.added.map((a) => [a.name, a.value]);
    };
    expect(lang('fr', 'en')).toEqual([['xml:lang', 'fr']]);
    expect(lang(undefined, 'en')).toEqual([['xml:lang', '']]);
    expect(lang('EN', 'en')).toBeUndefined();
    const own = startTag('<a xml:lang="fr"/>');
    expect(topOverlay(own, scope(BASE, 'fr'), scope(BASE, 'en'), FIXUPS, false)).toBeUndefined();
  });

  it('declares the bindings the parent lacks, and undeclares a default namespace the parent has', () => {
    const inScope = scope(BASE, undefined, { p: 'urn:p' });
    const parent = scope(BASE, undefined, { '': 'urn:d' });
    expect(topOverlay(startTag('<a/>'), inScope, parent, FIXUPS, false)?.declarations).toEqual([
      ['p', 'urn:p'],
      ['', ''],
    ]);
    expect(topOverlay(startTag('<a xmlns:p="urn:p"/>'), inScope, scope(BASE), FIXUPS, false)).toBeUndefined();
  });

  it('gives the declarations as attributes too with namespacePrefixes, before the fix-ups', () => {
    const overlay = topOverlay(
      startTag('<a/>'),
      scope('file:///doc/x/a.xml', undefined, { p: 'urn:p' }),
      scope(BASE),
      FIXUPS,
      true
    );
    expect(overlay?.added.map((a) => [a.name, a.namespaceURI, a.value])).toEqual([
      ['xmlns:p', XMLNS_NS, 'urn:p'],
      ['xml:base', XML_NS, 'x/a.xml'],
    ]);
  });

  it('makes no fix-ups when none are asked for, as at the top of a fallback', () => {
    const inScope = scope('file:///doc/x/a.xml', 'fr', { p: 'urn:p' });
    expect(topOverlay(startTag('<a/>'), inScope, scope(BASE, 'en'), NO_FIXUPS, false)).toEqual({
      kept: [],
      added: [],
      declarations: [['p', 'urn:p']],
    });
  });
});

describe('endTagOverlay', () => {
  it('has no attributes, and the declarations added to the start tag', () => {
    expect(endTagOverlay([['p', 'urn:p']])).toEqual({ kept: [], added: [], declarations: [['p', 'urn:p']] });
  });
});
