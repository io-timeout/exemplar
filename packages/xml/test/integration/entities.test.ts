import { canonical, errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { createFilteredReader } from '@/filters/index.ts';
import { type AsyncStreamReader, EventType, type InputOptions, XMLInputFactory } from '@/index.ts';

/** A DOCTYPE declaring the given internal entities. */
function dtd(entities: Record<string, string>): string {
  const declarations = Object.entries(entities).map(([name, value]) => `<!ENTITY ${name} "${value}">`);
  return `<!DOCTYPE a [${declarations.join('')}]>`;
}

describe('entities in content (§4.4)', () => {
  it('expands an internal entity of plain text', () => {
    expect(parseEveryWay(`${dtd({ e: 'some text' })}<a>[&e;]</a>`)).toBe('<a>[some text]</a>');
  });

  it('expands an internal entity holding markup, nested entities included', () => {
    const xml = `${dtd({ e: "<b x='1'>&f;</b>", f: 'inner' })}<a>&e;&e;</a>`;
    expect(parseEveryWay(xml)).toBe('<a><b x="1">inner</b><b x="1">inner</b></a>');
  });

  it('keeps a CR from a character reference in the replacement text (§2.11)', () => {
    expect(parseEveryWay(`${dtd({ e: 'x&#38;#13;y&#13;z' })}<a>&e;</a>`)).toBe('<a>x&#13;y&#13;z</a>');
  });

  it('decodes references that the entity value left in (§4.5)', () => {
    expect(parseEveryWay(`${dtd({ e: '&#38;#60;b/>' })}<a>&e;</a>`)).toBe('<a>&lt;b/&gt;</a>');
    expect(parseEveryWay(`${dtd({ e: '&#60;b/>' })}<a>&e;</a>`)).toBe('<a><b></b></a>');
  });

  it('rejects an undeclared entity in a document whose DTD was read in full (WFC: Entity Declared)', () => {
    expect(errorOf(`${dtd({ e: 'x' })}<a>&f;</a>`).code).toBe('WF_UNDECLARED_ENTITY');
  });

  it('reports a reference to an entity whose declaration may not have been read as a skipped entity', () => {
    const r = reader('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>');
    r.next();
    r.next();
    expect([r.next(), r.name(), r.text()]).toEqual([EventType.ENTITY_REFERENCE, 'e', '']);
  });

  it('reports an undeclared entity as a validity error when the DTD has parts it read', () => {
    const errors: string[] = [];
    const options = { errorHandler: { error: (e: { code: string }) => errors.push(e.code) } };
    canonical('<!DOCTYPE a [<!ENTITY % p ""> %p;]><a>&e;</a>', options);
    expect(errors).toEqual(['VC_ENTITY_DECLARED']);
  });

  it('rejects recursion (WFC: No Recursion)', () => {
    expect(errorOf(`${dtd({ e: '&f;', f: '&e;' })}<a>&e;</a>`).code).toBe('WF_RECURSIVE_ENTITY');
  });

  it('rejects a reference to an unparsed entity (WFC: Parsed Entity)', () => {
    const xml = '<!DOCTYPE a [<!NOTATION n SYSTEM "n"><!ENTITY u SYSTEM "u" NDATA n>]><a>&u;</a>';
    expect(errorOf(xml).code).toBe('WF_UNPARSED_ENTITY');
  });

  it('requires an entity to end the elements it starts (§4.3.2)', () => {
    expect(errorOf(`${dtd({ e: '<b>' })}<a>&e;</b></a>`).code).toBe('WF_ENTITY_CONTENT');
    expect(errorOf(`${dtd({ e: '</a>' })}<a>&e;`).code).toBe('WF_ENTITY_CONTENT');
  });

  it('treats names like toString in attribute values as entities, not as properties', () => {
    expect(errorOf('<a b="&toString;"/>').code).toBe('WF_UNDECLARED_ENTITY');
    expect(parseEveryWay(`${dtd({ toString: 'x' })}<a b="&toString;"/>`)).toBe('<a b="x"></a>');
  });

  it('matches end tags on either side of an entity holding elements of the same name', () => {
    expect(parseEveryWay(`${dtd({ e: '<a>x</a>' })}<a>&e;<b>&e;</b></a>`)).toBe('<a><a>x</a><b><a>x</a></b></a>');
    expect(errorOf(`${dtd({ e: '<a>x</a>' })}<a>&e;</b>`).code).toBe('WF_END_TAG_MISMATCH');
  });

  it('rejects ]]> in an entity used in content (§2.4)', () => {
    expect(errorOf(`${dtd({ e: ']]>' })}<a>&e;</a>`).code).toBe('WF_CDATA_END_IN_TEXT');
  });

  it('gives errors inside an entity the reference location and the entity chain', () => {
    const error = errorOf(`${dtd({ e: '&f;', f: '<b' })}<a>\n &e;</a>`);
    expect(error).toMatchObject({ line: 2, column: 2, entities: ['e', 'f'] });
  });

  it('reports references as ENTITY_REFERENCE events when replaceEntityReferences is off', () => {
    const r = reader(`${dtd({ e: 'text' })}<a>&e;</a>`, { replaceEntityReferences: false });
    r.next();
    r.next();
    expect([r.next(), r.name(), r.text()]).toEqual([EventType.ENTITY_REFERENCE, 'e', 'text']);
  });

  it('uses entities known in advance when the DTD does not declare them', () => {
    const options = { entities: { nbsp: '\u00A0', copy: '©' } };
    expect(parseEveryWay('<a>&nbsp;&copy;</a>', options)).toBe('<a>\u00A0©</a>');
    expect(parseEveryWay(`${dtd({ copy: '(c)' })}<a>&copy;</a>`, options)).toBe('<a>(c)</a>');
  });
});

describe('entities in attribute values (§3.3.3, §4.4.4)', () => {
  it('expands internal entities and normalizes their whitespace', () => {
    expect(parseEveryWay(`${dtd({ e: 'a&#10;b c', f: '&e;!' })}<a x="&f;"/>`)).toBe('<a x="a b c!"></a>');
  });

  it('keeps whitespace written as character references in the replacement text', () => {
    expect(parseEveryWay(`${dtd({ e: '&#38;#10;' })}<a x="[&e;]"/>`)).toBe('<a x="[&#10;]"></a>');
  });

  it('rejects < in an entity used in an attribute value (WFC: No < in Attribute Values)', () => {
    expect(errorOf(`${dtd({ e: '&#60;' })}<a x="&e;"/>`).code).toBe('WF_LT_IN_ATTRIBUTE');
  });

  it('rejects an external entity in an attribute value (WFC: No External Entity References)', () => {
    expect(errorOf('<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a x="&e;"/>').code).toBe(
      'WF_EXTERNAL_ENTITY_IN_ATTRIBUTE'
    );
  });

  it('reports a reference to an entity whose declaration was not read as an error, and drops it', () => {
    const errors: string[] = [];
    const options = { errorHandler: { error: (e: { code: string }) => errors.push(e.code) } };
    expect(canonical('<!DOCTYPE a SYSTEM "a.dtd"><a x="[&e;]"/>', options)).toBe('<a x="[]"></a>');
    expect(errors).toEqual(['UNREAD_ENTITY_IN_ATTRIBUTE']);
  });
});

describe('entity limits (JDK names and defaults)', () => {
  const laughs = (levels: number) => {
    const declarations = [`<!ENTITY l0 "ha">`];
    for (let i = 1; i <= levels; i++) {
      const value = `&l${i - 1};`.repeat(10);
      declarations.push(`<!ENTITY l${i} "${value}">`);
    }
    return `<!DOCTYPE a [${declarations.join('')}]>`;
  };

  it('stops the billion laughs at entityExpansions', () => {
    expect(errorOf(`${laughs(9)}<a>&l9;</a>`).code).toBe('LIMIT_ENTITY_EXPANSIONS');
    expect(errorOf(`${laughs(9)}<a x="&l9;"/>`).code).toBe('LIMIT_ENTITY_EXPANSIONS');
  });

  it('stops an entity longer than generalEntitySize', () => {
    const options = { limits: { generalEntitySize: 10 } };
    const doctype = dtd({ e: 'x'.repeat(11) });
    expect(errorOf(`${doctype}<a>&e;</a>`, options).code).toBe('LIMIT_GENERAL_ENTITY_SIZE');
  });

  it('stops expansions that produce more than totalEntitySize characters', () => {
    const options = { limits: { totalEntitySize: 25 } };
    const doctype = dtd({ e: 'x'.repeat(10) });
    expect(errorOf(`${doctype}<a>&e;&e;&e;</a>`, options).code).toBe('LIMIT_TOTAL_ENTITY_SIZE');
  });

  it('stops entities that produce more than entityReferenceNodes nodes', () => {
    const options = { limits: { entityReferenceNodes: 5 } };
    expect(errorOf(`${dtd({ e: '<b/><b/><b/>' })}<a>&e;</a>`, options).code).toBe('LIMIT_ENTITY_REPLACEMENT');
  });

  it('stops a parameter entity longer than parameterEntitySize', () => {
    const options = { limits: { parameterEntitySize: 5 } };
    expect(errorOf('<!DOCTYPE a [<!ENTITY % p "<!--long-->"> %p;]><a/>', options).code).toBe(
      'LIMIT_PARAMETER_ENTITY_SIZE'
    );
  });
});

describe('entity boundaries (reportEntityBoundaries)', () => {
  const NAMES: Partial<Record<number, string>> = {
    [EventType.START_ELEMENT]: 'start',
    [EventType.END_ELEMENT]: 'end',
    [EventType.CHARACTERS]: 'text',
    [EventType.START_ENTITY]: 'START_ENTITY',
    [EventType.END_ENTITY]: 'END_ENTITY',
  };

  /** One event as text: its kind, then the name or text it carries. */
  function describe1(r: AsyncStreamReader, event: EventType): string {
    const kind = NAMES[event] ?? String(event);
    return event === EventType.CHARACTERS ? `${kind} ${r.text()}` : `${kind} ${r.name()}`;
  }

  /** The events of a document, read whole or fed in chunks of one byte to an asynchronous reader. */
  function events(xml: string, options: InputOptions = {}, fed = false): string[] {
    const factory = new XMLInputFactory({ reportEntityBoundaries: true, ...options });
    const r = fed ? factory.createAsyncStreamReader() : (factory.createStreamReader(xml) as AsyncStreamReader);
    const bytes = new TextEncoder().encode(xml);
    const out: string[] = [];
    let at = 0;
    for (let event = r.next(); event !== EventType.END_DOCUMENT; event = r.next()) {
      if (event === EventType.NEED_INPUT) {
        if (at < bytes.length) r.feed(bytes.subarray(at, ++at));
        else r.endOfInput();
      } else if (event !== EventType.START_DOCUMENT && event !== EventType.DTD) {
        out.push(describe1(r, event));
      }
    }
    return out;
  }

  it('reports where an entity holding markup starts and ends, around what it expands to', () => {
    const xml = `${dtd({ intro: '<p>Hello</p>' })}<a>&intro;<p>Bye</p></a>`;
    const expected = ['start a', 'START_ENTITY intro', 'start p', 'text Hello', 'end p', 'END_ENTITY intro'];
    expect(events(xml)).toEqual([...expected, 'start p', 'text Bye', 'end p', 'end a']);
    expect(events(xml, {}, true)).toEqual(events(xml));
  });

  it('reports text-only, empty and nested entities, and none in attribute values', () => {
    const xml = `${dtd({ t: 'text', none: '', outer: 'x&t;y' })}<a b="&t;">&t;&none;&outer;</a>`;
    expect(events(xml)).toEqual([
      'start a',
      'START_ENTITY t',
      'text text',
      'END_ENTITY t',
      'START_ENTITY none',
      'END_ENTITY none',
      'START_ENTITY outer',
      'text x',
      'START_ENTITY t',
      'text text',
      'END_ENTITY t',
      'text y',
      'END_ENTITY outer',
      'end a',
    ]);
    expect(events(xml, {}, true)).toEqual(events(xml));
  });

  it('does not merge text across a boundary when coalescing', () => {
    const xml = `${dtd({ t: 'inside' })}<a>before&t;after</a>`;
    expect(events(xml, { coalescing: true })).toEqual([
      'start a',
      'text before',
      'START_ENTITY t',
      'text inside',
      'END_ENTITY t',
      'text after',
      'end a',
    ]);
    expect(events(xml, { coalescing: false })).toEqual(events(xml, { coalescing: true }));
  });

  it('reports external entities, as event objects too, and passes the events to filters', () => {
    const options: InputOptions = {
      accessExternalEntities: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'file:///e.xml', text: '<e/>' }) },
    };
    const xml = '<!DOCTYPE a [<!ENTITY ext SYSTEM "e.xml">]><a>&ext;</a>';
    expect(events(xml, options)).toEqual([
      'start a',
      'START_ENTITY ext',
      'start e',
      'end e',
      'END_ENTITY ext',
      'end a',
    ]);
    const factory = new XMLInputFactory({ reportEntityBoundaries: true, ...options });
    const objects = [...factory.createEventReader(xml)].filter((e) => e.type >= EventType.START_ENTITY);
    const boundary = (e: (typeof objects)[number]) =>
      e.type === EventType.START_ENTITY || e.type === EventType.END_ENTITY ? e.name : '';
    expect(objects.map((e) => [e.type, boundary(e)])).toEqual([
      [EventType.START_ENTITY, 'ext'],
      [EventType.END_ENTITY, 'ext'],
    ]);
    const seen: string[] = [];
    const filtered = createFilteredReader(factory.createStreamReader(xml), (r) => {
      if (r.eventType() >= EventType.START_ENTITY) seen.push(r.name());
      return true;
    });
    while (filtered.next() !== EventType.END_DOCUMENT);
    expect(seen).toEqual(['ext', 'ext']);
  });

  it('reports nothing when off', () => {
    const xml = `${dtd({ t: 'text' })}<a>&t;</a>`;
    expect(events(xml, { reportEntityBoundaries: false })).toEqual(['start a', 'text text', 'end a']);
  });
});

