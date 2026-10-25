import { expect, it } from 'vitest';
import { EventType, isCharacterData } from '@/cursor/event-type.ts';

it('numbers the events as StAX XMLStreamConstants does', () => {
  expect(EventType).toMatchObject({
    START_ELEMENT: 1,
    END_ELEMENT: 2,
    PROCESSING_INSTRUCTION: 3,
    CHARACTERS: 4,
    COMMENT: 5,
    SPACE: 6,
    START_DOCUMENT: 7,
    END_DOCUMENT: 8,
    ENTITY_REFERENCE: 9,
    ATTRIBUTE: 10,
    DTD: 11,
    CDATA: 12,
    NAMESPACE: 13,
    NOTATION_DECLARATION: 14,
    ENTITY_DECLARATION: 15,
  });
});

it('numbers its own events beyond StAX: NEED_INPUT, START_ENTITY and END_ENTITY', () => {
  expect([EventType.NEED_INPUT, EventType.START_ENTITY, EventType.END_ENTITY]).toEqual([257, 258, 259]);
});

it('gives every event a distinct number', () => {
  const values = Object.values(EventType);
  expect(new Set(values).size).toBe(values.length);
});

it('counts text, CDATA and ignorable whitespace as character data', () => {
  const data = Object.values(EventType).filter((event) => isCharacterData(event));
  expect(data.toSorted((a, b) => a - b)).toEqual([EventType.CHARACTERS, EventType.SPACE, EventType.CDATA]);
});
