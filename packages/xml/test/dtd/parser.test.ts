import { canonical, errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import type {
  AttributeDeclaration,
  ElementDeclaration,
  EntityDeclaration,
  NotationDeclaration,
} from '@/dtd/declarations.ts';
import type { DtdContext, Frame } from '@/dtd/input.ts';
import { DtdParser } from '@/dtd/parser.ts';
import { DeclarationStore, type DtdItem } from '@/dtd/store.ts';
import { EntityCounter } from '@/entities/limits.ts';
import type { Location } from '@/errors/xml-error.ts';
import { DEFAULT_LIMITS, EventType, type InputOptions, ResolutionError, type Source, XMLError } from '@/index.ts';
import { DTD_ITEMS, accessRefusedError } from '@/internal.ts';

/** Reads to the DTD event and returns what it reports. */
function doctype(xml: Source, options: InputOptions = {}) {
  const r = reader(xml, options);
  while (r.next() !== EventType.DTD);
  return r.doctype();
}

/** Reads to the DTD event and returns what the DTD held, for SAX. */
function items(xml: string, options: InputOptions = {}): readonly DtdItem[] {
  const r = reader(xml, options);
  while (r.next() !== EventType.DTD);
  return r[DTD_ITEMS]();
}

/** The declaration types by the kind of DTD item that holds them. */
interface Declarations {
  element: ElementDeclaration;
  attribute: AttributeDeclaration;
  entity: EntityDeclaration;
  notation: NotationDeclaration;
}

/** The declarations of one kind the DTD held. */
function declarations<K extends keyof Declarations>(xml: string, kind: K): Declarations[K][] {
  return items(xml).flatMap((item) =>
    item.kind === kind && 'declaration' in item ? [item.declaration as Declarations[K]] : []
  );
}

/** Options that read external DTD text from a map of system id to text, as `urn:<system id>`. */
function served(files: Record<string, string>, extra: InputOptions = {}): InputOptions {
  return {
    accessExternalDTD: 'all',
    entityResolver: {
      resolveEntity: ({ systemId = '' }) => {
        const text = files[systemId];
        return text === undefined ? undefined : { systemId: `urn:${systemId}`, text };
      },
    },
    ...extra,
  };
}

/** Reads `<a>&e;</a>` with an external subset; returns its canonical form or the error's code and place. */
function external(dtd: string, files: Record<string, string> = {}, extra: InputOptions = {}): string {
  try {
    return canonical('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', served({ 'a.dtd': dtd, ...files }, extra));
  } catch (error) {
    if (!(error instanceof XMLError)) throw error;
    return `${error.code} ${error.systemId ?? ''}:${error.line}:${error.column} ${error.entities.join(',')}`.trim();
  }
}

/** The recoverable errors a document reports to a handler that lets parsing go on. */
function recoverable(xml: string, options: InputOptions = {}): string[] {
  const codes: string[] = [];
  canonical(xml, { ...options, errorHandler: { error: (e) => codes.push(e.code) } });
  return codes;
}

describe('markup declarations (§2.8, §3.2, §3.3, §4.2, §4.7)', () => {
  it('reads entity and notation declarations', () => {
    const dtd = doctype(`<!DOCTYPE a [
      <!ENTITY e "text">
      <!ENTITY x SYSTEM "x.xml">
      <!ENTITY u PUBLIC "-//U//EN" "u.gif" NDATA gif>
      <!NOTATION gif PUBLIC "-//GIF//EN">
      <!NOTATION png SYSTEM "png.exe">
    ]><a/>`);
    expect(dtd.entities.map((e) => [e.name, e.value, e.systemId, e.notation])).toEqual([
      ['e', 'text', undefined, undefined],
      ['x', undefined, 'x.xml', undefined],
      ['u', undefined, 'u.gif', 'gif'],
    ]);
    expect(dtd.notations).toEqual([
      { name: 'gif', publicId: '-//GIF//EN' },
      { name: 'png', systemId: 'png.exe' },
    ]);
  });

  it('keeps the first declaration of an entity (§4.2)', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ENTITY e "1"><!ENTITY e "2">]><a>&e;</a>')).toBe('<a>1</a>');
  });

  it('builds replacement text: character references expanded, general references left in (§4.5)', () => {
    const dtd = doctype('<!DOCTYPE a [<!ENTITY e "x&#38;y&#x41;&amp;z&f;">]><a/>');
    expect(dtd.entities[0]?.value).toBe('x&yA&amp;z&f;');
  });

  it('rejects malformed declarations', () => {
    expect(errorOf('<!DOCTYPE a [<!ENTITY e>]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!ENTITYe "x">]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!ELEMENT a (b|c,d)>]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!ELEMENT a (#PCDATA|b)>]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!ATTLIST a b CDATTA #IMPLIED>]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!ATTLIST a b CDATA>]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!NOTATION n>]><a/>').code).toBe('WF_DECLARATION');
    expect(errorOf('<!DOCTYPE a [<!ENTITY e "a%b">]><a/>').code).toBe('WF_PE_IN_INTERNAL_SUBSET');
  });

  it('accepts content models of every form (§3.2.1, §3.2.2)', () => {
    const xml = `<!DOCTYPE a [
      <!ELEMENT a (b, (c | d)*, e?)+>
      <!ELEMENT b EMPTY>
      <!ELEMENT c ANY>
      <!ELEMENT d (#PCDATA)>
      <!ELEMENT e ( #PCDATA | b | c )*>
    ]><a/>`;
    expect(parseEveryWay(xml)).toBe('<a></a>');
  });

  it('rejects a public identifier with a character PubidChar does not allow', () => {
    expect(errorOf('<!DOCTYPE a [<!NOTATION n PUBLIC "a{b">]><a/>').code).toBe('WF_DECLARATION');
  });

  it('rejects xml as a PI target in the DTD, and malformed comments', () => {
    expect(errorOf('<!DOCTYPE a [<?xml version="1.0"?>]><a/>').code).toBe('WF_XML_DECLARATION_MISPLACED');
    expect(errorOf('<!DOCTYPE a [<!-- a -- b -->]><a/>').code).toBe('WF_COMMENT');
  });

  it('reports the PIs in the DTD with the DTD event', () => {
    expect(doctype('<!DOCTYPE a [<?p some data?>]><a/>').processingInstructions).toEqual([
      { target: 'p', data: 'some data' },
    ]);
  });

  it('requires colon-free entity and notation names, and QNames in declarations, when namespace-aware', () => {
    expect(errorOf('<!DOCTYPE a [<!ENTITY a:b "x">]><a/>').code).toBe('NS_COLON');
    expect(errorOf('<!DOCTYPE a [<!ELEMENT a:b:c ANY>]><a/>').code).toBe('NS_QNAME');
    expect(parseEveryWay('<!DOCTYPE a [<!ENTITY a:b "x">]><a/>', { namespaceAware: false })).toBe('<a></a>');
  });

  it('accepts an empty internal subset, and whitespace, comments and PIs between declarations', () => {
    expect(parseEveryWay('<!DOCTYPE svg []><svg/>')).toBe('<svg></svg>');
    expect(parseEveryWay('<!DOCTYPE s [ \n\t<!--x ] \'--> <?p d?>\r\n<!ENTITY e "v"> ]><s>&e;</s>')).toBe('<s>v</s>');
  });

  it('does not let a quote or ] in a DTD comment open a literal or end the subset', () => {
    expect(parseEveryWay("<!DOCTYPE svg [<!--a ' and ] b-->]><svg/>")).toBe('<svg></svg>');
    expect(parseEveryWay('<!DOCTYPE r [<!ENTITY x "a>b"><!-- c [ ] \' -->]><r>&x;</r>')).toBe('<r>a&gt;b</r>');
  });

  it('treats whitespace as XML 1.1 does in an XML 1.1 internal subset', () => {
    expect(parseEveryWay('<?xml version="1.1"?><!DOCTYPE a [\u0085<!ENTITY e "x">\u2028]><a>&e;</a>')).toBe('<a>x</a>');
  });

  it.each([
    ['<!ELEMENTa ANY>', 'WF_DECLARATION', 23],
    ['<!ELEMENT a ANY x>', 'WF_DECLARATION', 30],
    ['<!X>', 'WF_DECLARATION', 14],
    ['<!EXAMPLE>', 'WF_DECLARATION', 14],
    ['<!ANY>', 'WF_DECLARATION', 14],
    ['<!NOTE>', 'WF_DECLARATION', 14],
    ['<!-X>', 'WF_DECLARATION', 14],
    ['<!--a--x-->', 'WF_COMMENT', 19],
    ['<!--a---x-->', 'WF_COMMENT', 19],
    ['<!--a', 'WF_UNEXPECTED_END', 14],
    ['<!-- a --->', 'WF_COMMENT', 21],
    ['<?XmL x?>', 'WF_PI_TARGET_XML', 19],
    ['<?p x', 'WF_UNEXPECTED_END', 14],
    ['<?p"x"?>', 'WF_PI', 17],
    ['<?a:b x?>', 'NS_COLON', 19],
    ['%p', 'WF_DOCTYPE', 16],
  ])('rejects %s in the internal subset', (declaration, code, column) => {
    expect(errorOf(`<!DOCTYPE a [${declaration}]><a/>`)).toMatchObject({ code, line: 1, column });
  });

  it('normalizes line ends in the comments, PIs and literals of the internal subset (§2.11)', () => {
    const xml = '<!DOCTYPE a [<!--a\r\nb--><?p x\ry?><!ENTITY e "a\r\nb">]><a/>';
    expect(items(xml).slice(0, 3)).toEqual([
      { kind: 'comment', text: 'a\nb' },
      { kind: 'pi', target: 'p', data: 'x\ny' },
      {
        kind: 'entity',
        declaration: { name: 'e', isParameterEntity: false, value: 'a\nb', declaredExternally: false },
      },
    ]);
  });
});