describe('the Entity Declared rules end to end (§4.1)', () => {
  /** What a document with an undeclared entity gives: its canonical form with the errors reported, or the fatal code. */
  function outcome(xml: string, options: InputOptions = {}): string {
    const errors: string[] = [];
    try {
      const text = canonical(xml, { ...options, errorHandler: { error: (e) => errors.push(e.code) } });
      return `${text} ${errors.join(',')}`.trim();
    } catch (error) {
      return (error as { code: string }).code;
    }
  }

  it.each([
    ['no DOCTYPE', '<a>&u;</a>', 'WF_UNDECLARED_ENTITY'],
    ['only an internal subset', '<!DOCTYPE a [<!ENTITY e "x">]><a>&u;</a>', 'WF_UNDECLARED_ENTITY'],
    [
      'standalone="yes"',
      '<?xml version="1.0" standalone="yes"?><!DOCTYPE a SYSTEM "a.dtd"><a>&u;</a>',
      'WF_UNDECLARED_ENTITY',
    ],
    ['an external subset not read', '<!DOCTYPE a SYSTEM "a.dtd"><a>&u;</a>', '<a></a>'],
    ['a parameter entity not read', '<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent"> %p;]><a>&u;</a>', '<a></a>'],
    ['parameter entities all read', '<!DOCTYPE a [<!ENTITY % p ""> %p;]><a>&u;</a>', '<a></a> VC_ENTITY_DECLARED'],
  ])('with %s', (_, xml, expected) => {
    expect(outcome(xml)).toBe(expected);
  });

  it('needs no declaration for the predefined entities, even with no DTD', () => {
    expect(parseEveryWay('<a b="&lt;&gt;&amp;&apos;&quot;">&lt;&gt;&amp;&apos;&quot;</a>')).toBe(
      '<a b="&lt;&gt;&amp;\'&quot;">&lt;&gt;&amp;\'&quot;</a>'
    );
  });

  it('treats entity names case-sensitively: &AMP; is not &amp;', () => {
    expect(errorOf('<a>&AMP;</a>').code).toBe('WF_UNDECLARED_ENTITY');
  });

  it('accepts entity names made of any name characters', () => {
    const xml =
      '<!DOCTYPE a [<!ENTITY _u "1"><!ENTITY u_s "2"><!ENTITY d-a "3"><!ENTITY d.o "4"><!ENTITY é "5">]><a>&_u;&u_s;&d-a;&d.o;&é;</a>';
    expect(parseEveryWay(xml)).toBe('<a>12345</a>');
  });

  it.each([
    ['<a>&-bad;</a>', 'WF_REFERENCE'],
    ['<a>&.bad;</a>', 'WF_REFERENCE'],
    ['<a>&#hash;</a>', 'WF_CHARACTER_REFERENCE'],
    ['<a>&:c;</a>', 'NS_COLON'],
    ['<a>&e</a>', 'WF_REFERENCE'],
  ])('rejects the malformed reference %j (§4.1 [67]–[69])', (xml, code) => {
    expect(errorOf(xml).code).toBe(code);
  });
});

