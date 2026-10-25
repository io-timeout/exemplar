import { split, textSource, utf8 } from '@test/helpers/lexical.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type Location, type Source, XMLInputFactory } from '@/index.ts';
import { LineSegment } from '@/tokenizer/lines.ts';
import { Token, Tokenizer } from '@/tokenizer/tokenizer.ts';

/** A line counter still recording a segment: it has counted up to offset 40, which is on line 9, starting at 38. */
const counting = {
  checkpointOffset: 40,
  locationOfOffset: (offset: number) => ({ line: 9, column: offset - 38 + 1, offset }),
};

describe('LineSegment', () => {
  it('keeps where it starts and the system id', () => {
    const segment = new LineSegment(3, 20, 'a.xml', counting);
    expect(segment).toMatchObject({
      firstLine: 3,
      firstLineStart: 20,
      systemId: 'a.xml',
      counter: counting,
      lineStarts: [],
    });
  });

  it('locates an offset on the segment’s first line before any line start is recorded', () => {
    const segment = new LineSegment(3, 20, undefined, counting);
    expect(segment.locate(25)).toEqual({ line: 3, column: 6, offset: 25 });
  });

  it('locates an offset by the last line start at or before it', () => {
    const segment = new LineSegment(1, 0, 'a.xml', counting);
    segment.lineStarts.push(5, 12, 30);
    expect(segment.locate(0)).toEqual({ line: 1, column: 1, offset: 0, systemId: 'a.xml' });
    expect(segment.locate(4)).toMatchObject({ line: 1, column: 5 });
    expect(segment.locate(5)).toMatchObject({ line: 2, column: 1 });
    expect(segment.locate(11)).toMatchObject({ line: 2, column: 7 });
    expect(segment.locate(12)).toMatchObject({ line: 3, column: 1 });
    expect(segment.locate(39)).toMatchObject({ line: 4, column: 10 });
  });

  it('asks the counter for an offset it has not counted up to', () => {
    const segment = new LineSegment(1, 0, undefined, counting);
    expect(segment.locate(45)).toEqual({ line: 9, column: 8, offset: 45 });
  });

  it('uses the recorded starts alone once the counter has let the segment go', () => {
    const segment = new LineSegment(1, 0, undefined, counting);
    segment.lineStarts.push(30);
    segment.counter = undefined;
    expect(segment.locate(45)).toEqual({ line: 2, column: 16, offset: 45 });
  });
});

describe('line segments of a tokenizer', () => {
  it('gives the same segment until the buffer drops text, and records line starts as it passes them', () => {
    const t = new Tokenizer(textSource('<a>\n<b/>\r\n', '<c/>\r<d/>', '</a>'), { maxNameLength: 100 });
    t.readDeclaration();
    expect(t.lines.recordLineStarts('s.xml')).toBe(t.lines.recordLineStarts('s.xml'));
    const seen: [LineSegment, number][] = [];
    for (let kind = t.next(); kind !== Token.END; kind = t.next())
      seen.push([t.lines.recordLineStarts('s.xml'), t.bufferOffset + t.tokenStart]);
    t.lines.finish();
    expect(new Set(seen.map(([segment]) => segment)).size).toBeGreaterThan(1);
    expect(seen.every(([segment]) => segment.counter === undefined)).toBe(true);
    const lines = seen.map(([segment, offset]) => segment.locate(offset)).map((at) => `${at.line}:${at.column}`);
    expect(lines).toEqual(['1:1', '1:4', '2:1', '2:5', '3:1', '3:5', '4:1', '4:5']);
    expect(seen[0]?.[0].locate(0).systemId).toBe('s.xml');
  });

  it('does nothing at the end when no lines were tracked', () => {
    const t = new Tokenizer(textSource('<a/>'), { maxNameLength: 100 });
    t.readDeclaration();
    expect(() => t.lines.finish()).not.toThrow();
  });
});

describe('event locations, found after counting on', () => {
  /** Each event's location as the cursor gives it while counting, and as the event object gives it afterwards. */
  function both(source: () => Source): [string[], string[]] {
    const factory = new XMLInputFactory();
    const r = factory.createStreamReader(source());
    const now: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) now.push(where(r.location()));
    const events = [...factory.createEventReader(source())].filter((e) => e.type !== EventType.START_DOCUMENT);
    return [now, events.filter((e) => e.type !== EventType.END_DOCUMENT).map((e) => where(e.location))];
  }

  /** A location as line:column@offset. */
  const where = (location: Location): string => `${location.line}:${location.column}@${location.offset}`;

  it.each([
    ['LF, CRLF and lone CR line ends', '<a>\n  <b x="1"/>\r\n  text\r<c/>\r\r\n<d/>\n</a>'],
    ['characters of several code units', '<a>𝄞\n<é/>€\n<b>x</b></a>'],
    ['many lines, so the buffer drops text', `<a>${'<b>x</b>\n'.repeat(60)}<c/></a>`],
    ['XML 1.1 line ends', '<?xml version="1.1"?><a>\u0085<b/>\u2028<c/>\r\u0085<d/>\r<e/></a>'],
  ])('agree for %s, read whole or in small chunks', (_, xml) => {
    const [whole, objects] = both(() => xml);
    expect(objects).toEqual(whole);
    const [chunked, chunkedObjects] = both(() => split(utf8(xml), 7));
    expect(chunked).toEqual(whole);
    expect(chunkedObjects).toEqual(whole);
  });

  it('carry the system id', () => {
    const [event] = [...new XMLInputFactory().createEventReader({ text: '<a/>', systemId: 'a.xml' })].slice(1);
    expect(event?.location).toEqual({ line: 1, column: 1, offset: 0, systemId: 'a.xml' });
  });
});
