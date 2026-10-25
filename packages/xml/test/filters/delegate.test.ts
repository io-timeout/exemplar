import { describe, expect, it } from 'vitest';
import { StreamReaderDelegate } from '@/filters/delegate.ts';
import { EventType, XMLInputFactory } from '@/index.ts';
import type { AsyncStreamReader as StreamReader } from '@/index.ts';

/** Every method a delegate forwards, with the arguments to call it with. */
const CALLS: readonly (readonly [keyof StreamReaderDelegate & keyof StreamReader, ...unknown[]])[] = [
  ['next'],
  ['hasNext'],
  ['eventType'],
  ['close'],
  ['name'],
  ['localName'],
  ['prefix'],
  ['namespaceURI', undefined],
  ['namespaceURI', 0],
  ['namespaceCount'],
  ['namespacePrefix', 0],
  ['attributeCount'],
  ['attributeName', 0],
  ['attributeLocalName', 0],
  ['attributePrefix', 0],
  ['attributeNamespace', 0],
  ['attributeType', 0],
  ['isAttributeSpecified', 0],
  ['attributeValue', 0],
  ['attributeValue', 'urn:p', 'x'],
  ['text'],
  ['isWhitespace'],
  ['piTarget'],
  ['piData'],
  ['doctype'],
  ['version'],
  ['encoding'],
  ['standalone'],
  ['location'],
  ['nextTag'],
  ['elementText'],
  ['fill'],
  ['feed', new Uint8Array(0)],
  ['endOfInput'],
  ['nextTagAsync'],
  ['elementTextAsync'],
  ['forEachEvent', () => undefined],
];

/** A parent that records each call and returns its name. */
function recordingParent(): { parent: StreamReader; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const parent = new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...args: unknown[]) => {
          calls.push([property, ...args]);
          return `result of ${String(property)}`;
        },
    }
  ) as StreamReader;
  return { parent, calls };
}

describe('StreamReaderDelegate (StAX StreamReaderDelegate)', () => {
  it.each(CALLS)('forwards %s to its parent with the same arguments, returning what it returns', (method, ...args) => {
    const { parent, calls } = recordingParent();
    const delegate = new StreamReaderDelegate(parent);
    const forward = (delegate as unknown as Record<string, (...a: unknown[]) => unknown>)[method as string];
    const result = forward?.call(delegate, ...args);
    expect(calls).toEqual([[method, ...args]]);
    expect(result).toBe(`result of ${method}`);
  });

  it('forwards to a new parent once it is replaced', () => {
    const delegate = new StreamReaderDelegate(new XMLInputFactory().createStreamReader('<a/>'));
    delegate.parent = new XMLInputFactory().createStreamReader('<b/>');
    expect([delegate.next(), delegate.name()]).toEqual([EventType.START_ELEMENT, 'b']);
  });

  it('reads a document through a real reader', () => {
    const reader = new StreamReaderDelegate(
      new XMLInputFactory().createStreamReader(
        '<?xml version="1.0"?><!DOCTYPE p:a><p:a xmlns:p="urn:p" p:x="1"><?t d?> <b>text</b></p:a>'
      )
    );
    expect([reader.version(), reader.encoding(), reader.standalone(), reader.hasNext()]).toEqual([
      '1.0',
      undefined,
      undefined,
      true,
    ]);
    expect([reader.next(), reader.doctype().name]).toEqual([EventType.DTD, 'p:a']);
    expect([reader.nextTag(), reader.name(), reader.localName(), reader.prefix(), reader.namespaceURI()]).toEqual([
      EventType.START_ELEMENT,
      'p:a',
      'a',
      'p',
      'urn:p',
    ]);
    expect([reader.namespaceCount(), reader.namespacePrefix(0), reader.namespaceURI(0)]).toEqual([1, 'p', 'urn:p']);
    expect([
      reader.attributeCount(),
      reader.attributeName(0),
      reader.attributeLocalName(0),
      reader.attributePrefix(0),
    ]).toEqual([1, 'p:x', 'x', 'p']);
    expect([reader.attributeNamespace(0), reader.attributeType(0), reader.isAttributeSpecified(0)]).toEqual([
      'urn:p',
      'CDATA',
      true,
    ]);
    expect([reader.attributeValue(0), reader.attributeValue('urn:p', 'x')]).toEqual(['1', '1']);
    expect([reader.next(), reader.piTarget(), reader.piData()]).toEqual([EventType.PROCESSING_INSTRUCTION, 't', 'd']);
    expect([reader.next(), reader.isWhitespace(), reader.text()]).toEqual([EventType.CHARACTERS, true, ' ']);
    expect([reader.nextTag(), reader.elementText(), reader.eventType()]).toEqual([
      EventType.START_ELEMENT,
      'text',
      EventType.END_ELEMENT,
    ]);
    expect(reader.location()).toMatchObject({ line: 1, column: 80 });
    expect([reader.next(), reader.next(), reader.hasNext()]).toEqual([
      EventType.END_ELEMENT,
      EventType.END_DOCUMENT,
      false,
    ]);
    reader.close();
  });

  it('lets a subclass change what an accessor returns', () => {
    class Upper extends StreamReaderDelegate {
      override localName(): string {
        return super.localName().toUpperCase();
      }
    }
    const reader = new Upper(new XMLInputFactory().createStreamReader('<a x="1">t</a>'));
    expect([reader.next(), reader.localName(), reader.attributeValue(0), reader.attributeValue('', 'x')]).toEqual([
      EventType.START_ELEMENT,
      'A',
      '1',
      '1',
    ]);
    expect([reader.next(), reader.text()]).toEqual([EventType.CHARACTERS, 't']);
  });

  it('forwards feeding and waiting to an asynchronous parent', async () => {
    const reader = new StreamReaderDelegate(new XMLInputFactory().createAsyncStreamReader());
    const filled = reader.fill();
    reader.feed(new TextEncoder().encode('<a/>'));
    await filled;
    reader.endOfInput();
    const types: EventType[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) types.push(e);
    expect(types).toEqual([EventType.START_DOCUMENT, EventType.START_ELEMENT, EventType.END_ELEMENT]);
  });
});