describe('element type declarations (§3.2)', () => {
  it('keeps content models as written, without whitespace', () => {
    const xml =
      '<!DOCTYPE a [<!ELEMENT a ( b , ( c | d )* , e? )+><!ELEMENT b EMPTY ><!ELEMENT c ANY><!ELEMENT d ( #PCDATA ) ><!ELEMENT e (#PCDATA)*><!ELEMENT f (#PCDATA | b | c)*>]><a/>';
    expect(declarations(xml, 'element').map((d) => [d.name, d.content])).toEqual([
      ['a', '(b,(c|d)*,e?)+'],
      ['b', 'EMPTY'],
      ['c', 'ANY'],
      ['d', '(#PCDATA)'],
      ['e', '(#PCDATA)*'],
      ['f', '(#PCDATA|b|c)*'],
    ]);
  });

  it.each([
    ['<!ELEMENT a EMPTYx>', 'Expected EMPTY, ANY or ('],
    ['<!ELEMENT a b>', 'Expected EMPTY, ANY or ('],
    ['<!ELEMENT a (#PCDATA|b>', 'Expected ) to end the mixed content model'],
    ['<!ELEMENT a (#PCDATA|b)>', 'Mixed content with element names must end in )*'],
    ['<!ELEMENT a ((#PCDATA))>', '#PCDATA may only start the outer group'],
    ['<!ELEMENT a (b c)>', 'Expected |, , or ) in the content model'],
    ['<!ELEMENT a (b,c|d)>', 'Expected |, , or ) in the content model'],
    ['<!ELEMENT a ()>', 'Expected an element name or ('],
    ['<!ELEMENT a (b) *>', 'Expected > to end the declaration'],
    ['<!ELEMENT a (b ?)>', 'Expected |, , or ) in the content model'],
  ])('rejects %s', (declaration, message) => {
    expect(errorOf(`<!DOCTYPE a [${declaration}]><a/>`)).toMatchObject({ code: 'WF_DECLARATION', message });
  });

  it('requires QNames in content models when namespace-aware', () => {
    expect(errorOf('<!DOCTYPE a [<!ELEMENT a (b:c:d)>]><a/>').code).toBe('NS_QNAME');
    expect(errorOf('<!DOCTYPE a [<!ELEMENT a (#PCDATA|b:c:d)*>]><a/>').code).toBe('NS_QNAME');
    expect(errorOf('<!DOCTYPE a [<!ELEMENT a (:b)>]><a/>').code).toBe('NS_QNAME');
    expect(parseEveryWay('<!DOCTYPE a [<!ELEMENT p:a (p:b)>]><a/>')).toBe('<a></a>');
  });

  it('keeps the first declaration of an element type', () => {
    const xml = '<!DOCTYPE a [<!ELEMENT a ANY><!ELEMENT a EMPTY>]><a/>';
    expect(declarations(xml, 'element').map((d) => d.content)).toEqual(['ANY']);
  });
});

