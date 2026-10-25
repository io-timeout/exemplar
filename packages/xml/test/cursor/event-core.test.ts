import { errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, type StreamReader, XMLError } from '@/index.ts';
import { accessRefusedError } from '@/internal.ts';

describe('the document (§2.1)', () => {
  it('needs a root element', () => {
    expect(errorOf('').code).toBe('WF_EMPTY_DOCUMENT');
    expect(errorOf('<!-- only a comment -->').code).toBe('WF_EMPTY_DOCUMENT');
  });

  it('allows one root element only', () => {
    expect(errorOf('<a/><b/>').code).toBe('WF_SECOND_ROOT');
  });

  it('allows only whitespace, comments and PIs outside the root', () => {
    expect(parseEveryWay(' <!--c--> <?p?>\n<a/>\n<!--c--> ')).toBe('<?p ?><a></a>');
    expect(errorOf('x<a/>').code).toBe('WF_CONTENT_OUTSIDE_ROOT');
    expect(errorOf('<a/>x').code).toBe('WF_CONTENT_OUTSIDE_ROOT');
    expect(errorOf('<a/>&amp;').code).toBe('WF_CONTENT_OUTSIDE_ROOT');
    expect(errorOf('<a/><![CDATA[x]]>').code).toBe('WF_CONTENT_OUTSIDE_ROOT');
  });

  it('allows the DOCTYPE only once, before the root (§2.8)', () => {
    expect(errorOf('<a/><!DOCTYPE a>').code).toBe('WF_DOCTYPE_MISPLACED');
    expect(errorOf('<!DOCTYPE a><!DOCTYPE a><a/>').code).toBe('WF_DOCTYPE_MISPLACED');
  });

  it.each([
    ['a reference before the root', '&#x20;<r/>', 'WF_CONTENT_OUTSIDE_ROOT'],
    ['a reference after the root', '<r/>&#xA;', 'WF_CONTENT_OUTSIDE_ROOT'],
    ['a CDATA section before the root', '<![CDATA[x]]><root/>', 'WF_CONTENT_OUTSIDE_ROOT'],
    ['text after the XML declaration', '<?xml version="1.0"?>\na\n<root/>', 'WF_CONTENT_OUTSIDE_ROOT'],
    ['text after the root', '<span>Welcome,</span> to monkey land', 'WF_CONTENT_OUTSIDE_ROOT'],
    ['a second root after a comment', '<doc/><!--c--><e/>', 'WF_SECOND_ROOT'],
    ['only whitespace', ' \t\r\n ', 'WF_EMPTY_DOCUMENT'],
    ['only a PI', '<?pi x?>', 'WF_EMPTY_DOCUMENT'],
    ['an end tag alone', '</a>', 'WF_END_TAG_MISMATCH'],
    ['elements left open', '<root><foo>', 'WF_UNCLOSED_ELEMENT'],
  ])('rejects %s', (_, xml, code) => {
    expect(errorOf(xml).code).toBe(code);
  });

  it('allows whitespace of every kind around the root', () => {
    expect(parseEveryWay(' \t\r\n<r/>\r\n\t ')).toBe('<r></r>');
  });

  it('rejects a document that ends inside an element', () => {
    expect(errorOf('<a><b></b>')).toMatchObject({ code: 'WF_UNCLOSED_ELEMENT' });
    expect(errorOf('<a').code).toBe('WF_UNEXPECTED_END');
    expect(errorOf('<a b="1').code).toBe('WF_UNEXPECTED_END');
  });
});

describe('elements (§3)', () => {
  it('requires the end tag to match the start tag (WFC: Element Type Match)', () => {
    expect(errorOf('<a><b></a></b>')).toMatchObject({ code: 'WF_END_TAG_MISMATCH', line: 1, column: 9 });
    expect(errorOf('<abc></ab>').code).toBe('WF_END_TAG_MISMATCH');
    expect(errorOf('<a></a></a>').code).toBe('WF_END_TAG_MISMATCH');
  });

  it('compares each end tag with its start tag, wherever the start tag now is in the buffer', () => {
    expect(errorOf('<ab></ac>').code).toBe('WF_END_TAG_MISMATCH');
    expect(errorOf('<a></ab>').code).toBe('WF_END_TAG_MISMATCH');
    expect(errorOf('<ab></a>').code).toBe('WF_END_TAG_MISMATCH');
    expect(parseEveryWay('<a><b></b ></a\n>')).toBe('<a><b></b></a>');
    const text = 'x'.repeat(500);
    expect(parseEveryWay(`<long>${text}<b/>${text}</long>`)).toBe(`<long>${text}<b></b>${text}</long>`);
    expect(errorOf(`<long>${text}</lonG>`).code).toBe('WF_END_TAG_MISMATCH');
  });

  it('matches end tags whose names are not ASCII', () => {
    expect(parseEveryWay('<é><ü/></é>')).toBe('<é><ü></ü></é>');
    expect(errorOf('<é></è>').code).toBe('WF_END_TAG_MISMATCH');
  });

  it('skips the checks when checkWellFormedness is off', () => {
    expect(parseEveryWay('<a b="1" b="2"></c>', { checkWellFormedness: false, namespaceAware: false })).toBe(
      '<a b="1" b="2"></a>'
    );
  });
});

