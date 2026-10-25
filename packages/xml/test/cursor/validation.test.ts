import { describe, expect, it } from 'vitest';
import type { ValidationContext, Validator } from '@/cursor/validation.ts';
import { ErrorCode, EventType, type InputOptions, type XMLError, XMLInputFactory } from '@/index.ts';

/** A validator that records what the cursor shows it, and reports whitespace in `<s>` as element content. */
function recorder(): { validator: Validator; calls: string[]; context: () => ValidationContext } {
  const calls: string[] = [];
  let context: ValidationContext | undefined;
  const validator: Validator = {
    create(c) {
      context = c;
      return {
        dtd: () => calls.push('dtd'),
        startElement: () => calls.push(`start ${c.reader.name()}`),
        endElement: () => calls.push(`end ${c.reader.name()}`),
        text: (event) => {
          calls.push(`text ${event} ${c.reader.text()}`);
          return c.reader.isWhitespace();
        },
        markup: (event) => calls.push(`markup ${event}`),
        entity: (name) => calls.push(`entity ${name}`),
        endDocument: () => calls.push('endDocument'),
      };
    },
  };
  return { validator, calls, context: () => context as ValidationContext };
}

/** Reads a document to its end; returns the event types. */
function read(xml: string, options: InputOptions): EventType[] {
  const reader = new XMLInputFactory(options).createStreamReader(xml);
  const types: EventType[] = [];
  for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) types.push(e);
  return types;
}

describe('the validator interface', () => {
  it('makes one document validator per cursor', () => {
    let created = 0;
    const validator: Validator = {
      create: (c) => {
        created++;
        return recorder().validator.create(c);
      },
    };
    const factory = new XMLInputFactory({ validator });
    factory.createStreamReader('<a/>');
    factory.createStreamReader('<a/>');
    expect(created).toBe(2);
  });

  it('lets a validator read the cursor while it is made', () => {
    let seen: unknown[] = [];
    const validator: Validator = {
      create: (c) => {
        seen = [c.store().hasDoctype, c.reader.eventType(), c.textHasReferences(), c.reader.location().line];
        return recorder().validator.create(c);
      },
    };
    new XMLInputFactory({ validator }).createStreamReader('<a/>');
    expect(seen).toEqual([false, EventType.START_DOCUMENT, false, 1]);
  });

  it('shows the validator every event, in document order, before any filter', () => {
    const { validator, calls } = recorder();
    const xml = '<!DOCTYPE a [<!ENTITY e "<b/>">]><a><!--c--><?p?>t<![CDATA[d]]>&e;</a>';
    read(xml, { validator });
    expect(calls).toEqual([
      'dtd',
      'start a',
      'markup 5',
      'markup 3',
      'text 4 t',
      'text 12 d',
      'entity e',
      'start b',
      'end b',
      'end a',
      'endDocument',
    ]);
  });

  it('tells the validator when a text-only entity starts', () => {
    const { validator, calls } = recorder();
    read('<!DOCTYPE a [<!ENTITY e "x"><!ENTITY n "">]><a>&e;&n;</a>', { validator });
    expect(calls).toEqual(['dtd', 'start a', 'entity e', 'text 4 x', 'entity n', 'end a', 'endDocument']);
  });

  it('shows the validator what a reference it does not expand holds, then the reference', () => {
    const { validator, calls } = recorder();
    const xml = '<!DOCTYPE a [<!ENTITY e "<b>x</b>">]><a>&e;</a>';
    const events = read(xml, { validator, replaceEntityReferences: false });
    expect(calls).toEqual([
      'dtd',
      'start a',
      'start b',
      'text 4 x',
      'end b',
      `markup ${EventType.ENTITY_REFERENCE}`,
      'end a',
      'endDocument',
    ]);
    expect(events).toEqual([EventType.DTD, EventType.START_ELEMENT, EventType.ENTITY_REFERENCE, EventType.END_ELEMENT]);
  });

  it('shows the validator the entities inside a reference it does not expand, reporting no boundaries for them', () => {
    const { validator, calls } = recorder();
    const xml = '<!DOCTYPE a [<!ENTITY f "<c/>"><!ENTITY e "<b>&f;</b>">]><a>&e;</a>';
    const events = read(xml, { validator, replaceEntityReferences: false, reportEntityBoundaries: true });
    expect(calls).toEqual([
      'dtd',
      'start a',
      'start b',
      'entity f',
      'start c',
      'end c',
      'end b',
      `markup ${EventType.ENTITY_REFERENCE}`,
      'end a',
      'endDocument',
    ]);
    expect(events).toEqual([EventType.DTD, EventType.START_ELEMENT, EventType.ENTITY_REFERENCE, EventType.END_ELEMENT]);
  });

  it('shows the validator the external entity a reference it does not expand names', () => {
    const { validator, calls } = recorder();
    const options: InputOptions = {
      validator,
      replaceEntityReferences: false,
      entityResolver: { resolveEntity: () => ({ systemId: 'urn:x', text: '<b>t</b>' }) },
    };
    const events = read('<!DOCTYPE a [<!ENTITY x SYSTEM "x">]><a>&x;</a>', options);
    expect(calls).toEqual([
      'dtd',
      'start a',
      'start b',
      'text 4 t',
      'end b',
      `markup ${EventType.ENTITY_REFERENCE}`,
      'end a',
      'endDocument',
    ]);
    expect(events).toEqual([EventType.DTD, EventType.START_ELEMENT, EventType.ENTITY_REFERENCE, EventType.END_ELEMENT]);
  });

  it('shows the caller what follows a reference it does not expand to an external entity that is not read', () => {
    const { validator, calls } = recorder();
    const xml = '<!DOCTYPE a [<!ENTITY x SYSTEM "x">]><a>&x;<d/></a>';
    const events = read(xml, { validator, replaceEntityReferences: false });
    expect(calls).toEqual([
      'dtd',
      'start a',
      `markup ${EventType.ENTITY_REFERENCE}`,
      'start d',
      'end d',
      'end a',
      'endDocument',
    ]);
    expect(events).toEqual([
      EventType.DTD,
      EventType.START_ELEMENT,
      EventType.ENTITY_REFERENCE,
      EventType.START_ELEMENT,
      EventType.END_ELEMENT,
      EventType.END_ELEMENT,
    ]);
  });

  it('reports whitespace the validator finds in element content as SPACE (StAX SPACE)', () => {
    const { validator } = recorder();
    expect(read('<a> <b/>x<![CDATA[ ]]></a>', { validator })).toEqual([
      EventType.START_ELEMENT,
      EventType.SPACE,
      EventType.START_ELEMENT,
      EventType.END_ELEMENT,
      EventType.CHARACTERS,
      EventType.CDATA,
      EventType.END_ELEMENT,
    ]);
  });

  it('validates merged text when coalescing', () => {
    const { validator, calls } = recorder();
    expect(read('<a>x<![CDATA[y]]></a>', { validator, coalescing: true })).toEqual([
      EventType.START_ELEMENT,
      EventType.CHARACTERS,
      EventType.END_ELEMENT,
    ]);
    expect(calls).toContain('text 4 xy');
  });
});