describe('attribute-list declarations (§3.3)', () => {
  it('reads every attribute type, with the values of enumerations and notations (§3.3.1)', () => {
    const xml = `<!DOCTYPE a [<!ATTLIST a
      c CDATA #IMPLIED i ID #IMPLIED r IDREF #IMPLIED rs IDREFS #IMPLIED
      e ENTITY #IMPLIED es ENTITIES #IMPLIED t NMTOKEN #IMPLIED ts NMTOKENS #IMPLIED
      n NOTATION (gif | png) #IMPLIED v ( 1a | b.c | -d ) #IMPLIED>]><a/>`;
    expect(declarations(xml, 'attribute').map((d) => [d.name, d.type, d.values])).toEqual([
      ['c', 'CDATA', undefined],
      ['i', 'ID', undefined],
      ['r', 'IDREF', undefined],
      ['rs', 'IDREFS', undefined],
      ['e', 'ENTITY', undefined],
      ['es', 'ENTITIES', undefined],
      ['t', 'NMTOKEN', undefined],
      ['ts', 'NMTOKENS', undefined],
      ['n', 'NOTATION', ['gif', 'png']],
      ['v', 'ENUMERATION', ['1a', 'b.c', '-d']],
    ]);
  });

  it('reads every kind of default, normalizing a value for its type (§3.3.2)', () => {
    const xml =
      '<!DOCTYPE a [<!ENTITY e "E"><!ATTLIST a r CDATA #REQUIRED i CDATA #IMPLIED f CDATA #FIXED " 1  &e; " d NMTOKENS " x  &e; ">]><a r="0"/>';
    expect(declarations(xml, 'attribute').map((d) => [d.name, d.mode, d.value])).toEqual([
      ['r', 'REQUIRED', undefined],
      ['i', 'IMPLIED', undefined],
      ['f', 'FIXED', ' 1  E '],
      ['d', 'DEFAULT', 'x E'],
    ]);
  });

  it('accepts an attribute-list declaration with no attributes', () => {
    expect(parseEveryWay('<!DOCTYPE a [<!ATTLIST a>]><a/>')).toBe('<a></a>');
  });

  it.each([
    ['<!ATTLIST a x CDATA "1"y CDATA "2">', 'WF_DECLARATION', 'Expected whitespace before the attribute name'],
    ['<!ATTLIST a x NOTATION(n) #IMPLIED>', 'WF_DECLARATION', 'Expected whitespace'],
    ['<!ATTLIST a x NOTATION n #IMPLIED>', 'WF_DECLARATION', 'Expected ('],
    ['<!ATTLIST a x (p q) #IMPLIED>', 'WF_DECLARATION', 'Expected | or )'],
    ['<!ATTLIST a x NOTATION (1a) #IMPLIED>', 'WF_DECLARATION', 'Expected a notation name'],
    ['<!ATTLIST a x (a|) #IMPLIED>', 'WF_DECLARATION', 'Expected a name token'],
    ['<!ATTLIST a x CDATA #FIXED"v">', 'WF_DECLARATION', 'Expected whitespace'],
    ['<!ATTLIST a x CDATA #FOO>', 'WF_DECLARATION', 'Expected a quoted default value'],
    ['<!ATTLIST a x CDATA "<">', 'WF_LT_IN_ATTRIBUTE', undefined],
    ['<!ATTLIST a x CDATA "&u;">', 'WF_UNDECLARED_ENTITY', undefined],
    ['<!ENTITY u SYSTEM "u"><!ATTLIST a x CDATA "&u;">', 'WF_EXTERNAL_ENTITY_IN_ATTRIBUTE', undefined],
    ['<!ATTLIST a x CDATA "&#0;">', 'WF_CHARACTER_REFERENCE', undefined],
    ['<!ATTLIST a b:c:d CDATA #IMPLIED>', 'NS_QNAME', undefined],
    ['<!ATTLIST b:c:d x CDATA #IMPLIED>', 'NS_QNAME', undefined],
  ])('rejects %s', (declaration, code, message) => {
    expect(errorOf(`<!DOCTYPE a [${declaration}]><a/>`)).toMatchObject({ code, ...(message && { message }) });
  });

  it('reports a default value referring to an entity not declared before it as a validity error (§4.1)', () => {
    const xml = '<!DOCTYPE a SYSTEM "a.dtd" [<!ATTLIST a x CDATA "[&u;]">]><a/>';
    expect(recoverable(xml)).toEqual(['VC_ENTITY_DECLARED']);
    expect(canonical(xml, { errorHandler: { error: () => undefined } })).toBe('<a x="[]"></a>');
  });

  it('locates an error in a default value at its literal', () => {
    expect(errorOf('<!DOCTYPE a [\n<!ATTLIST a x CDATA\n "<">]><a/>')).toMatchObject({
      code: 'WF_LT_IN_ATTRIBUTE',
      line: 3,
      column: 2,
    });
  });
});