describe('nested entities (§4.4.2, §4.5)', () => {
  it('expands entities that refer to entities, in content and in attribute values', () => {
    const xml = `${dtd({ a: '[&b;]', b: '(&c;)', c: 'x' })}<r v="&a;">&a;</r>`;
    expect(parseEveryWay(xml)).toBe('<r v="[(x)]">[(x)]</r>');
  });

  it('decodes references left in replacement text once, at the reference (§4.6)', () => {
    expect(parseEveryWay('<!DOCTYPE r [<!ENTITY e "&#38;#38;amp;">]><r>&e;</r>')).toBe('<r>&amp;amp;</r>');
    expect(parseEveryWay('<!DOCTYPE r [<!ENTITY e "&#38;amp;">]><r>&e;</r>')).toBe('<r>&amp;</r>');
  });

  it('rejects recursion however deep (WFC: No Recursion)', () => {
    expect(errorOf(`${dtd({ a: '&b;', b: '&c;', c: '&a;' })}<r>&a;</r>`)).toMatchObject({
      code: 'WF_RECURSIVE_ENTITY',
      entities: ['a', 'b', 'c'],
    });
    expect(errorOf(`${dtd({ a: '&b;', b: '&a;' })}<r v="&a;"/>`).code).toBe('WF_RECURSIVE_ENTITY');
    expect(errorOf(`${dtd({ e: '<x>&e;</x>' })}<r>&e;</r>`).code).toBe('WF_RECURSIVE_ENTITY');
  });

  it('lets an entity be used again once its expansion has ended', () => {
    expect(parseEveryWay(`${dtd({ a: '&b;&b;', b: 'x' })}<r>&a;&b;</r>`)).toBe('<r>xxx</r>');
  });

  it('requires an entity holding markup to hold whole elements, at any depth (§4.3.2)', () => {
    expect(errorOf(`${dtd({ open: '<b>', close: '</b>' })}<a>&open;&close;</a>`).code).toBe('WF_ENTITY_CONTENT');
    expect(parseEveryWay(`${dtd({ pair: '<b>&inner;</b>', inner: '<c/>' })}<a>&pair;</a>`)).toBe(
      '<a><b><c></c></b></a>'
    );
  });

  it('allows the predefined entities in replacement text holding markup', () => {
    expect(parseEveryWay(`${dtd({ e: '<b>&amp;lt;</b>' })}<a>&e;</a>`)).toBe('<a><b>&amp;lt;</b></a>');
  });

  it('keeps characters beyond the BMP from replacement text', () => {
    expect(parseEveryWay(`${dtd({ e: '𝄞&#x1F600;' })}<a v="&e;">&e;</a>`)).toBe('<a v="𝄞😀">𝄞😀</a>');
  });
});

