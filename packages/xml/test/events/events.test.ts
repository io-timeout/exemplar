import { describe, expect, it } from 'vitest';
import { EventBuilder } from '@/events/events.ts';
import {
  type AsyncStreamReader,
  Attribute,
  EventType,
  type InputOptions,
  QName,
  type XMLEvent,
  XMLInputFactory,
} from '@/index.ts';

/** The events of a document as objects. */
function eventsOf(xml: string, options: InputOptions = {}): XMLEvent[] {
  return [...new XMLInputFactory(options).createEventReader(xml)];
}

/** The kinds of event object whose type may be `T`. */
type EventOf<T> = XMLEvent extends infer E ? (E extends XMLEvent ? (T extends E['type'] ? E : never) : never) : never;

/** The first event of a type. */
function first<T extends XMLEvent['type']>(events: XMLEvent[], type: T): EventOf<T> {
  const event = events.find((e) => e.type === type);
  if (event === undefined) throw new Error(`No event of type ${type}`);
  return event as EventOf<T>;
}

describe('QName (StAX QName)', () => {
  it('gives the qualified name as written', () => {
    expect(new QName('urn:a', 'local', 'p').toString()).toBe('p:local');
    expect(new QName('urn:a', 'local').toString()).toBe('local');
    expect(new QName('', 'local').prefix).toBe('');
  });
});

describe('Attribute', () => {
  it('is a QName with a value, a type and whether it was specified', () => {
    const attribute = new Attribute('urn:a', 'x', 'p', 'v', 'ID', false);
    expect(attribute).toBeInstanceOf(QName);
    expect([attribute.toString(), attribute.value, attribute.type, attribute.specified]).toEqual([
      'p:x',
      'v',
      'ID',
      false,
    ]);
    expect(attribute.name).toBe(attribute);
  });
});