describe('entity declarations (§4.2)', () => {
  it('reads every form: internal, SYSTEM, PUBLIC, unparsed and parameter', () => {
    const xml = `<!DOCTYPE a [<!ENTITY i "v"><!ENTITY s SYSTEM "s.xml"><!ENTITY p PUBLIC "-//P//EN" "p.xml">
      <!ENTITY u SYSTEM "u.gif" NDATA gif><!ENTITY % pi "<!--x-->"><!ENTITY % ps SYSTEM "ps.ent">]><a/>`;
    expect(declarations(xml, 'entity')).toEqual([
      { name: 'i', isParameterEntity: false, value: 'v', declaredExternally: false },
      { name: 's', isParameterEntity: false, systemId: 's.xml', declaredExternally: false },
      { name: 'p', isParameterEntity: false, publicId: '-//P//EN', systemId: 'p.xml', declaredExternally: false },
      { name: 'u', isParameterEntity: false, systemId: 'u.gif', notation: 'gif', declaredExternally: false },
      { name: 'pi', isParameterEntity: true, value: '<!--x-->', declaredExternally: false },
      { name: 'ps', isParameterEntity: true, systemId: 'ps.ent', declaredExternally: false },
    ]);
  });

  it('records the base URI an external entity’s system id resolves against', () => {
    const xml = { text: '<!DOCTYPE a [<!ENTITY s SYSTEM "s.xml">]><a/>', systemId: 'http://example.org/d/doc.xml' };
    expect(doctype(xml).entities[0]).toMatchObject({ baseURI: 'http://example.org/d/doc.xml' });
  });

  it('normalizes the whitespace of a public identifier (§4.2.2)', () => {
    const xml = '<!DOCTYPE a [<!ENTITY e PUBLIC "  -//A  B//EN \n" "e"><!NOTATION n PUBLIC "\r\n-//N//EN ">]><a/>';
    expect([doctype(xml).entities[0]?.publicId, doctype(xml).notations[0]?.publicId]).toEqual([
      '-//A B//EN',
      '-//N//EN',
    ]);
    expect(errorOf('<!DOCTYPE a [<!NOTATION n PUBLIC "\t-//N//EN">]><a/>').code).toBe('WF_DECLARATION');
  });

  it('ignores a declaration of a predefined entity, which keeps its meaning (§4.6)', () => {
    const xml = '<!DOCTYPE a [<!ENTITY lt "&#38;#60;"><!ENTITY amp "&#38;#38;">]><a>&lt;&amp;</a>';
    expect(parseEveryWay(xml)).toBe('<a>&lt;&amp;</a>');
    expect(doctype(xml).entities).toEqual([]);
  });

  it.each([
    ['<!ENTITY % p SYSTEM "p" NDATA n>', 'WF_DECLARATION', 'Expected > to end the declaration'],
    ['<!ENTITY e SYSTEM "x"NDATA n>', 'WF_DECLARATION', 'Expected whitespace before NDATA'],
    ['<!ENTITY e SYSTEM "x" NDATA a:b>', 'NS_COLON', undefined],
    ['<!ENTITY e SYSTEM>', 'WF_DECLARATION', 'Expected whitespace'],
    ['<!ENTITY e SYSTEM x>', 'WF_DECLARATION', 'Expected a quoted system literal'],
    ['<!ENTITY e PUBLIC "p">', 'WF_DECLARATION', 'Expected whitespace before the system literal'],
    ['<!ENTITY e PUBLIC "p" >', 'WF_DECLARATION', 'Expected a quoted system literal'],
    ['<!ENTITY e FOO>', 'WF_DECLARATION', 'Expected SYSTEM, PUBLIC or a quoted value'],
    ['<!ENTITY e "&#0;">', 'WF_CHARACTER_REFERENCE', undefined],
    ['<!ENTITY e "&#xFFFE;">', 'WF_CHARACTER_REFERENCE', undefined],
    ['<!ENTITY e "a&1x;b">', 'WF_REFERENCE', 'Expected a name or # after &'],
    ['<!ENTITY e "a&x b">', 'WF_REFERENCE', 'Expected ; to end the reference'],
    ['<!ENTITY %e "x">', 'WF_PE_IN_INTERNAL_SUBSET', undefined],
    ['<!ENTITY 1e "x">', 'WF_DECLARATION', 'Expected an entity name'],
  ])('rejects %s', (declaration, code, message) => {
    expect(errorOf(`<!DOCTYPE a [${declaration}]><a/>`)).toMatchObject({ code, ...(message && { message }) });
  });
});