describe('external entities end to end (§4.2.2, §4.4.3)', () => {
  /** Options reading external general entities from a map of system id to text. */
  const files = (texts: Record<string, string>, extra: InputOptions = {}): InputOptions => ({
    accessExternalEntities: 'all',
    entityResolver: {
      resolveEntity: ({ systemId = '' }) =>
        texts[systemId] === undefined ? undefined : { systemId: `urn:${systemId}`, text: texts[systemId] },
    },
    ...extra,
  });

  it('expands an external entity holding markup, entity references and its own text declaration', () => {
    const options = files({ 'x.xml': '<?xml encoding="UTF-8"?><b>&i;</b>&amp;' });
    const xml = '<!DOCTYPE a [<!ENTITY i "inner"><!ENTITY x SYSTEM "x.xml">]><a>&x;</a>';
    expect(parseEveryWay(xml, options)).toBe('<a><b>inner</b>&amp;</a>');
  });

  it('rejects an external entity in an attribute value even when it could be read (WFC: No External Entity References)', () => {
    const options = files({ 'x.xml': 'text' });
    expect(errorOf('<!DOCTYPE a [<!ENTITY x SYSTEM "x.xml">]><a v="&x;"/>', options).code).toBe(
      'WF_EXTERNAL_ENTITY_IN_ATTRIBUTE'
    );
  });

  it('rejects an external entity that refers to itself through another', () => {
    const options = files({ 'x.xml': '&y;', 'y.xml': '&x;' });
    const xml = '<!DOCTYPE a [<!ENTITY x SYSTEM "x.xml"><!ENTITY y SYSTEM "y.xml">]><a>&x;</a>';
    expect(errorOf(xml, options)).toMatchObject({ code: 'WF_RECURSIVE_ENTITY', entities: ['x', 'y'] });
  });

  it('counts external expansions against the limits', () => {
    const options = files({ 'x.xml': 'x' }, { limits: { entityExpansions: 2 } });
    expect(errorOf('<!DOCTYPE a [<!ENTITY x SYSTEM "x.xml">]><a>&x;&x;&x;</a>', options).code).toBe(
      'LIMIT_ENTITY_EXPANSIONS'
    );
  });

  it('counts nesting inside an external entity against elementDepth', () => {
    const options = files({ 'x.xml': `${'<b>'.repeat(100)}${'</b>'.repeat(100)}` });
    expect(errorOf('<!DOCTYPE a [<!ENTITY x SYSTEM "x.xml">]><a>&x;</a>', options)).toMatchObject({
      code: 'LIMIT_ELEMENT_DEPTH',
      entities: ['x'],
      systemId: 'urn:x.xml',
    });
  });

  it('reports one that is not read as a skipped entity, and goes on', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ENTITY x SYSTEM "x.xml">]><a>1&x;2</a>')).toBe('<a>12</a>');
  });
});

