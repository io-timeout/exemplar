import { parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { createFilteredReader } from '@/filters/index.ts';
import { type AsyncStreamReader, EventType, type InputOptions, type StreamReader, XMLInputFactory } from '@/index.ts';

const COALESCING: InputOptions = { coalescing: true };

/** One event as `type text @line:column`. */
function describeEvent(r: StreamReader | AsyncStreamReader, e: EventType): string {
  const { line, column } = r.location();
  const detail = e === EventType.START_ELEMENT || e === EventType.END_ELEMENT ? r.name() : r.text();
  return `${e} ${detail} @${line}:${column}`;
}

/** The events of a document with coalescing on, after the DTD. */
function merged(xml: string, options: InputOptions = {}): string[] {
  const r = reader(xml, { ...COALESCING, ...options });
  const out: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next())
    if (e !== EventType.DTD) out.push(describeEvent(r, e));
  return out;
}

/** The events of a document fed a byte at a time to an asynchronous reader with coalescing on. */
function fedMerged(xml: string): string[] {
  const r = new XMLInputFactory(COALESCING).createAsyncStreamReader();
  const bytes = new TextEncoder().encode(xml);
  const out: string[] = [];
  let at = 0;
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
    if (e === EventType.NEED_INPUT) {
      if (at < bytes.length) r.feed(bytes.subarray(at, ++at));
      else r.endOfInput();
    } else if (e !== EventType.START_DOCUMENT && e !== EventType.DTD) {
      out.push(describeEvent(r, e));
    }
  }
  return out;
}

describe('coalescing (StAX IS_COALESCING)', () => {
  it('merges text, CDATA and references into one CHARACTERS event', () => {
    expect(merged('<a>x<![CDATA[y]]>&amp;z<b/>w<![CDATA[]]></a>')).toEqual([
      '1 a @1:1',
      '4 xy&z @1:4',
      '1 b @1:24',
      '2 b @1:24',
      '4 w @1:28',
      '2 a @1:41',
    ]);
  });

  it('reports a lone CDATA section as CHARACTERS', () => {
    expect(merged('<a><![CDATA[x]]></a>')).toEqual(['1 a @1:1', '4 x @1:4', '2 a @1:17']);
  });

  it('merges the text of entities with the text around them', () => {
    const xml = '<!DOCTYPE a [<!ENTITY e "x<b/>y"><!ENTITY t "T">]><a>1&e;2&t;&t;3</a>';
    expect(merged(xml)).toEqual(['1 a @1:51', '4 1x @1:54', '1 b @1:55', '2 b @1:55', '4 y2TT3 @1:55', '2 a @1:66']);
  });

  it('does not merge across comments, PIs or unexpanded references', () => {
    expect(merged('<a>x<!--c-->y<?p?>z</a>').map((e) => e.split(' ')[0])).toEqual(['1', '4', '5', '4', '3', '4', '2']);
    expect(merged('<!DOCTYPE a SYSTEM "a.dtd"><a>x&u;y</a>').map((e) => e.split(' ')[0])).toEqual([
      '1',
      '4',
      '9',
      '4',
      '2',
    ]);
  });

  it('holds back the event read past the run and reports it next, empty-element tags included', () => {
    const r = reader('<a>x<![CDATA[y]]><b/></a>', COALESCING);
    expect([r.next(), r.next(), r.text()]).toEqual([EventType.START_ELEMENT, EventType.CHARACTERS, 'xy']);
    expect([r.next(), r.name(), r.next(), r.name(), r.next(), r.name()]).toEqual([1, 'b', 2, 'b', 2, 'a']);
  });

  it('reports the merged text as whitespace when it all is', () => {
    const r = reader('<a> <![CDATA[\t]]>\n<b/></a>', COALESCING);
    r.next();
    expect([r.next(), r.isWhitespace(), r.nextTag(), r.name()]).toEqual([EventType.CHARACTERS, true, 1, 'b']);
  });

  it('reads elementText through merged text', () => {
    const r = reader('<a>x<![CDATA[y]]>z</a>', COALESCING);
    r.next();
    expect(r.elementText()).toBe('xyz');
  });

  it('gives the same canonical form with and without coalescing, every way', () => {
    const xml = '<!DOCTYPE a [<!ENTITY t "T">]><a>x<![CDATA[y]]>&t;<b>&#65;<![CDATA[]]></b>z</a>';
    expect(parseEveryWay(xml, COALESCING)).toBe(parseEveryWay(xml));
  });

  it('merges a run that arrives over many chunks of an asynchronous reader', () => {
    const xml = '<a>one<![CDATA[two]]>&amp;three<b/>four</a>';
    expect(fedMerged(xml)).toEqual(merged(xml));
    expect(fedMerged(xml)[1]).toBe('4 onetwo&three @1:4');
  });

  it('shows filters the merged text, once', () => {
    const texts: string[] = [];
    const r = createFilteredReader(reader('<a>x<![CDATA[y]]>z<b/></a>', COALESCING), (cursor) => {
      if (cursor.eventType() === EventType.CHARACTERS) texts.push(cursor.text());
      return cursor.eventType() !== EventType.START_ELEMENT;
    });
    const types: EventType[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) types.push(e);
    expect(texts).toEqual(['xyz']);
    expect(types).toEqual([EventType.CHARACTERS, EventType.END_ELEMENT, EventType.END_ELEMENT]);
  });

  it('gives event objects the location where the merged text starts', () => {
    const events = [...new XMLInputFactory(COALESCING).createEventReader('<a>\n x<![CDATA[y]]></a>')];
    const text = events.find((e) => e.type === EventType.CHARACTERS);
    expect(text?.location).toMatchObject({ line: 1, column: 4, offset: 3 });
  });
});