describe('notation declarations (§4.7)', () => {
  it('reads a public id alone, a system id alone, or both, with the base URI', () => {
    const xml = {
      text: '<!DOCTYPE a [<!NOTATION p PUBLIC "p"  ><!NOTATION s SYSTEM "s"><!NOTATION b PUBLIC "p" "s">]><a/>',
      systemId: 'urn:doc',
    };
    expect(doctype(xml).notations).toEqual([
      { name: 'p', publicId: 'p', baseURI: 'urn:doc' },
      { name: 's', systemId: 's', baseURI: 'urn:doc' },
      { name: 'b', publicId: 'p', systemId: 's', baseURI: 'urn:doc' },
    ]);
  });

  it('keeps the first declaration of a notation', () => {
    expect(doctype('<!DOCTYPE a [<!NOTATION n SYSTEM "1"><!NOTATION n SYSTEM "2">]><a/>').notations).toEqual([
      { name: 'n', systemId: '1' },
    ]);
  });

  it('rejects a notation name with a colon when namespace-aware', () => {
    expect(errorOf('<!DOCTYPE a [<!NOTATION a:b SYSTEM "s">]><a/>').code).toBe('NS_COLON');
  });
});

describe('parameter entities (§4.4.8, §2.8)', () => {
  it('expands a parameter entity between declarations in the internal subset', () => {
    const xml = '<!DOCTYPE a [<!ENTITY % d "<!ENTITY e \'from a parameter entity\'>"> %d;]><a>&e;</a>';
    expect(parseEveryWay(xml)).toBe('<a>from a parameter entity</a>');
  });

  it('rejects a parameter-entity reference inside a declaration in the internal subset (WFC: PEs in Internal Subset)', () => {
    expect(errorOf('<!DOCTYPE a [<!ENTITY % n "e"><!ENTITY %n; "x">]><a/>').code).toBe('WF_PE_IN_INTERNAL_SUBSET');
  });

  it('requires a parameter entity between declarations to hold whole declarations (WFC: PE Between Declarations)', () => {
    const xml = '<!DOCTYPE a [<!ENTITY % d "<!ENTITY e \'x\'"><!ENTITY % c ">"> %d;%c;]><a/>';
    expect(errorOf(xml).code).toBe('WF_PE_BETWEEN_DECLARATIONS');
  });

  it('rejects a parameter entity that refers to itself (WFC: No Recursion)', () => {
    expect(errorOf('<!DOCTYPE a [<!ENTITY % d "%d;"> %d;]><a/>').code).toBe('WF_PE_IN_INTERNAL_SUBSET');
    expect(errorOf("<!DOCTYPE a [<!ENTITY % d '&#37;d;'> %d;]><a/>").code).toBe('WF_RECURSIVE_ENTITY');
  });

  it('stops applying entity declarations after a parameter entity it does not read (§5.1)', () => {
    const xml = '<!DOCTYPE a [<!ENTITY % ext SYSTEM "ext.dtd"> %ext; <!ENTITY e "x">]><a>&e;</a>';
    const r = reader(xml);
    const events: number[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) events.push(e);
    expect(events).toEqual([EventType.DTD, EventType.START_ELEMENT, EventType.ENTITY_REFERENCE, EventType.END_ELEMENT]);
  });

  it('still applies them after an unread parameter entity in a standalone document', () => {
    const xml =
      '<?xml version="1.0" standalone="yes"?><!DOCTYPE a [<!ENTITY % ext SYSTEM "ext.dtd"> %ext; <!ENTITY e "x">]><a>&e;</a>';
    expect(parseEveryWay(xml)).toBe('<a>x</a>');
  });

  it('reports an undeclared parameter entity as a validity error', () => {
    expect(recoverable('<!DOCTYPE a [%p;]><a/>')).toEqual(['VC_ENTITY_DECLARED']);
  });

  it('rejects an undeclared parameter entity in a standalone document (WFC: Entity Declared)', () => {
    expect(errorOf('<?xml version="1.0" standalone="yes"?><!DOCTYPE a [%u;]><a/>')).toMatchObject({
      code: 'WF_UNDECLARED_ENTITY',
      column: 52,
    });
  });

  it('rejects conditional sections in the internal subset (§3.4)', () => {
    expect(errorOf('<!DOCTYPE a [<![INCLUDE[ ]]>]><a/>').code).toBe('WF_DOCTYPE');
    expect(errorOf('<!DOCTYPE a [<!ENTITY % c "<![INCLUDE[]]>"> %c;]><a/>')).toMatchObject({
      code: 'WF_CONDITIONAL_SECTION',
      entities: ['%c'],
    });
  });

  it('lists where each parameter entity starts and ends among what the DTD held', () => {
    const xml = '<!DOCTYPE a [<!ENTITY % d "<!--in-->"> %d;]><a/>';
    expect(
      items(xml).map((item) =>
        item.kind === 'startEntity' || item.kind === 'endEntity' ? `${item.kind} ${item.name}` : item.kind
      )
    ).toEqual(['entity', 'startEntity %d', 'comment', 'endEntity %d']);
  });
});