describe('parameter entities end to end (§4.4.8)', () => {
  it('builds declarations from parameter entities between them, nested', () => {
    const xml = `<!DOCTYPE a [<!ENTITY % decl "<!ENTITY e 'built'>"><!ENTITY % outer "&#37;decl;"> %outer;]><a>&e;</a>`;
    expect(parseEveryWay(xml)).toBe('<a>built</a>');
  });

  it('reads a parameter entity’s replacement text with a space either side, inside declarations (§4.4.8)', () => {
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'urn:d', text: '<!ENTITY % n "e"><!ENTITY%n;"spaced">' }) },
    };
    expect(parseEveryWay('<!DOCTYPE a SYSTEM "d"><a>&e;</a>', options)).toBe('<a>spaced</a>');
  });

  it('stops a billion laughs of parameter entities at a limit', () => {
    let declarations = '<!ENTITY % l0 "<!--x-->">';
    for (let i = 1; i <= 6; i++) {
      const references = `&#37;l${i - 1};`.repeat(10);
      declarations += `<!ENTITY % l${i} "${references}">`;
    }
    expect(errorOf(`<!DOCTYPE r [${declarations} %l6;]><r/>`).code).toBe('LIMIT_ENTITY_EXPANSIONS');
  });

  it('stops parameter entities in entity values that grow past parameterEntitySize', () => {
    let declarations = '<!ENTITY % l0 "ha">';
    for (let i = 1; i <= 6; i++) {
      const references = `%l${i - 1};`.repeat(10);
      declarations += `<!ENTITY % l${i} "${references}">`;
    }
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: { resolveEntity: () => ({ systemId: 'urn:d', text: declarations }) },
    };
    expect(errorOf('<!DOCTYPE r SYSTEM "d"><r/>', options)).toMatchObject({
      code: 'LIMIT_PARAMETER_ENTITY_SIZE',
      systemId: 'urn:d',
    });
  });
});