describe('XML 1.1 normalization checks (XML 1.1 §2.13)', () => {
  it('warns once about text that is not fully normalized when checkNormalization is on', () => {
    const warnings: string[] = [];
    const options = {
      checkNormalization: true,
      errorHandler: { warning: (e: { code: string }) => warnings.push(e.code) },
    };
    parseEveryWay('<?xml version="1.1"?><a>é and é</a>', options);
    expect(new Set(warnings)).toEqual(new Set(['NOT_FULLY_NORMALIZED']));
  });
});

describe('after a fatal error (§1.2)', () => {
  /** The error a call throws. */
  function thrownBy(call: () => unknown): unknown {
    try {
      call();
    } catch (error) {
      return error;
    }
    throw new Error('Nothing was thrown');
  }

  /** Reads to the first error; returns it and the reader. */
  function failed(xml: string, options: InputOptions = {}): { error: unknown; r: StreamReader } {
    const r = reader(xml, options);
    const error = thrownBy(() => {
      while (r.next() !== EventType.END_DOCUMENT);
    });
    return { error, r };
  }

  it.each([
    ['a second root, before the end of the document', '<r/><second/>'],
    ['a duplicate attribute, before the content after it', '<r><b y="2" y="3"/>more</r>'],
    ['an undeclared entity, before the text after it', '<r>&undeclared;after</r>'],
    ['a malformed comment', '<r><!-- -- -->x</r>'],
    ['a mismatched end tag', '<r><a></b></r>'],
  ])('throws the same error again after %s, instead of reading on', (_, xml) => {
    const { error, r } = failed(xml);
    expect(error).toBeInstanceOf(XMLError);
    expect(thrownBy(() => r.next())).toBe(error);
    expect(thrownBy(() => r.next())).toBe(error);
  });

  it('tells the error handler once', () => {
    const fatal: string[] = [];
    const { r } = failed('<r/><second/>', { errorHandler: { fatalError: (e) => fatal.push(e.code) } });
    thrownBy(() => r.next());
    expect(fatal).toEqual(['WF_SECOND_ROOT']);
  });

  /** A resolver that refuses every read, as one that keeps to the access list does. */
  const refusing = {
    resolveEntity: (request: { systemId?: string }) => {
      throw accessRefusedError(`http://x/${request.systemId ?? ''}`);
    },
  };

  it.each([
    ['a refused external DTD', '<!DOCTYPE r SYSTEM "x.dtd"><r>t</r>', { entityResolver: refusing }, 'ACCESS_REFUSED'],
    [
      'a refused external entity',
      '<!DOCTYPE r [<!ENTITY e SYSTEM "e.xml">]><r>&e;after</r>',
      { entityResolver: refusing },
      'ACCESS_REFUSED',
    ],
    [
      'an entity in an attribute that an unread entity may declare',
      '<!DOCTYPE r [<!ENTITY % p SYSTEM "p.ent">%p;]><r a="&u;">t</r>',
      {},
      'UNREAD_ENTITY_IN_ATTRIBUTE',
    ],
  ] as const)('ends the document at %s, a recoverable error thrown for want of a handler', (_, xml, options, code) => {
    const { error, r } = failed(xml, { accessExternalDTD: 'all', ...options });
    expect(error).toMatchObject({ code });
    expect(thrownBy(() => r.next())).toBe(error);
  });

  it('reads on, leaving out what was refused, when a handler takes the error', () => {
    const errors: string[] = [];
    const r = reader('<!DOCTYPE r [<!ENTITY e SYSTEM "e.xml">]><r a="1">&e;after</r>', {
      entityResolver: refusing,
      errorHandler: { error: (e) => errors.push(e.code) },
    });
    const events: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) events.push(`${e}`);
    expect(events).toEqual(['11', '1', '9', '4', '2']);
    expect(errors).toEqual(['ACCESS_REFUSED']);
  });
});