describe('the validation context', () => {
  it('gives the declarations read so far', () => {
    const { validator, context } = recorder();
    const reader = new XMLInputFactory({ validator }).createStreamReader('<!DOCTYPE a [<!ELEMENT a EMPTY>]><a/>');
    reader.next();
    expect(context().store().elements.get('a')?.content).toBe('EMPTY');
  });

  it("lists every start tag's attributes, with declarations and defaults", () => {
    const { validator, context } = recorder();
    const xml = '<!DOCTYPE a [<!ATTLIST a d CDATA "1">]><a xmlns:p="urn:p" p:x="2"/>';
    const reader = new XMLInputFactory({ validator }).createStreamReader(xml);
    reader.next();
    reader.next();
    const list = context().attributes();
    expect(list.names.slice(0, list.count)).toEqual(['xmlns:p', 'p:x', 'd']);
    expect([reader.attributeCount(), reader.attributeNamespace(0), reader.isAttributeSpecified(1)]).toEqual([
      2,
      'urn:p',
      false,
    ]);
  });

  it('says whether the reader is namespace-aware and the document standalone', () => {
    const aware = recorder();
    new XMLInputFactory({ validator: aware.validator }).createStreamReader(
      '<?xml version="1.0" standalone="yes"?><a/>'
    );
    expect([aware.context().namespaceAware, aware.context().standalone()]).toEqual([true, true]);
    const plain = recorder();
    new XMLInputFactory({ validator: plain.validator, namespaceAware: false }).createStreamReader('<a/>');
    expect([plain.context().namespaceAware, plain.context().standalone()]).toEqual([false, false]);
  });

  it('says whether the current character data was written with references', () => {
    const { validator, context } = recorder();
    const reader = new XMLInputFactory({ validator }).createStreamReader(
      '<!DOCTYPE a [<!ENTITY e "x">]><a><b>&#32;</b><b>plain</b><b>&e;</b></a>'
    );
    const seen: boolean[] = [];
    for (let e = reader.next(); e !== EventType.END_DOCUMENT; e = reader.next()) {
      if (e === EventType.CHARACTERS || e === EventType.SPACE) seen.push(context().textHasReferences());
    }
    expect(seen).toEqual([true, false, false]);
  });

  it('reports validity errors to the error handler at the current event, or at a location given', () => {
    const errors: XMLError[] = [];
    let context: ValidationContext | undefined;
    const validator: Validator = {
      create(c) {
        context = c;
        return {
          ...recorder().validator.create(c),
          startElement: () => c.error(ErrorCode.VC_ELEMENT_VALID, 'not allowed'),
        };
      },
    };
    const factory = new XMLInputFactory({ validator, errorHandler: { error: (e) => errors.push(e) } });
    const reader = factory.createStreamReader({ text: '<a>\n <b/></a>', systemId: 'urn:doc' });
    reader.next();
    reader.next();
    reader.next();
    context?.error(ErrorCode.VC_ID, 'elsewhere', { line: 9, column: 9, offset: 99 });
    expect(errors.map((e) => [e.code, e.line, e.column, e.systemId])).toEqual([
      ['VC_ELEMENT_VALID', 1, 1, 'urn:doc'],
      ['VC_ELEMENT_VALID', 2, 2, 'urn:doc'],
      ['VC_ID', 9, 9, 'urn:doc'],
    ]);
  });

  it('throws a validity error when there is no error handler', () => {
    const validator: Validator = {
      create: (c) => ({
        ...recorder().validator.create(c),
        startElement: () => c.error(ErrorCode.VC_ELEMENT_VALID, 'not allowed'),
      }),
    };
    const reader = new XMLInputFactory({ validator }).createStreamReader('<a/>');
    expect(() => reader.next()).toThrow(expect.objectContaining({ code: 'VC_ELEMENT_VALID', line: 1, column: 1 }));
  });
});

