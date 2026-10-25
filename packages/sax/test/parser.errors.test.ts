import { recorder } from '@test/helpers/recorder.ts';
import { describe, expect, it } from 'vitest';
import { type ErrorHandler, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { SAXParser, type SAXHandler } from '@/index.ts';

/** A document with a recoverable error: a parameter entity that is not declared (VC: Entity Declared). */
const RECOVERABLE = '<!DOCTYPE a [%p;]><a/>';

/** A document that warns: the encoding given with the bytes contradicts the declaration (RFC 7303 §3.2). */
const WARNS = { bytes: new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'), encoding: 'UTF-8' };

/** An error handler that records each call as `kind CODE`. */
function errorRecorder(): { handler: ErrorHandler; heard: string[] } {
  const heard: string[] = [];
  return {
    heard,
    handler: {
      warning: (e) => heard.push(`warning ${e.code}`),
      error: (e) => heard.push(`error ${e.code}`),
      fatalError: (e) => heard.push(`fatal ${e.code}`),
    },
  };
}

describe('errors through SAX (ErrorHandler)', () => {
  it('passes a recoverable error to error() and goes on', () => {
    const { handler, calls } = recorder(['error', 'startElement']);
    new SAXParser().parse(RECOVERABLE, handler);
    expect(calls).toEqual(['error(VC_ENTITY_DECLARED)', 'startElement(, a, a, [])']);
  });

  it('passes a warning to warning() and goes on', () => {
    const { handler, calls } = recorder(['warning', 'startElement']);
    new SAXParser().parse(WARNS, handler);
    expect(calls).toEqual(['warning(ENCODING_CONFLICT)', 'startElement(, a, a, [])']);
  });

  it('passes a fatal error to fatalError() and then throws that same error', () => {
    const heard: XMLError[] = [];
    let thrown: unknown;
    try {
      new SAXParser().parse('<a>\n<b></a>', { fatalError: (e) => heard.push(e) });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(XMLError);
    expect(heard).toEqual([thrown]);
    expect(thrown).toMatchObject({ code: 'WF_END_TAG_MISMATCH', line: 2, column: 6 });
  });

  it('stops calling content methods at a fatal error', () => {
    const { handler, calls } = recorder(['startElement', 'endElement', 'fatalError', 'endDocument']);
    expect(() => new SAXParser().parse('<a><b/><c></a>', handler)).toThrow(XMLError);
    expect(calls).toEqual([
      'startElement(, a, a, [])',
      'startElement(, b, b, [])',
      'endElement(, b, b)',
      'startElement(, c, c, [])',
      'fatalError(WF_END_TAG_MISMATCH)',
    ]);
  });

  it('throws a recoverable error when no handler takes it, as the cursor does', () => {
    expect(() => new SAXParser().parse(RECOVERABLE, {})).toThrow(
      expect.objectContaining({ code: 'VC_ENTITY_DECLARED' })
    );
  });

  it('goes on past a warning when no handler takes it', () => {
    const { handler, calls } = recorder(['startElement']);
    new SAXParser().parse(WARNS, handler);
    expect(calls).toEqual(['startElement(, a, a, [])']);
  });

  it("falls back on the factory's error handler for the methods the SAX handler lacks", () => {
    const { handler: errorHandler, heard } = errorRecorder();
    const parser = new SAXParser(new XMLInputFactory({ errorHandler }));
    parser.parse(RECOVERABLE, {});
    parser.parse(WARNS, {});
    expect(() => parser.parse('<a>', {})).toThrow(XMLError);
    expect(heard).toEqual(['error VC_ENTITY_DECLARED', 'warning ENCODING_CONFLICT', 'fatal WF_UNCLOSED_ELEMENT']);
  });

  it("prefers the SAX handler's methods to the factory's", () => {
    const { handler: errorHandler, heard } = errorRecorder();
    const parser = new SAXParser(new XMLInputFactory({ errorHandler }));
    const { handler, calls } = recorder(['warning', 'error', 'fatalError']);
    parser.parse(RECOVERABLE, handler);
    parser.parse(WARNS, handler);
    expect(() => parser.parse('<a>', handler)).toThrow(XMLError);
    expect(calls).toEqual([
      'error(VC_ENTITY_DECLARED)',
      'warning(ENCODING_CONFLICT)',
      'fatalError(WF_UNCLOSED_ELEMENT)',
    ]);
    expect(heard).toEqual([]);
  });

  it('mixes the two per method', () => {
    const { handler: errorHandler, heard } = errorRecorder();
    const parser = new SAXParser(new XMLInputFactory({ errorHandler }));
    const own: string[] = [];
    const handler: SAXHandler = { error: (e) => own.push(e.code) };
    parser.parse(RECOVERABLE, handler);
    expect(() => parser.parse('<a>', handler)).toThrow(XMLError);
    expect(own).toEqual(['VC_ENTITY_DECLARED']);
    expect(heard).toEqual(['fatal WF_UNCLOSED_ELEMENT']);
  });

  it('throws a fatal error a handler with no fatalError never hears of', () => {
    expect(() => new SAXParser().parse('<a></b>', { error: () => {} })).toThrow(
      expect.objectContaining({ code: 'WF_END_TAG_MISMATCH' })
    );
  });

  it('gives errors in an external entity its system id and the chain of references', () => {
    const factory = new XMLInputFactory({
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'http://example.org/e.xml', text: '<b>\n<c></b>' }) },
    });
    const xml = { systemId: 'http://example.org/d.xml', text: '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a>&e;</a>' };
    expect(() => new SAXParser(factory).parse(xml, {})).toThrow(
      expect.objectContaining({
        code: 'WF_END_TAG_MISMATCH',
        systemId: 'http://example.org/e.xml',
        line: 2,
        entities: ['e'],
      })
    );
  });
});
