import { reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType, type InputOptions, ResolutionError, type StreamReader, XMLInputFactory } from '@/index.ts';
import { LISTEN_ENTITIES, accessRefusedError } from '@/internal.ts';

/** Options that read external general entities from a map of system id to text or bytes. */
function external(files: Record<string, string | Uint8Array>): InputOptions {
  return {
    accessExternalEntities: 'all',
    entityResolver: {
      resolveEntity: ({ systemId = '' }) => {
        const content = files[systemId];
        if (content === undefined) return undefined;
        return typeof content === 'string'
          ? { systemId: `urn:${systemId}`, text: content }
          : { systemId: `urn:${systemId}`, bytes: content };
      },
    },
  };
}

/** Reads to the first event of a type. */
function at(xml: string, type: EventType, options: InputOptions = {}): StreamReader {
  const r = reader(xml, options);
  while (r.next() !== type);
  return r;
}

/** The events of a document, as type and name or text, after the DTD. */
function seen(xml: string, options: InputOptions = {}): string[] {
  const r = reader(xml, options);
  const out: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
    if (e === EventType.DTD) continue;
    const textual = e === EventType.CHARACTERS || e === EventType.SPACE;
    out.push(`${e} ${textual ? r.text() : r.name()}`);
  }
  return out;
}

const DECLARED = '<!DOCTYPE a [<!ENTITY t "text"><!ENTITY m "<b/>"><!ENTITY x SYSTEM "x.xml">]>';

describe('ENTITY_REFERENCE events (StAX IS_REPLACING_ENTITY_REFERENCES)', () => {
  it('give the entity name and its replacement text when expansion is off', () => {
    const r = at(`${DECLARED}<a>&t;</a>`, EventType.ENTITY_REFERENCE, { replaceEntityReferences: false });
    expect([r.name(), r.localName(), r.prefix(), r.text(), r.namespaceURI()]).toEqual(['t', 't', '', 'text', '']);
  });

  it('give an external entity an empty replacement text when expansion is off', () => {
    const r = at(`${DECLARED}<a>&x;</a>`, EventType.ENTITY_REFERENCE, {
      ...external({ 'x.xml': '<b/>' }),
      replaceEntityReferences: false,
    });
    expect([r.name(), r.text()]).toEqual(['x', '']);
  });

  it('report every reference, markup or not, when expansion is off', () => {
    expect(seen(`${DECLARED}<a>&t;&m;&amp;</a>`, { replaceEntityReferences: false })).toEqual([
      '1 a',
      '9 t',
      '9 m',
      '4 &',
      '2 a',
    ]);
  });

  it('report an external entity as skipped when supportExternalEntities is off', () => {
    const options = { ...external({ 'x.xml': '<b/>' }), supportExternalEntities: false };
    expect(seen(`${DECLARED}<a>&x;</a>`, options)).toEqual(['1 a', '9 x', '2 a']);
  });

  it('report an external entity as skipped when a resolver refuses it for the access list (§4.4.3)', () => {
    const codes: string[] = [];
    const options: InputOptions = {
      entityResolver: {
        resolveEntity: (request) => {
          throw accessRefusedError(`http://example.org/${request.systemId ?? ''}`);
        },
      },
      errorHandler: { error: (e) => void codes.push(e.code) },
    };
    expect(seen(`${DECLARED}<a>&x;</a>`, options)).toEqual(['1 a', '9 x', '2 a']);
    expect(codes).toEqual(['ACCESS_REFUSED']);
  });

  it('expand an external entity a resolver supplies whatever the access list says', () => {
    const options = { ...external({ 'x.xml': '<b/>' }), accessExternalEntities: [] };
    expect(seen(`${DECLARED}<a>&x;</a>`, options)).toEqual(['1 a', '1 b', '2 b', '2 a']);
  });

  it('report an external entity as skipped when no resolver supplies it', () => {
    expect(seen(`${DECLARED}<a>&x;</a>`, external({}))).toEqual(['1 a', '9 x', '2 a']);
  });

  it('give a skipped entity the location of its reference', () => {
    expect(at(`${DECLARED}\n<a>\n &x;</a>`, EventType.ENTITY_REFERENCE).location()).toMatchObject({
      line: 3,
      column: 2,
    });
  });
});

