import { errorOf, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, type Source, XMLInputFactory } from '@/index.ts';

const encoder = new TextEncoder();

/** Each event's type and `line:column`, read from a source. */
function positions(source: Source, options: InputOptions = {}): string[] {
  const r = reader(source, options);
  const out: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
    const { line, column } = r.location();
    out.push(`${e}@${line}:${column}`);
  }
  return out;
}

/** A document's bytes in chunks of one size. */
function* chunks(xml: string, size: number): Generator<Uint8Array> {
  const bytes = encoder.encode(xml);
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

describe('locations (where each event starts, as in Woodstox)', () => {
  it('give each event the line and column it starts at', () => {
    const xml = '<?xml version="1.0"?>\n<!DOCTYPE r>\n<r a="1"\r\n b="2">\r  <c/>\n<!--x--><?p?><![CDATA[d]]></r>';
    expect(positions(xml)).toEqual([
      '11@2:1',
      '1@3:1',
      '4@4:8',
      '1@5:3',
      '2@5:3',
      '4@5:7',
      '5@6:1',
      '3@6:9',
      '12@6:14',
      '2@6:27',
    ]);
  });

  it('give an empty-element tag’s start and end the same location', () => {
    const r = reader('<a>\n  <b/></a>');
    r.next();
    r.next();
    r.next();
    const start = r.location();
    r.next();
    expect(r.location()).toEqual(start);
    expect(start).toEqual({ line: 2, column: 3, offset: 6 });
  });

  it('count CR LF, lone CR and LF each as one line end (§2.11)', () => {
    expect(positions('<a>\r\n<b/>\r<c/>\n<d/></a>').filter((p) => p.startsWith('1@'))).toEqual([
      '1@1:1',
      '1@2:1',
      '1@3:1',
      '1@4:1',
    ]);
  });

  it('count NEL and LS as line ends in XML 1.1 only (XML 1.1 §2.11)', () => {
    const body = '<a>x\u0085<b/>\u2028<c/></a>';
    expect(positions(`<?xml version="1.1"?>${body}`).filter((p) => p.startsWith('1@'))).toEqual([
      '1@1:22',
      '1@2:1',
      '1@3:1',
    ]);
    expect(positions(body).filter((p) => p.startsWith('1@'))).toEqual(['1@1:1', '1@1:6', '1@1:11']);
  });

  it('count columns in UTF-16 code units', () => {
    expect(positions('<a>𝄞é<b/></a>')[2]).toBe('1@1:7');
  });

  it('give offsets in the whole document however it is chunked', () => {
    const xml = `<r>${'<e>text</e>\n'.repeat(50)}</r>`;
    const expected = positions(xml);
    for (const size of [1, 7, 64]) expect(positions(chunks(xml, size))).toEqual(expected);
    const r = reader(chunks(xml, 5));
    let last = 0;
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) last = r.location().offset;
    expect(last).toBe(xml.length - 4);
  });

  it('give the same locations to an asynchronous reader fed the document whole or split', () => {
    /** The locations of a document fed in the given pieces. */
    const fed = (...pieces: string[]) => {
      const r = new XMLInputFactory().createAsyncStreamReader();
      const out: string[] = [];
      for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
        if (e === EventType.NEED_INPUT) {
          const piece = pieces.shift();
          if (piece === undefined) r.endOfInput();
          else r.feed(encoder.encode(piece));
        } else {
          out.push(`${e}@${r.location().line}:${r.location().column}:${r.location().offset}`);
        }
      }
      return out;
    };
    expect(fed('<div>abcde', 'fgh</div>')).toEqual(fed('<div>abcdefgh</div>'));
    expect(fed('<div>\nabcde', 'fgh\n</div>', '\n')).toEqual(fed('<div>\nabcdefgh\n</div>\n'));
  });

  it('carry the system id the source names', () => {
    const r = reader({ text: '<a>\n<b/></a>', systemId: 'file:///d.xml' });
    r.next();
    r.next();
    r.next();
    expect(r.location()).toEqual({ line: 2, column: 1, offset: 4, systemId: 'file:///d.xml' });
  });

  it('give the events of an internal entity the location of the reference', () => {
    const xml = '<!DOCTYPE a [<!ENTITY e "<b>\n<c/></b>">]>\n<a>\n  &e;</a>';
    const r = reader(xml);
    const found: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.START_ELEMENT) found.push(`${r.name()}@${r.location().line}:${r.location().column}`);
    }
    expect(found).toEqual(['a@3:1', 'b@4:3', 'c@4:3']);
  });

  it('give the events of an external entity their place in that entity, with its system id', () => {
    const options: InputOptions = {
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'urn:x', text: '<b>\n <c/></b>' }) },
    };
    const r = reader('<!DOCTYPE a [<!ENTITY x SYSTEM "x">]><a>&x;</a>', options);
    const found: unknown[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.START_ELEMENT) found.push([r.name(), r.location()]);
    }
    expect(found).toEqual([
      ['a', { line: 1, column: 38, offset: 37 }],
      ['b', { line: 1, column: 1, offset: 0, systemId: 'urn:x' }],
      ['c', { line: 2, column: 2, offset: 5, systemId: 'urn:x' }],
    ]);
  });

  it('give event objects the same locations as the cursor, read whole or in chunks', () => {
    const xml = '<?xml version="1.0"?>\r\n<a x="1">\n\t<b>t</b>\r<!--c--></a>';
    const expected = positions(xml);
    const factory = new XMLInputFactory();
    for (const source of [xml, chunks(xml, 1), chunks(xml, 4)]) {
      const events = [...factory.createEventReader(source)];
      expect(events.slice(1, -1).map((e) => `${e.type}@${e.location.line}:${e.location.column}`)).toEqual(expected);
    }
  });
});