describe('limits beyond the defaults', () => {
  it('lets a factory raise a limit for documents it trusts', () => {
    let declarations = '<!ENTITY l0 "ha">';
    for (let i = 1; i <= 4; i++) {
      const references = `&l${i - 1};`.repeat(10);
      declarations += `<!ENTITY l${i} "${references}">`;
    }
    const xml = `<!DOCTYPE a [${declarations}]><a>&l4;</a>`;
    expect(errorOf(xml).code).toBe('LIMIT_ENTITY_EXPANSIONS');
    expect(parseEveryWay(xml, { limits: { entityExpansions: 20_000 } })).toBe(`<a>${'ha'.repeat(10_000)}</a>`);
  });

  it('stops a quadratic blowup: one large entity referred to many times', () => {
    const xml = `<!DOCTYPE a [<!ENTITY big "${'x'.repeat(10_000)}">]><a>${'&big;'.repeat(11)}</a>`;
    expect(errorOf(xml).code).toBe('LIMIT_TOTAL_ENTITY_SIZE');
    expect(errorOf(`<!DOCTYPE a [<!ENTITY big "${'x'.repeat(10_000)}">]><a v="${'&big;'.repeat(11)}"/>`).code).toBe(
      'LIMIT_TOTAL_ENTITY_SIZE'
    );
  });

  it('counts each event an entity produces against entityReferenceNodes, but not attribute values', () => {
    const options = { limits: { entityReferenceNodes: 5 } };
    expect(errorOf(`${dtd({ e: 'x' })}<a>${'&e;'.repeat(6)}</a>`, options).code).toBe('LIMIT_ENTITY_REPLACEMENT');
    expect(parseEveryWay(`${dtd({ e: 'x' })}<a v="${'&e;'.repeat(10)}"/>`, options)).toBe(
      `<a v="${'x'.repeat(10)}"></a>`
    );
  });

  it('stops a long name in an entity’s replacement text at nameLength', () => {
    const long = `<${'n'.repeat(20)}/>`;
    const error = errorOf(`${dtd({ e: long })}<a>&e;</a>`, { limits: { nameLength: 10 } });
    expect(error.code).toBe('LIMIT_NAME_LENGTH');
  });
});