describe('the external subset (§2.8, §4.4.8)', () => {
  it('rejects markup the external subset ends in the middle of', () => {
    expect(external('<!ENTITY e "x"><!')).toBe('WF_DECLARATION urn:a.dtd:1:16');
  });

  it('reads it after the internal subset, which binds first', () => {
    expect(external('<!ENTITY e "external">')).toBe('<a>external</a>');
    const xml = '<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY e "internal">]><a>&e;</a>';
    expect(canonical(xml, served({ 'a.dtd': '<!ENTITY e "external">' }))).toBe('<a>internal</a>');
  });

  it('lists it as the entity [dtd] among what the DTD held', () => {
    const list = items('<!DOCTYPE a SYSTEM "a.dtd"><a/>', served({ 'a.dtd': '<!--x-->' }));
    expect(list.map((item) => item.kind)).toEqual(['startEntity', 'comment', 'endEntity']);
    expect(list[0]).toEqual({ kind: 'startEntity', name: '[dtd]' });
  });

  it('marks declarations read there as external, which standalone="yes" does not count', () => {
    const list = items(
      '<!DOCTYPE a SYSTEM "a.dtd"><a/>',
      served({ 'a.dtd': '<!ENTITY e "x"><!ATTLIST a d CDATA "1">' })
    );
    expect(
      list
        .filter((item) => item.kind === 'entity' || item.kind === 'attribute')
        .map((item) => 'declaration' in item && item.declaration.declaredExternally)
    ).toEqual([true, true]);
  });

  it('allows parameter-entity references inside declarations', () => {
    expect(external('<!ENTITY % m "(#PCDATA)"><!ENTITY % v \'"pe"\'><!ELEMENT a %m;><!ENTITY e %v;>')).toBe(
      '<a>pe</a>'
    );
  });

  it('expands parameter entities in entity values, external ones included (§4.4.5)', () => {
    const dtd = '<!ENTITY % p SYSTEM "p.ent"><!ENTITY % q "Q"><!ENTITY % r "[%q;]"><!ENTITY e "%p;%r;">';
    expect(external(dtd, { 'p.ent': 'from p' })).toBe('<a>from p[Q]</a>');
  });

  it('leaves out an external parameter entity in an entity value when it is not read', () => {
    expect(external('<!ENTITY % p SYSTEM "p.ent"><!ENTITY e "[%p;]">')).toBe('<a></a>');
  });

  it('expands a parameter entity used twice', () => {
    expect(external('<!ENTITY % p "<!ENTITY e \'1\'>">%p;%p;')).toBe('<a>1</a>');
  });

  it('reads conditional sections: INCLUDE applies its declarations, IGNORE skips nested sections (§3.4)', () => {
    expect(external('<![INCLUDE[<!ENTITY e "inc">]]>')).toBe('<a>inc</a>');
    expect(external('<![ IGNORE [<!ENTITY e "ign"> <![ junk <![ ]]> ]]> more ]]><!ENTITY e "after">')).toBe(
      '<a>after</a>'
    );
    expect(external('<![INCLUDE[<![INCLUDE[<!ENTITY e "nested">]]>]]>')).toBe('<a>nested</a>');
  });

  it('takes a section keyword from a parameter entity', () => {
    expect(external('<!ENTITY % d "INCLUDE"><![%d;[<!ENTITY e "pe-keyword">]]>')).toBe('<a>pe-keyword</a>');
    expect(external('<!ENTITY % d "IGNORE"><![%d;[<!ENTITY e "no">]]><!ENTITY e "yes">')).toBe('<a>yes</a>');
  });

  it('lets an INCLUDE section that starts in a parameter entity end outside it', () => {
    expect(external('<!ENTITY % start "<![INCLUDE[ <!ENTITY e \'pe\'>"> %start; ]]>')).toBe('<a>pe</a>');
  });

  it.each([
    ['<![INCLUDE[<!ENTITY e "x">', 'WF_CONDITIONAL_SECTION urn:a.dtd:1:27'],
    ['<![IGNORE[<!ENTITY e "x">', 'WF_CONDITIONAL_SECTION urn:a.dtd:1:11'],
    ['<![INCLUDE <!ENTITY e "x">]]>', 'WF_CONDITIONAL_SECTION urn:a.dtd:1:12'],
    ['<![FOO[<!ENTITY e "x">]]>', 'WF_CONDITIONAL_SECTION urn:a.dtd:1:4'],
    ['<!ENTITY e "abc>', 'WF_DECLARATION urn:a.dtd:1:12'],
    ['%p<!ENTITY e "x">', 'WF_DECLARATION urn:a.dtd:1:2'],
    ['<!ELEMENT a % m;>', 'WF_DECLARATION urn:a.dtd:1:13'],
    ['<!ENTITY e "%;">', 'WF_REFERENCE urn:a.dtd:1:12'],
    ['<!ENTITY % v "a%v;b"><!ENTITY e "%v;">', 'VC_ENTITY_DECLARED urn:a.dtd:1:14'],
    ["<!ENTITY % v '&#37;v;'><!ENTITY e '%v;'>", 'WF_RECURSIVE_ENTITY urn:a.dtd:1:35'],
    ['<!ENTITY % p "<!ENTITY e \'1\'"> %p;>', 'WF_PE_BETWEEN_DECLARATIONS urn:a.dtd:1:32 %p'],
    ['<!ELEMENT a ANY><!BAD>', 'WF_DECLARATION urn:a.dtd:1:17'],
    ['%p <!ENTITY e "x">', 'WF_REFERENCE urn:a.dtd:1:3'],
    ['<!--x', 'WF_COMMENT urn:a.dtd:1:1'],
    ['<!--x--', 'WF_COMMENT urn:a.dtd:1:1'],
    ['<!-- a --->', 'WF_COMMENT urn:a.dtd:1:8'],
    ['<?p x', 'WF_PI urn:a.dtd:1:4'],
  ])('rejects %s', (dtd, outcome) => {
    expect(external(dtd)).toBe(outcome);
  });

  it('records each parameter entity it does not read as skipped, where SAX reports it (§5.1)', () => {
    /** The names of the skipped entities among a document's DTD items. */
    const skipped = (xml: string, options: InputOptions = {}) =>
      items(xml, options).flatMap((item) => (item.kind === 'skippedEntity' ? [item.name] : []));
    expect(skipped('<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent"> %p;]><a/>')).toEqual(['%p']);
    const dtd = '<!ENTITY % u SYSTEM "u.ent"><!ENTITY e "[%u;]">';
    expect(skipped('<!DOCTYPE a SYSTEM "a.dtd"><a/>', served({ 'a.dtd': dtd }))).toEqual(['%u']);
  });

  it('reads an unread parameter entity inside a declaration as a space, applying what came before it and nothing after it (§5.1)', () => {
    const dtd = '<!ENTITY % m SYSTEM "m.ent"><!ATTLIST a x CDATA "1" %m;><!ATTLIST a y CDATA "2"><!ENTITY e "no">';
    expect(canonical('<!DOCTYPE a SYSTEM "a.dtd"><a/>', served({ 'a.dtd': dtd }))).toBe('<a x="1"></a>');
  });

  it('rejects a declaration or conditional section an unread parameter entity leaves incomplete, as Xerces and libxml2 do (§5.1)', () => {
    const unread = '<!ENTITY % m SYSTEM "m.ent">';
    expect(external(`${unread}<!ELEMENT a %m;>`)).toMatch(/^WF_DECLARATION /);
    expect(external(`${unread}<![%m;[<!ELEMENT a ANY>]]>`)).toMatch(/^WF_CONDITIONAL_SECTION /);
  });

  it('reports an undeclared parameter entity in an entity value, and applies no entity declaration after it (§5.1)', () => {
    const errors: string[] = [];
    expect(external('<!ENTITY e "[%u;]">', {}, { errorHandler: { error: (e) => errors.push(e.code) } })).toBe(
      '<a></a>'
    );
    expect(errors).toEqual(['VC_ENTITY_DECLARED']);
  });

  it('expands parameter and character references and keeps general ones in one entity value', () => {
    expect(external('<!ENTITY % p "P"><!ENTITY f "F"><!ENTITY e "%p;&#65;&f;%p;">')).toBe('<a>PAFP</a>');
  });

  it('keeps comments and PIs of an external subset as written, its line ends already normalized', () => {
    const list = items('<!DOCTYPE a SYSTEM "a.dtd"><a/>', served({ 'a.dtd': '<!--x\r\ny--><?p a\r\nb?>' }));
    expect(list.slice(1, 3)).toEqual([
      { kind: 'comment', text: 'x\ny' },
      { kind: 'pi', target: 'p', data: 'a\nb' },
    ]);
  });

  it('reads an external subset in an encoding no decoder supports as an error at the document start', () => {
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: {
        resolveEntity: () => ({
          systemId: 'urn:a.dtd',
          bytes: new TextEncoder().encode('<?xml encoding="x-unknown"?>'),
        }),
      },
    };
    expect(() => canonical('<!DOCTYPE a SYSTEM "a.dtd"><a/>', options)).toThrow(
      expect.objectContaining({ code: 'ENCODING_UNSUPPORTED', line: 1, column: 1 })
    );
  });

  it('locates an error in an external parameter entity in that entity, naming it', () => {
    expect(external('<!ENTITY % p SYSTEM "p.ent">\n%p;', { 'p.ent': '<!ENTITY e "x">\n<!BAD>' })).toBe(
      'WF_DECLARATION urn:p.ent:2:1 %p'
    );
  });

  it('fails at the reference when the resolver refuses a parameter entity with a ResolutionError', () => {
    const options: InputOptions = {
      accessExternalDTD: 'all',
      entityResolver: {
        resolveEntity: ({ name }) => {
          if (name === '%p') throw new ResolutionError('RESOLVER_FAILED', 'refused');
          return { systemId: 'urn:a.dtd', text: '<!ENTITY % p SYSTEM "p.ent">\n %p;' };
        },
      },
    };
    expect(() => canonical('<!DOCTYPE a SYSTEM "a.dtd"><a/>', options)).toThrow(
      expect.objectContaining({ code: 'RESOLVER_FAILED', systemId: 'urn:a.dtd', line: 2, column: 5 })
    );
  });

  it('checks an external subset’s text declaration and characters (§4.3.1, §2.2)', () => {
    expect(external('<?xml version="1.0"?><!ENTITY e "x">')).toMatch(/^WF_TEXT_DECLARATION urn:a.dtd/);
    expect(external('<?xml encoding="UTF-8"?><!ENTITY e "x">')).toBe('<a>x</a>');
    expect(external('<!ENTITY e "x\u0001">')).toBe('WF_INVALID_CHARACTER urn:a.dtd:1:14');
  });
});

