import { utf8 } from '@test/helpers/lexical.ts';
import { errorOf, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode, XMLError } from '@/index.ts';

describe('XMLError', () => {
  it('carries a code, a location and the entity chain', () => {
    const error = new XMLError(ErrorCode.WF_NAME, 'Bad name', { line: 2, column: 3, offset: 9, systemId: 'a.xml' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'XMLError', code: 'WF_NAME', line: 2, column: 3, offset: 9, entities: [] });
    expect(error.location).toEqual({ line: 2, column: 3, offset: 9, systemId: 'a.xml' });
  });

  it('leaves out the system id when the document has none', () => {
    const error = new XMLError(ErrorCode.WF_NAME, 'Bad name', { line: 1, column: 1, offset: 0 });
    expect('systemId' in error).toBe(false);
    expect(error.location).toEqual({ line: 1, column: 1, offset: 0 });
  });

  it('keeps its message and the entity references it is given, outermost first', () => {
    const error = new XMLError(ErrorCode.WF_ENTITY_CONTENT, 'Unbalanced', { line: 1, column: 1, offset: 0 }, [
      'e',
      'f',
    ]);
    expect(error.message).toBe('Unbalanced');
    expect(error.entities).toEqual(['e', 'f']);
    expect(String(error)).toBe('XMLError: Unbalanced');
  });

  it('gives a new location object each time, which changing does not change the error', () => {
    const error = new XMLError(ErrorCode.WF_NAME, 'Bad name', { line: 4, column: 5, offset: 30 });
    const location = error.location as { line: number };
    location.line = 99;
    expect(error.location).not.toBe(error.location);
    expect(error.line).toBe(4);
  });
});

describe('errors from the parser', () => {
  it('locates a fault at its line and column, in UTF-16 code units, and its document offset', () => {
    expect(errorOf('<a>\n 𝄞&#0;</a>')).toMatchObject({ code: 'WF_CHARACTER_REFERENCE', line: 2, column: 4, offset: 7 });
  });

  it('gives the chain of entity references that led to a fault inside an entity', () => {
    const xml = '<!DOCTYPE a [<!ENTITY f "<b>"><!ENTITY e "&f;">]><a>&e;</a>';
    expect(errorOf(xml)).toMatchObject({ code: 'WF_ENTITY_CONTENT', entities: ['e', 'f'] });
  });
});

describe('the error handler', () => {
  it('sees a fatal error before it is thrown', () => {
    const seen: string[] = [];
    const r = reader(
      { text: '<a></b>', systemId: 'doc.xml' },
      { errorHandler: { fatalError: (e) => seen.push(e.code) } }
    );
    r.next();
    expect(() => r.next()).toThrow(expect.objectContaining({ code: 'WF_END_TAG_MISMATCH', systemId: 'doc.xml' }));
    expect(seen).toEqual(['WF_END_TAG_MISMATCH']);
  });

  it('receives the very error that is thrown', () => {
    let seen: XMLError | undefined;
    const r = reader('<a>&#0;</a>', { errorHandler: { fatalError: (e) => (seen = e) } });
    r.next();
    let thrown: unknown;
    try {
      r.next();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(XMLError);
    expect(seen).toBe(thrown);
  });

  it('receives recoverable errors instead of their being thrown', () => {
    const seen: string[] = [];
    const xml = '<!DOCTYPE a SYSTEM "a.dtd"><a b="&e;"/>';
    const r = reader(xml, { errorHandler: { error: (e) => seen.push(e.code) } });
    r.next();
    expect(r.next()).toBe(1);
    expect(seen).toEqual(['UNREAD_ENTITY_IN_ATTRIBUTE']);
  });

  it('throws a recoverable error when there is no handler for it', () => {
    const r = reader('<!DOCTYPE a SYSTEM "a.dtd"><a b="&e;"/>');
    r.next();
    expect(() => r.next()).toThrow(expect.objectContaining({ code: 'UNREAD_ENTITY_IN_ATTRIBUTE' }));
  });

  it('receives warnings, which are never thrown', () => {
    const seen: XMLError[] = [];
    const source = { bytes: utf8('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'), encoding: 'UTF-8' };
    const r = reader(source, { errorHandler: { warning: (e) => seen.push(e) } });
    expect(r.next()).toBe(1);
    expect(seen.map((e) => [e.code, e.line, e.column, e.offset])).toEqual([['ENCODING_CONFLICT', 1, 1, 0]]);
    expect(() => reader(source)).not.toThrow();
  });
});