describe('what the entity limits count, as in JDK 24', () => {
  /** Options that read external entities from texts by system id, with some limits replaced. */
  function external(files: Record<string, string>, limits: NonNullable<InputOptions['limits']>): InputOptions {
    return {
      accessExternalDTD: 'all',
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: ({ systemId }) => {
          const text = systemId === undefined ? undefined : files[systemId];
          return systemId === undefined || text === undefined ? undefined : { systemId, text };
        },
      },
      limits,
    };
  }

  it('does not count an external parameter entity, such as a DTD module, toward the size limits', () => {
    const files = { 'm.ent': '<!-- a module longer than the limits -->' };
    const options = external(files, { parameterEntitySize: 5, totalEntitySize: 5 });
    expect(parseEveryWay('<!DOCTYPE d [<!ENTITY % m SYSTEM "m.ent">%m;]><d/>', options)).toBe('<d></d>');
  });

  it('counts a parameter entity inside a declaration toward its own size, but not toward the total', () => {
    const attlists = ['e1', 'e2', 'e3'].map((e) => `<!ATTLIST ${e} %a;>`).join('');
    const files = { 'd.dtd': `<!ENTITY % a "x CDATA #IMPLIED">${attlists}` };
    const xml = '<!DOCTYPE d SYSTEM "d.dtd"><d/>';
    expect(parseEveryWay(xml, external(files, { totalEntitySize: 20 }))).toBe('<d></d>');
    expect(errorOf(xml, external(files, { parameterEntitySize: 10 })).code).toBe('LIMIT_PARAMETER_ENTITY_SIZE');
  });

  it('counts a parameter entity between declarations toward the total', () => {
    const declarations = ['1', '2', '3'].map((n) => `<!ENTITY % m${n} "<!--${n}${'x'.repeat(10)}-->">%m${n};`);
    const xml = `<!DOCTYPE d [${declarations.join('')}]><d/>`;
    expect(errorOf(xml, { limits: { totalEntitySize: 40 } }).code).toBe('LIMIT_TOTAL_ENTITY_SIZE');
  });

  it('counts an external general entity toward generalEntitySize, and each reference toward the total', () => {
    const files = { 'g.ent': 'y'.repeat(30) };
    const xml = '<!DOCTYPE d [<!ENTITY g SYSTEM "g.ent">]><d>&g;&g;</d>';
    expect(errorOf(xml, external(files, { generalEntitySize: 20 })).code).toBe('LIMIT_GENERAL_ENTITY_SIZE');
    expect(errorOf(xml, external(files, { totalEntitySize: 50 })).code).toBe('LIMIT_TOTAL_ENTITY_SIZE');
    expect(parseEveryWay(xml, external(files, { totalEntitySize: 60 }))).toBe(`<d>${'y'.repeat(60)}</d>`);
  });

  it('counts every expansion, external entities included, toward entityExpansions', () => {
    const files = { 'm.ent': '', 'g.ent': 'y' };
    const pe = `<!DOCTYPE d [<!ENTITY % m SYSTEM "m.ent">${'%m;'.repeat(3)}]><d/>`;
    expect(errorOf(pe, external(files, { entityExpansions: 2 })).code).toBe('LIMIT_ENTITY_EXPANSIONS');
    const ge = `<!DOCTYPE d [<!ENTITY g SYSTEM "g.ent">]><d>${'&g;'.repeat(3)}</d>`;
    expect(errorOf(ge, external(files, { entityExpansions: 2 })).code).toBe('LIMIT_ENTITY_EXPANSIONS');
  });
});