describe('access to the external subset', () => {
  it('reads a DTD a resolver supplies whatever the access list says', () => {
    const options = served({ 'a.dtd': '<!ENTITY e "x">' }, { accessExternalDTD: [] });
    expect(canonical('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', options)).toBe('<a>x</a>');
  });

  it('reports a DTD a resolver refuses for the access list, and reads on without it', () => {
    const options: InputOptions = {
      entityResolver: {
        resolveEntity: () => {
          throw accessRefusedError('http://example.org/a.dtd');
        },
      },
    };
    expect(recoverable('<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', options)).toEqual(['ACCESS_REFUSED']);
  });
});

describe('locations', () => {
  it('computes none while a DTD reads without errors, as finding one scans its entity', () => {
    let located = 0;
    const locate = (index: number): Location => {
      located++;
      return { line: 1, column: index + 1, offset: index };
    };
    const modules: Record<string, string> = { 'm.ent': `<!ENTITY % b "%a; z CDATA 'q'"><!ELEMENT e (#PCDATA|f)*>` };
    const store = new DeclarationStore();
    const context: DtdContext = {
      store,
      known: new Map(),
      counter: new EntityCounter(DEFAULT_LIMITS),
      version11: false,
      namespaceAware: true,
      fail: (code, message) => {
        throw new Error(`${code}: ${message}`);
      },
      error: (code, message) => {
        throw new Error(`${code}: ${message}`);
      },
      readParameterEntity: ({ systemId = '' }) => {
        const text = modules[systemId];
        return text === undefined ? undefined : { text, systemId: `urn:${systemId}`, locate };
      },
    };
    // A reference between declarations, one inside a declaration, one in an entity value, and a default to expand.
    const text = `<!ENTITY % a "x CDATA 'd'"><!ENTITY g "G"><!ENTITY % m SYSTEM "m.ent">%m;<!ATTLIST e %b; y CDATA "v&g;">`;
    const frame: Frame = {
      text,
      pos: 0,
      end: text.length,
      entityName: undefined,
      isExternal: true,
      isDocumentText: false,
      betweenDeclarations: false,
      baseURI: undefined,
      isEntityExpansion: false,
      locate,
    };
    new DtdParser(store, context).parse(frame);
    expect([...(store.attributes.get('e')?.values() ?? [])].map((a) => [a.name, a.value])).toEqual([
      ['x', 'd'],
      ['z', 'q'],
      ['y', 'vG'],
    ]);
    expect(located).toBe(0);
  });
});