describe('error locations (every error carries one)', () => {
  it.each([
    ['<a></b>', 'WF_END_TAG_MISMATCH', 1, 6],
    ['<a>\n  <b></c></a>', 'WF_END_TAG_MISMATCH', 2, 8],
    ['<root>', 'WF_UNCLOSED_ELEMENT', 1, 7],
    ['<root>abc</root>de<f', 'WF_CONTENT_OUTSIDE_ROOT', 1, 17],
    ['<r a="first"b="second"/>', 'WF_TAG', 1, 13],
    ['<a/>\n<b/>', 'WF_SECOND_ROOT', 2, 1],
    ['<span id="hello" id="there"></span>', 'WF_DUPLICATE_ATTRIBUTE', 1, 18],
  ])('locates %j', (xml, code, line, column) => {
    expect(errorOf(xml)).toMatchObject({ code, line, column });
  });

  it('locates an error inside an internal entity at the reference, naming the entities that led there', () => {
    const xml = '<!DOCTYPE a [<!ENTITY e "&f;"><!ENTITY f "<b>">]><a>\n &e;</a>';
    expect(errorOf(xml)).toMatchObject({ code: 'WF_ENTITY_CONTENT', line: 2, column: 2, entities: ['e', 'f'] });
  });

  it('locates an error in an external entity without a system id by its line and column there, as the JDK does', () => {
    const options: InputOptions = { entityResolver: { resolveEntity: () => ({ text: '<b>\n<c>\n</b>' }) } };
    const error = errorOf('<!DOCTYPE a [<!ENTITY x SYSTEM "x">]>\n<a>&x;</a>', options);
    expect(error).toMatchObject({ code: 'WF_END_TAG_MISMATCH', line: 3, column: 3 });
    expect(error.systemId).toBeUndefined();
  });

  it.each([
    [
      'read from a document whose system id is not a URL',
      '<!DOCTYPE a [<!ENTITY x SYSTEM "x">]>\n<a>&x;</a>',
      '/d/a.xml',
    ],
    [
      'referred to from an internal entity',
      '<!DOCTYPE a [<!ENTITY x SYSTEM "x"><!ENTITY i "&x;">]>\n<a>&i;</a>',
      undefined,
    ],
  ])(
    'locates an error in an external entity without a system id, %s, there, with no system id (JDK)',
    (_case, text, systemId) => {
      const options: InputOptions = { entityResolver: { resolveEntity: () => ({ text: '<b>\n<c>\n</b>' }) } };
      const r = reader(systemId === undefined ? { text } : { text, systemId }, options);
      let thrown: unknown;
      try {
        while (r.hasNext()) r.next();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: 'WF_END_TAG_MISMATCH', line: 3, column: 3 });
      expect(thrown).not.toHaveProperty('systemId');
    }
  );

  it('gives an error the system id of the document', () => {
    const r = reader({ text: '<a>\n</b>', systemId: 'urn:doc' });
    expect(() => {
      while (r.next() !== EventType.END_DOCUMENT);
    }).toThrow(expect.objectContaining({ line: 2, column: 3, systemId: 'urn:doc' }));
  });
});
