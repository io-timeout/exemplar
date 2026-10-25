import { XI, eventsAsync, events, memoryResolver } from '@test/helpers/xinclude.ts';
import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { XINCLUDE_NAMESPACE, xincludeProcessor } from '@/index.ts';

const FILES = { 'file:///doc/part.xml': '<part/>', 'file:///base/part.xml': '<based/>' };

/** A factory with the processor and in-memory files. */
function withProcessor(processor = xincludeProcessor(), async = false): XMLInputFactory {
  return new XMLInputFactory({
    xinclude: processor,
    accessExternalEntities: 'all',
    entityResolver: memoryResolver(FILES, async),
  });
}

describe('XINCLUDE_NAMESPACE', () => {
  it('is the XInclude 1.0 namespace (XInclude §2)', () => {
    expect(XINCLUDE_NAMESPACE).toBe('http://www.w3.org/2001/XInclude');
  });

  it('is the only namespace XInclude acts on', () => {
    const old = '<r xmlns:xi="http://www.w3.org/2003/XInclude"><xi:include href="part.xml"/></r>';
    expect(events(withProcessor().createStreamReader({ text: old, systemId: 'file:///doc/main.xml' }))).toBe(
      '<r xmlns:xi="http://www.w3.org/2003/XInclude"><xi:include href="part.xml"></xi:include></r>'
    );
  });
});

describe('xincludeProcessor', () => {
  const main = `<r ${XI} xml:lang="en"><xi:include href="part.xml"/></r>`;

  it.each([
    [{}, '<part xml:base="part.xml" xml:lang="">'],
    [{ fixupBaseURIs: false }, '<part xml:lang="">'],
    [{ fixupLanguage: false }, '<part xml:base="part.xml">'],
    [{ fixupBaseURIs: false, fixupLanguage: false }, '<part>'],
    [{ fixupBaseURIs: true, fixupLanguage: true }, '<part xml:base="part.xml" xml:lang="">'],
  ])('fixes up base URIs and languages unless told not to: %j', (settings, start) => {
    const reader = withProcessor(xincludeProcessor(settings)).createStreamReader({
      text: main,
      systemId: 'file:///doc/main.xml',
    });
    expect(events(reader)).toBe(`<r ${XI} xml:lang="en">${start}</part></r>`);
  });

  it('resolves against the base URI of a source given only a base URI', () => {
    const reader = withProcessor().createStreamReader({
      text: `<r ${XI}><xi:include href="part.xml"/></r>`,
      baseURI: 'file:///base/main.xml',
    });
    expect(events(reader)).toBe(`<r ${XI}><based xml:base="part.xml"></based></r>`);
  });

  it('cannot resolve a relative href in a document with no URI, which is a resource error', () => {
    const reader = withProcessor().createStreamReader(
      `<r ${XI}><xi:include href="part.xml"><xi:fallback>F</xi:fallback></xi:include></r>`
    );
    expect(events(reader)).toBe(`<r ${XI}>F</r>`);
  });

  it('makes asynchronous readers that wait for resolvers', async () => {
    const reader = withProcessor(xincludeProcessor(), true).createAsyncStreamReader({
      text: `<r ${XI}><xi:include href="part.xml"/></r>`,
      systemId: 'file:///doc/main.xml',
    });
    expect(await eventsAsync(reader)).toBe(`<r ${XI}><part xml:base="part.xml"></part></r>`);
  });

  it('can be shared by factories and readers', () => {
    const processor = xincludeProcessor();
    const source = { text: `<r ${XI}><xi:include href="part.xml"/></r>`, systemId: 'file:///doc/main.xml' };
    expect(events(withProcessor(processor).createStreamReader(source))).toBe(
      events(withProcessor(processor).createStreamReader(source))
    );
  });
});
