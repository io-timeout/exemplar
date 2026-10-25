import { HANDLER_METHODS, recorder } from '@test/helpers/recorder.ts';
import { describe, expect, it } from 'vitest';
import { XMLError } from '@exemplarjs/xml';
import { type Attributes, SAXParser, type SAXHandler, XMLFilterImpl } from '@/index.ts';

/** An error to pass through the error methods. */
const ERROR = new XMLError('WF_TAG', 'test', { line: 1, column: 1, offset: 0 });

/** Arguments for each handler method, as a parser would pass them. */
const ARGUMENTS: Readonly<Record<string, readonly unknown[]>> = {
  startDocument: [],
  endDocument: [],
  startPrefixMapping: ['p', 'urn:p'],
  endPrefixMapping: ['p'],
  endElement: ['urn:p', 'a', 'p:a'],
  characters: ['text'],
  ignorableWhitespace: [' '],
  processingInstruction: ['target', 'data'],
  skippedEntity: ['e'],
  startDTD: ['a', '-//A', 'a.dtd'],
  endDTD: [],
  startEntity: ['%p'],
  endEntity: ['%p'],
  startCDATA: [],
  endCDATA: [],
  comment: ['c'],
  elementDecl: ['a', 'ANY'],
  attributeDecl: ['a', 'x', 'CDATA', '#FIXED', 'v'],
  internalEntityDecl: ['e', 'value'],
  externalEntityDecl: ['e', undefined, 'e.xml'],
  notationDecl: ['n', '-//N', undefined],
  unparsedEntityDecl: ['u', undefined, 'u.gif', 'n'],
  warning: [ERROR],
  error: [ERROR],
  fatalError: [ERROR],
};

/** Calls a method of a handler by name. */
function call(handler: SAXHandler, name: string, args: readonly unknown[]): void {
  (handler as Record<string, (...a: unknown[]) => void>)[name]?.(...args);
}

describe('XMLFilterImpl (SAX2 XMLFilterImpl)', () => {
  it.each(HANDLER_METHODS)('passes %s on with its arguments', (name) => {
    const { handler, calls } = recorder([name]);
    call(new XMLFilterImpl(handler), name, ARGUMENTS[name] ?? []);
    expect(calls).toHaveLength(1);
    const { handler: direct, calls: expected } = recorder([name]);
    call(direct, name, ARGUMENTS[name] ?? []);
    expect(calls).toEqual(expected);
  });

  it('passes startElement on with the same Attributes', () => {
    const seen: unknown[][] = [];
    const attributes = { length: 0 } as unknown as Attributes;
    new XMLFilterImpl({ startElement: (...args) => seen.push(args) }).startElement('urn:a', 'a', 'p:a', attributes);
    expect(seen).toEqual([['urn:a', 'a', 'p:a', attributes]]);
  });

  it('passes setDocumentLocator on', () => {
    const locators: unknown[] = [];
    const locator = {
      lineNumber: 1,
      columnNumber: 1,
      systemId: undefined,
      publicId: undefined,
      xmlVersion: '1.0',
      encoding: undefined,
    };
    new XMLFilterImpl({ setDocumentLocator: (l) => locators.push(l) }).setDocumentLocator(locator);
    expect(locators).toEqual([locator]);
  });

  it.each(HANDLER_METHODS.filter((name) => name !== 'error'))('ignores %s when the handler lacks it', (name) => {
    expect(() => call(new XMLFilterImpl({}), name, ARGUMENTS[name] ?? [])).not.toThrow();
  });

  it('ignores startElement and setDocumentLocator without a handler', () => {
    const filter = new XMLFilterImpl();
    expect(() => filter.startElement('', 'a', 'a', { length: 0 } as unknown as Attributes)).not.toThrow();
    expect(() => filter.setDocumentLocator({} as never)).not.toThrow();
  });

  it('throws a recoverable error the handler cannot take, as the cursor does', () => {
    expect(() => new XMLFilterImpl().error(ERROR)).toThrow(ERROR);
    expect(() => new XMLFilterImpl({}).error(ERROR)).toThrow(ERROR);
  });

  it('passes events to whichever handler it holds now', () => {
    const filter = new XMLFilterImpl();
    const { handler, calls } = recorder(['characters']);
    filter.characters('lost');
    filter.handler = handler;
    filter.characters('kept');
    expect(calls).toEqual(['characters(kept)']);
  });

  it('sits between the parser and a handler, changing the events it overrides', () => {
    class RenamePara extends XMLFilterImpl {
      override startElement(uri: string, localName: string, qName: string, attributes: Attributes) {
        super.startElement(uri, localName === 'para' ? 'p' : localName, qName, attributes);
      }
    }
    const { handler, calls } = recorder();
    new SAXParser().parse('<para>x</para>', new RenamePara(handler));
    expect(calls).toEqual([
      'startDocument()',
      'startElement(, p, para, [])',
      'characters(x)',
      'endElement(, para, para)',
      'endDocument()',
    ]);
  });

  it('chains, each filter changing what the one before passed on', () => {
    class Upper extends XMLFilterImpl {
      override characters(text: string) {
        super.characters(text.toUpperCase());
      }
    }
    class Bracket extends XMLFilterImpl {
      override characters(text: string) {
        super.characters(`[${text}]`);
      }
    }
    const { handler, calls } = recorder(['characters']);
    new SAXParser().parse('<a>x</a>', new Upper(new Bracket(handler)));
    expect(calls).toEqual(['characters([X])']);
  });

  it('drops events an override does not pass on', () => {
    class NoComments extends XMLFilterImpl {
      override comment() {}
    }
    const { handler, calls } = recorder(['comment', 'characters']);
    new SAXParser().parse('<a><!--c-->t</a>', new NoComments(handler));
    expect(calls).toEqual(['characters(t)']);
  });

  it('passes the whole document through unchanged from the parser', () => {
    const xml =
      '<!DOCTYPE p:a [<!ELEMENT p:a ANY><!ATTLIST p:a d CDATA "v"><!ENTITY e "E"><!ENTITY % pe "<!ENTITY f \'F\'>">%pe;<!NOTATION n SYSTEM "n"><!ENTITY u SYSTEM "u" NDATA n><?pi d?>]><p:a xmlns:p="urn:p">&e;<![CDATA[c]]><!--x--><?q r?>&f;</p:a>';
    const direct = recorder();
    new SAXParser().parse({ systemId: 'file:///d.xml', text: xml }, direct.handler);
    const filtered = recorder();
    new SAXParser().parse({ systemId: 'file:///d.xml', text: xml }, new XMLFilterImpl(filtered.handler));
    expect(filtered.calls).toEqual(direct.calls);
  });

  it('passes errors through from the parser, and lets the parser throw fatal ones', () => {
    const { handler, calls } = recorder(['error', 'fatalError']);
    new SAXParser().parse('<!DOCTYPE a [%p;]><a/>', new XMLFilterImpl(handler));
    expect(() => new SAXParser().parse('<a>', new XMLFilterImpl(handler))).toThrow(XMLError);
    expect(calls).toEqual(['error(VC_ENTITY_DECLARED)', 'fatalError(WF_UNCLOSED_ELEMENT)']);
  });

  it('throws recoverable errors from the parser when its handler has no error method', () => {
    expect(() => new SAXParser().parse('<!DOCTYPE a [%p;]><a/>', new XMLFilterImpl({}))).toThrow(
      expect.objectContaining({ code: 'VC_ENTITY_DECLARED' })
    );
  });
});