describe('validity constraints the DTD parser reports when validating', () => {
  /** The validity errors a document reports with a validator present, or without one. */
  function invalid(xml: string, validating = true, options: InputOptions = {}): string[] {
    const codes: string[] = [];
    const validator = validating ? recorder().validator : undefined;
    read(xml, { ...options, ...(validator && { validator }), errorHandler: { error: (e) => codes.push(e.code) } });
    return codes;
  }

  it('reports an element type declared twice (VC: Unique Element Type Declaration)', () => {
    const xml = '<!DOCTYPE a [<!ELEMENT a ANY><!ELEMENT a EMPTY>]><a/>';
    expect(invalid(xml)).toEqual(['VC_UNIQUE_ELEMENT_TYPE']);
    expect(invalid(xml, false)).toEqual([]);
  });

  it('reports a notation declared twice (VC: Unique Notation Name)', () => {
    const xml = '<!DOCTYPE a [<!NOTATION n SYSTEM "a"><!NOTATION n SYSTEM "b">]><a/>';
    expect(invalid(xml)).toEqual(['VC_UNIQUE_NOTATION']);
    expect(invalid(xml, false)).toEqual([]);
  });

  it('reports markup that starts and ends in different entities (VC: Proper Declaration/PE Nesting)', () => {
    const dtd = '<!ENTITY % end "ANY>"><!ELEMENT a %end; <!ENTITY % close ")"><!ELEMENT b (a %close;>';
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'urn:dtd', text: dtd }) },
    };
    expect(invalid('<!DOCTYPE a SYSTEM "a.dtd"><a/>', true, options)).toEqual(['VC_PE_NESTING', 'VC_PE_NESTING']);
    expect(invalid('<!DOCTYPE a SYSTEM "a.dtd"><a/>', false, options)).toEqual([]);
  });

  it('reports a conditional section that ends in another entity (VC: Proper Conditional Section/PE Nesting)', () => {
    const dtd = '<!ENTITY % end "]]>"><![INCLUDE[ <!ELEMENT a ANY> %end;';
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'urn:dtd', text: dtd }) },
    };
    expect(invalid('<!DOCTYPE a SYSTEM "a.dtd"><a/>', true, options)).toEqual(['VC_PE_NESTING']);
  });
});