describe('expanding entities in content (§4.4.2)', () => {
  it('reports a text-only entity as one CHARACTERS event', () => {
    expect(seen(`${DECLARED}<a>x&t;y</a>`)).toEqual(['1 a', '4 x', '4 text', '4 y', '2 a']);
  });

  it('reports nothing for an empty entity', () => {
    expect(seen('<!DOCTYPE a [<!ENTITY n "">]><a>&n;</a>')).toEqual(['1 a', '2 a']);
  });

  it('reports an entity holding markup as the events of its replacement text', () => {
    expect(seen(`${DECLARED}<a>&m;&m;</a>`)).toEqual(['1 a', '1 b', '2 b', '1 b', '2 b', '2 a']);
  });

  it('reads an external parsed entity a resolver supplies, after its text declaration (§4.3.2)', () => {
    const options = external({ 'x.xml': '<?xml version="1.0" encoding="UTF-8"?>text\r\n<b/>' });
    expect(seen(`${DECLARED}<a>&x;</a>`, options)).toEqual(['1 a', '4 text\n', '1 b', '2 b', '2 a']);
  });

  it('reads an external entity referred to from an internal one', () => {
    const xml = '<!DOCTYPE a [<!ENTITY i "[&x;]"><!ENTITY x SYSTEM "x.xml">]><a>&i;</a>';
    expect(seen(xml, external({ 'x.xml': '<b/>' }))).toEqual(['1 a', '4 [', '1 b', '2 b', '4 ]', '2 a']);
  });

  it('rejects an external entity that holds a character XML 1.0 does not allow (§2.2)', () => {
    expect(() => seen(`${DECLARED}<a>&x;</a>`, external({ 'x.xml': 'a\u0001b' }))).toThrow(
      expect.objectContaining({ code: 'WF_INVALID_CHARACTER', systemId: 'urn:x.xml', entities: ['x'] })
    );
  });

  it('rejects an XML 1.1 external entity in an XML 1.0 document (§4.3.4)', () => {
    const options = external({ 'x.xml': '<?xml version="1.1" encoding="UTF-8"?><b/>' });
    expect(() => seen(`${DECLARED}<a>&x;</a>`, options)).toThrow(
      expect.objectContaining({ code: 'WF_ENTITY_VERSION', systemId: 'urn:x.xml', line: 1, column: 1 })
    );
  });

  it('rejects an external entity whose text declaration contradicts its byte-order mark (§4.3.3)', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<?xml encoding="ISO-8859-1"?><b/>')]);
    expect(() => seen(`${DECLARED}<a>&x;</a>`, external({ 'x.xml': bytes }))).toThrow(
      expect.objectContaining({ code: 'ENCODING_MISMATCH', systemId: 'urn:x.xml' })
    );
  });

  it('fails at the reference when the resolver throws a ResolutionError', () => {
    const options: InputOptions = {
      accessExternalEntities: 'all',
      entityResolver: {
        resolveEntity: () => {
          throw new ResolutionError('RESOLVER_FAILED', 'refused');
        },
      },
    };
    expect(() => seen(`${DECLARED}\n<a> &x;</a>`, options)).toThrow(
      expect.objectContaining({ code: 'RESOLVER_FAILED', line: 2, column: 5 })
    );
  });

  it('rejects a reference outside the root element (§2.1, §3)', () => {
    expect(() => seen(`${DECLARED}<a/>&t;`)).toThrow(expect.objectContaining({ code: 'WF_CONTENT_OUTSIDE_ROOT' }));
  });

  it('rejects an entity name with a colon when namespace-aware (Namespaces §7)', () => {
    const xml = '<!DOCTYPE a [<!ENTITY a:b "x">]><a>&a:b;</a>';
    expect(() => seen(xml, { namespaceAware: false })).not.toThrow();
    expect(() => seen('<a>&a:b;</a>')).toThrow(expect.objectContaining({ code: 'NS_COLON', column: 5 }));
  });
});

describe('entity boundaries (reportEntityBoundaries, SAX LexicalHandler)', () => {
  it('give name() the entity name at START_ENTITY and END_ENTITY', () => {
    const r = reader(`${DECLARED}<a>&m;</a>`, { reportEntityBoundaries: true });
    const out: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.START_ENTITY || e === EventType.END_ENTITY) out.push(`${e} ${r.name()} ${r.localName()}`);
    }
    expect(out).toEqual(['258 m m', '259 m m']);
  });

  it('report a skipped entity without boundaries', () => {
    expect(seen(`${DECLARED}<a>&x;</a>`, { reportEntityBoundaries: true })).toEqual(['1 a', '9 x', '2 a']);
  });
});

describe('the entity listener hook', () => {
  it('hears where each expansion starts and ends, and how an external entity was read', () => {
    const options = external({ 'x.xml': '<?xml version="1.0" encoding="UTF-8"?><b/>' });
    const xml = `${DECLARED}<a>&x;&t;&m;<?p?>&amp;</a>`;
    const r = new XMLInputFactory(options).createStreamReader(xml);
    const heard: string[] = [];
    r[LISTEN_ENTITIES]({
      startEntity: (name) => heard.push(`start ${name}`),
      endEntity: (name) => heard.push(`end ${name}`),
      readExternal: (name, input, declared, version) => heard.push(`read ${name} ${input} ${declared} ${version}`),
    });
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) heard.push(String(e));
    expect(heard).toEqual([
      '11',
      '1',
      'start x',
      'read x undefined UTF-8 1.0',
      '1',
      '2',
      'end x',
      'start t',
      '4',
      'end t',
      'start m',
      '1',
      '2',
      'end m',
      '3',
      '4',
      '2',
    ]);
  });

  it('works without readExternal, and reports the detected encoding of bytes', () => {
    const bytes = new TextEncoder().encode('<b/>');
    const heard: string[] = [];
    const plain = new XMLInputFactory(external({ 'x.xml': bytes })).createStreamReader(`${DECLARED}<a>&x;</a>`);
    plain[LISTEN_ENTITIES]({ startEntity: (n) => heard.push(n), endEntity: (n) => heard.push(n) });
    while (plain.next() !== EventType.END_DOCUMENT);
    expect(heard).toEqual(['x', 'x']);
    const encodings: unknown[] = [];
    const detailed = new XMLInputFactory(external({ 'x.xml': bytes })).createStreamReader(`${DECLARED}<a>&x;</a>`);
    detailed[LISTEN_ENTITIES]({
      startEntity: () => undefined,
      endEntity: () => undefined,
      readExternal: (...args) => encodings.push(args),
    });
    while (detailed.next() !== EventType.END_DOCUMENT);
    expect(encodings).toEqual([['x', 'utf-8', undefined, undefined]]);
  });
});
