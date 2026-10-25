import { describe, expect, it } from 'vitest';
import * as filters from '@/filters/index.ts';
import { StreamReaderDelegate, createFilteredReader } from '@/filters/index.ts';
import { EventType, type XMLEvent, XMLInputFactory } from '@/index.ts';

const xml = new XMLInputFactory();
const DOCUMENT = '<a><!--c--><?p d?><b>t</b></a>';

/** The event types a reader gives. */
function types(reader: { next(): EventType }): EventType[] {
  const out: EventType[] = [];
  for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) out.push(e);
  return out;
}

describe('@exemplarjs/xml/filters', () => {
  it('exports the filtered readers and the delegate', () => {
    expect(Object.keys(filters).toSorted()).toEqual(['StreamReaderDelegate', 'createFilteredReader']);
    expect(StreamReaderDelegate).toBeTypeOf('function');
  });
});

describe('filtered readers (StAX StreamFilter)', () => {
  it('pass on only the events the filter accepts', () => {
    const reader = createFilteredReader(
      xml.createStreamReader(DOCUMENT),
      (r) => r.eventType() !== EventType.COMMENT && r.eventType() !== EventType.PROCESSING_INSTRUCTION
    );
    expect(types(reader)).toEqual([
      EventType.START_ELEMENT,
      EventType.START_ELEMENT,
      EventType.CHARACTERS,
      EventType.END_ELEMENT,
      EventType.END_ELEMENT,
    ]);
  });

  it('are the reader they were given, the filter running inside its next()', () => {
    const cursor = xml.createStreamReader(DOCUMENT);
    expect(createFilteredReader(cursor, () => true)).toBe(cursor);
  });

  it('combine filters, which read the cursor directly', () => {
    const names: string[] = [];
    const reader = createFilteredReader(
      createFilteredReader(xml.createStreamReader(DOCUMENT), (r) => r.eventType() === EventType.START_ELEMENT),
      (r) => r.localName() !== 'a'
    );
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) names.push(reader.localName());
    expect(names).toEqual(['b']);
  });

  it('always pass END_DOCUMENT, without asking the filter', () => {
    const asked: EventType[] = [];
    const reader = createFilteredReader(xml.createStreamReader('<a/>'), (r) => {
      asked.push(r.eventType());
      return false;
    });
    expect(reader.next()).toBe(EventType.END_DOCUMENT);
    expect(asked).toEqual([EventType.START_ELEMENT, EventType.END_ELEMENT]);
  });

  it('leave the accessors describing the event the filter accepted', () => {
    const reader = createFilteredReader(
      xml.createStreamReader('<a x="1"><b y="2"/></a>'),
      (r) => r.localName() === 'b'
    );
    expect([reader.next(), reader.name(), reader.attributeValue(0)]).toEqual([EventType.START_ELEMENT, 'b', '2']);
  });

  it('see the events of a filtered asynchronous reader as they come', async () => {
    const reader = createFilteredReader(xml.createAsyncStreamReader(), (r) => r.eventType() !== EventType.COMMENT);
    reader.feed(new TextEncoder().encode('<a><!--c-->'));
    const seen: EventType[] = [];
    for (let e = reader.next(); e !== EventType.NEED_INPUT; e = reader.next()) seen.push(e);
    reader.feed(new TextEncoder().encode('</a>'));
    reader.endOfInput();
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) seen.push(e);
    expect(seen).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT, EventType.END_ELEMENT]);
  });
});

describe('filtered event readers (StAX EventFilter)', () => {
  it('filter event readers, always passing END_DOCUMENT', () => {
    const reader = createFilteredReader(xml.createEventReader(DOCUMENT), (e) => e.type === EventType.START_ELEMENT);
    expect([...reader].map((e) => e.type)).toEqual([
      EventType.START_ELEMENT,
      EventType.START_ELEMENT,
      EventType.END_DOCUMENT,
    ]);
  });

  it('are the event reader they were given', () => {
    const reader = xml.createEventReader(DOCUMENT);
    expect(createFilteredReader(reader, () => true)).toBe(reader);
  });

  it('filter asynchronous event readers', async () => {
    const reader = createFilteredReader(
      xml.createAsyncEventReader(DOCUMENT),
      (e: XMLEvent) => e.type === EventType.CHARACTERS
    );
    const texts: string[] = [];
    for await (const event of reader) if (event.type === EventType.CHARACTERS) texts.push(event.text);
    expect(texts).toEqual(['t']);
  });
});