describe('event objects (StAX XMLEvent)', () => {
  const DOCUMENT =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE a [<!ENTITY e "x">]><a xmlns="urn:d" xmlns:p="urn:p" p:i="1" j="2"><?t d?><!--c-->t<![CDATA[c]]>&e;</a>';
  const events = eventsOf(DOCUMENT);

  it('give START_DOCUMENT the XML declaration’s values', () => {
    expect(first(events, EventType.START_DOCUMENT)).toMatchObject({
      version: '1.0',
      encoding: 'UTF-8',
      standalone: true,
    });
  });

  it('give the DTD event the DOCTYPE as written and as declarations', () => {
    const dtd = first(events, EventType.DTD);
    expect(dtd.text).toBe('<!DOCTYPE a [<!ENTITY e "x">]>');
    expect(dtd.doctype).toMatchObject({
      name: 'a',
      internalSubset: '<!ENTITY e "x">',
      entities: [{ name: 'e', value: 'x' }],
    });
  });

  it('give a start tag its name, attributes and the namespaces it declares', () => {
    const start = first(events, EventType.START_ELEMENT);
    expect([start.name.namespaceURI, start.name.localName, start.name.prefix]).toEqual(['urn:d', 'a', '']);
    expect(start.namespaces).toEqual([
      { prefix: '', namespaceURI: 'urn:d' },
      { prefix: 'p', namespaceURI: 'urn:p' },
    ]);
    expect(start.attributes.map((a) => [a.namespaceURI, a.localName, a.prefix, a.value, a.type, a.specified])).toEqual([
      ['urn:p', 'i', 'p', '1', 'CDATA', true],
      ['', 'j', '', '2', 'CDATA', true],
    ]);
  });

  it('find a start tag’s attribute by local name and namespace, no namespace by default', () => {
    const start = first(events, EventType.START_ELEMENT);
    expect([start.attribute('i', 'urn:p')?.value, start.attribute('j')?.value, start.attribute('i')]).toEqual([
      '1',
      '2',
      undefined,
    ]);
  });

  it('give an end tag the start tag’s name and the namespaces going out of scope', () => {
    const start = first(events, EventType.START_ELEMENT);
    const end = first(events, EventType.END_ELEMENT);
    expect(end.name).toBe(start.name);
    expect(end.namespaces).toBe(start.namespaces);
  });

  it('give PIs their target and data, and text events their text', () => {
    expect(first(events, EventType.PROCESSING_INSTRUCTION)).toMatchObject({ target: 't', data: 'd' });
    expect(first(events, EventType.COMMENT).text).toBe('c');
    expect(
      events
        .filter((e) => e.type === EventType.CHARACTERS || e.type === EventType.CDATA)
        .map((e) => 'text' in e && e.text)
    ).toEqual(['t', 'c', 'x']);
  });

  it('give other kinds of event empty answers for what they do not have', () => {
    const start = first(events, EventType.START_ELEMENT) as unknown as Record<string, unknown>;
    expect([
      start['target'],
      start['data'],
      start['doctype'],
      start['version'],
      start['encoding'],
      start['standalone'],
    ]).toEqual(['', '', undefined, undefined, undefined, undefined]);
    const end = first(events, EventType.END_DOCUMENT) as unknown as {
      attributes: unknown;
      text: string;
      attribute(n: string): unknown;
    };
    expect([end.attributes, end.text, end.attribute('x')]).toEqual([[], '', undefined]);
  });

  it('give ENTITY_REFERENCE the entity’s name and replacement text', () => {
    const reference = first(
      eventsOf('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', { replaceEntityReferences: false }),
      EventType.ENTITY_REFERENCE
    );
    expect([reference.name, reference.text]).toEqual(['e', 'x']);
  });

  it('give START_ENTITY and END_ENTITY the entity’s name', () => {
    const boundaries = eventsOf('<!DOCTYPE a [<!ENTITY e "<b/>">]><a>&e;</a>', { reportEntityBoundaries: true }).filter(
      (e) => e.type === EventType.START_ENTITY || e.type === EventType.END_ENTITY
    );
    expect(boundaries.map((e) => [e.type, 'name' in e && e.name])).toEqual([
      [EventType.START_ENTITY, 'e'],
      [EventType.END_ENTITY, 'e'],
    ]);
  });

  it('report whitespace outside the root as SPACE when asked', () => {
    const space = first(eventsOf('<a/>\n', { reportPrologWhitespace: true }), EventType.SPACE);
    expect(space.text).toBe('\n');
  });

  it('share one hidden class across every kind of event', () => {
    const all = [
      ...events,
      ...eventsOf('<!DOCTYPE a [<!ENTITY e "<b/>">]><a>&e;</a>', { reportEntityBoundaries: true }),
    ];
    expect(new Set(all.map((e) => Object.keys(e).join(','))).size).toBe(1);
  });

  it('work out a location once, when first asked, and keep it', () => {
    const start = first(eventsOf('<r>\n  <a/></r>'), EventType.START_ELEMENT);
    const location = start.location;
    expect(location).toEqual({ line: 1, column: 1, offset: 0 });
    expect(start.location).toBe(location);
  });

  it('have the locations the cursor gives, entity boundaries among them', () => {
    const xml = `<!DOCTYPE r [<!ENTITY q 'x'><!ENTITY e "&q;&q;">]><r>&e;</r>`;
    const options = { reportEntityBoundaries: true };
    const reader = new XMLInputFactory(options).createStreamReader(xml);
    const fromCursor: string[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      fromCursor.push(`${e}@${reader.location().line}:${reader.location().column}`);
    }
    const fromObjects = eventsOf(xml, options)
      .filter((e) => e.type !== EventType.START_DOCUMENT && e.type !== EventType.END_DOCUMENT)
      .map((e) => `${e.type}@${e.location.line}:${e.location.column}`);
    expect(fromObjects).toEqual(fromCursor);
  });
});

describe('EventBuilder', () => {
  it('shares one QName among elements of the same name and namespace', () => {
    const starts = eventsOf('<a><a/><b/><a/></a>').filter((e) => e.type === EventType.START_ELEMENT);
    expect(starts[0]?.name).toBe(starts[1]?.name);
    expect(starts[0]?.name).toBe(starts[3]?.name);
    expect(starts[0]?.name).not.toBe(starts[2]?.name);
  });

  it('makes a new QName for the same qualified name in another namespace', () => {
    const starts = eventsOf('<r><p:a xmlns:p="u"/><p:a xmlns:p="v"/></r>').filter(
      (e) => e.type === EventType.START_ELEMENT
    );
    expect([starts[1]?.name.namespaceURI, starts[2]?.name.namespaceURI]).toEqual(['u', 'v']);
  });

  it('keeps names right past the number of names it shares', () => {
    const children = Array.from({ length: 4200 }, (_, i) => `<n${i}/>`).join('');
    const names = eventsOf(`<r>${children}<n0/><n4199/></r>`)
      .filter((e) => e.type === EventType.START_ELEMENT)
      .map((e) => e.name.localName);
    expect(names.slice(-2)).toEqual(['n0', 'n4199']);
  });

  it('builds an event for the cursor’s current event', () => {
    const reader = new XMLInputFactory().createStreamReader('<a x="1"/>');
    const builder = new EventBuilder();
    const type = reader.next();
    const event = builder.build(reader as AsyncStreamReader, type);
    expect(event.type === EventType.START_ELEMENT && [event.name.localName, event.attributes[0]?.value]).toEqual([
      'a',
      '1',
    ]);
  });
});
