import { describe, expect, it } from 'vitest';
import { EventType, type StreamReader, XMLInputFactory } from '@exemplarjs/xml';
import { Declarations } from '@/declarations.ts';

/** A DTD declaring a notation, an unparsed entity, and attributes naming them. */
function dtd(logo: string, gif: string): string {
  return (
    `<!DOCTYPE r [<!NOTATION gif SYSTEM "${gif}"><!ENTITY logo SYSTEM "${logo}" NDATA gif>` +
    '<!ATTLIST r pics ENTITIES #IMPLIED kind NOTATION (gif) #IMPLIED>]>'
  );
}

/** A reader at the root start tag of a document read from a URI. */
function root(xml: string, systemId = 'file:///doc/part.xml'): StreamReader {
  const reader = new XMLInputFactory().createStreamReader({ text: xml, systemId });
  while (reader.next() !== EventType.START_ELEMENT);
  return reader;
}

/** Fails as the reader does on a declaration made differently. */
function conflict(what: string): never {
  throw new Error(what);
}

/** The declarations a document has, before anything is included. */
function declarations(reader: StreamReader): Declarations {
  return new Declarations(reader, conflict);
}

describe('Declarations (XInclude §4.5.1)', () => {
  it('adds the unparsed entities and notations a start tag names, each entity with its notation', () => {
    const tag = root(`${dtd('logo.gif', 'image/gif')}<r pics="logo" kind="gif"/>`);
    const ours = declarations(root('<r/>', 'file:///doc/main.xml'));
    ours.addNamedBy(tag, declarations(tag));
    const added = ours.included.map((item) => [item.kind, 'declaration' in item ? item.declaration.name : '']);
    expect(added).toEqual([
      ['entity', 'logo'],
      ['notation', 'gif'],
    ]);
    expect(ours.entity('logo')?.notation).toBe('gif');
    expect(ours.notation('gif')?.systemId).toBe('image/gif');
  });

  it('keeps one declaration when both documents make it the same way, resolving system identifiers', () => {
    const tag = root(`${dtd('logo.gif', 'image/gif')}<r pics="logo"/>`);
    const ours = declarations(root(`${dtd('logo.gif', 'image/gif')}<r/>`, 'file:///doc/main.xml'));
    ours.addNamedBy(tag, declarations(tag));
    expect(ours.included).toEqual([]);
  });

  it('knows only the unparsed entities of a document, not its parsed ones', () => {
    const tag = root(`<!DOCTYPE r [<!ENTITY text "parsed"><!ENTITY logo SYSTEM "logo.gif" NDATA gif>]><r/>`);
    const theirs = declarations(tag);
    expect([theirs.entity('text'), theirs.entity('logo')?.name]).toEqual([undefined, 'logo']);
  });

  it('fails on an unparsed entity or a notation declared differently', () => {
    const tag = root(`${dtd('logo.gif', 'image/gif')}<r pics="logo"/>`);
    const other = declarations(root(`${dtd('other.gif', 'image/gif')}<r/>`, 'file:///doc/main.xml'));
    expect(() => other.addNamedBy(tag, declarations(tag))).toThrow('The unparsed entity logo');
    const notation = root(`${dtd('logo.gif', 'image/gif')}<r kind="gif"/>`);
    const png = declarations(root(`${dtd('logo.gif', 'image/png')}<r/>`, 'file:///doc/main.xml'));
    expect(() => png.addNamedBy(notation, declarations(notation))).toThrow('The notation gif');
  });
});
