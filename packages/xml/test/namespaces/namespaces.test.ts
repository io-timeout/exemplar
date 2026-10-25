import { errorOf, parseEveryWay, reader } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';
import { EventType } from '@/index.ts';
import { NamespaceBindings } from '@/namespaces/namespaces.ts';
import { XMLNS_NAMESPACE, XML_NAMESPACE } from '@/util/namespaces.ts';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** Each start and end tag's name and namespace. */
function scopes(xml: string): string {
  const r = reader(xml);
  const seen: string[] = [];
  for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
    if (e === EventType.START_ELEMENT) seen.push(`<${r.name()}={${r.namespaceURI()}}`);
    if (e === EventType.END_ELEMENT) seen.push(`/${r.name()}={${r.namespaceURI()}}`);
  }
  return seen.join(' ');
}

describe('NamespaceBindings', () => {
  // A buffer at document offset 100, holding a prefix and a URI at known places.
  const text = 'xmlns:pre="urn:one" xmlns="urn:two"';
  const base = 100;

  it('starts with xml bound to its namespace and the empty prefix to no namespace', () => {
    const bindings = new NamespaceBindings();
    expect([bindings.count, bindings.defaultIndex]).toEqual([2, 1]);
    expect([bindings.prefix(0, '', 0), bindings.uri(0, '', 0)]).toEqual(['xml', XML_NAMESPACE]);
    expect([bindings.prefix(1, '', 0), bindings.uri(1, '', 0)]).toEqual(['', '']);
    expect([bindings.isEmpty(0), bindings.isEmpty(1)]).toEqual([false, true]);
    expect([XML_NAMESPACE, XMLNS_NAMESPACE]).toEqual([XML, XMLNS]);
  });

  it('finds xml always, the empty prefix as the default, and nothing for an unbound prefix', () => {
    const bindings = new NamespaceBindings();
    expect(bindings.findBinding('<xml:a', 0, 1, 4)).toBe(0);
    expect(bindings.findBinding('<a', 0, 1, 1)).toBe(1);
    expect(bindings.findBinding('<p:a', 0, 1, 2)).toBe(-1);
    expect(bindings.findBinding('<xmlns:a', 0, 1, 6)).toBe(-1);
    expect([
      bindings.findBindingOf('xml', '', 0),
      bindings.findBindingOf('', '', 0),
      bindings.findBindingOf('p', '', 0),
    ]).toEqual([0, 1, -1]);
  });

  it('binds a prefix and URI from document offsets, slicing each once', () => {
    const bindings = new NamespaceBindings();
    const k = bindings.bind(base + 6, base + 9, base + 11, base + 18, undefined);
    expect(k).toBe(2);
    expect(bindings.count).toBe(3);
    expect(bindings.findBinding(`<pre:x ${text}`, base - 7, 1, 4)).toBe(k);
    expect(bindings.findBinding('<pr:x', 0, 1, 3)).toBe(-1);
    expect(bindings.findBindingOf('pre', text, base)).toBe(k);
    expect([bindings.prefix(k, text, base), bindings.uri(k, text, base)]).toEqual(['pre', 'urn:one']);
    expect([bindings.prefix(k, 'other', 0), bindings.uri(k, 'other', 0)]).toEqual(['pre', 'urn:one']);
    expect(bindings.isEmpty(k)).toBe(false);
  });

  it('binds the empty prefix from an empty span, as the default namespace', () => {
    const bindings = new NamespaceBindings();
    const k = bindings.bind(base + 25, base + 25, base + 27, base + 34, undefined);
    expect(bindings.findBinding('<a', 0, 1, 1)).toBe(k);
    expect(bindings.findBindingOf('', text, base)).toBe(k);
    expect([bindings.prefix(k, text, base), bindings.uri(k, text, base)]).toEqual(['', 'urn:two']);
  });

  it('keeps a URI that had to be normalized, and tells an empty one', () => {
    const bindings = new NamespaceBindings();
    const k = bindings.bind(base + 6, base + 9, base + 11, base + 18, 'urn:normalized');
    expect(bindings.uri(k, text, base)).toBe('urn:normalized');
    const empty = bindings.bind(base + 6, base + 9, base + 11, base + 11, undefined);
    expect(bindings.isEmpty(empty)).toBe(true);
    expect(bindings.isEmpty(bindings.bind(0, 1, 0, 5, ''))).toBe(true);
  });

  it('binds strings, as a declaration defaulted from the DTD is', () => {
    const bindings = new NamespaceBindings();
    const k = bindings.bindStrings('p', 'urn:p');
    expect(bindings.findBinding('<p:a', 0, 1, 2)).toBe(k);
    expect(bindings.findBindingOf('p', '', 0)).toBe(k);
    expect([bindings.prefix(k, '', 0), bindings.uri(k, '', 0)]).toEqual(['p', 'urn:p']);
    expect(bindings.isEmpty(bindings.bindStrings('q', ''))).toBe(true);
  });

  it('finds the innermost binding of a prefix, and drops bindings when the count is restored', () => {
    const bindings = new NamespaceBindings();
    const outer = bindings.bindStrings('p', 'urn:outer');
    const scope = bindings.count;
    const inner = bindings.bindStrings('p', 'urn:inner');
    bindings.bindStrings('q', 'urn:q');
    expect(bindings.findBinding('p:', 0, 0, 1)).toBe(inner);
    expect(bindings.findBindingOf('p', '', 0)).toBe(inner);
    bindings.count = scope;
    expect(bindings.findBinding('p:', 0, 0, 1)).toBe(outer);
    expect(bindings.findBindingOf('q', '', 0)).toBe(-1);
  });

  it('slices what the buffer is about to drop, and only that', () => {
    const bindings = new NamespaceBindings();
    const early = bindings.bind(base + 6, base + 9, base + 11, base + 18, undefined);
    const late = bindings.bind(base + 25, base + 25, base + 27, base + 34, undefined);
    bindings.sliceBeforeDrop(text, base, base + 20);
    const moved = `xx${text.slice(20)}`;
    expect([bindings.prefix(early, moved, base + 18), bindings.uri(early, moved, base + 18)]).toEqual([
      'pre',
      'urn:one',
    ]);
    expect(bindings.uri(late, moved, base + 18)).toBe('urn:two');
  });
});

/** Reads to the first start tag. */
function start(xml: string, options = {}) {
  const r = reader(xml, options);
  while (r.next() !== EventType.START_ELEMENT);
  return r;
}

describe('QNames (Namespaces §4)', () => {
  it('rejects names with more than one colon, or a colon at either end', () => {
    expect(errorOf('<a:b:c xmlns:a="u"/>').code).toBe('NS_QNAME');
    expect(errorOf('<:a/>').code).toBe('NS_QNAME');
    expect(errorOf('<a: xmlns:a="u"/>').code).toBe('NS_QNAME');
    expect(errorOf('<a b:="1"/>').code).toBe('NS_QNAME');
  });

  it('rejects a local part that does not start a name', () => {
    expect(errorOf('<a:1 xmlns:a="u"/>').code).toBe('NS_QNAME');
  });

  it('rejects colons in PI targets and entity names', () => {
    expect(errorOf('<a><?a:b x?></a>').code).toBe('NS_COLON');
    expect(errorOf('<!DOCTYPE a SYSTEM "a.dtd"><a>&a:b;</a>').code).toBe('NS_COLON');
  });

  it('allows any names when namespaceAware is off', () => {
    expect(parseEveryWay('<a:b:c d:="1"/>', { namespaceAware: false })).toBe('<a:b:c d:="1"></a:b:c>');
  });

  it.each([
    ['an element name that is only a prefix', '<_a><:b></:b></_a>'],
    ['an attribute name of colons', '<r a:::="A"/>'],
    ['an attribute name that starts with a colon', '<r :b="B"/>'],
    ['an attribute name with two colons', '<r a:b:c="B"/>'],
    ['a declaration of an empty prefix', '<f xmlns:="M"/>'],
  ])('rejects %s, which is a well-formed name but not a QName', (_, xml) => {
    expect(errorOf(xml).code).toBe('NS_QNAME');
    expect(() => parseEveryWay(xml, { namespaceAware: false })).not.toThrow();
  });

  it('accepts a prefix made of any NCName characters', () => {
    expect(parseEveryWay('<r xmlns:color_1-.0="u" color_1-.0:a="1"/>')).toBe('<r color_1-.0:a="1"></r>');
  });

  it('rejects colons in entity, parameter entity and notation names declared in the DTD', () => {
    expect(errorOf('<!DOCTYPE a [<!ENTITY a:b "x">]><a/>').code).toBe('NS_COLON');
    expect(errorOf('<!DOCTYPE a [<!ENTITY % a:b "x">]><a/>').code).toBe('NS_COLON');
    expect(errorOf('<!DOCTYPE a [<!NOTATION n:m SYSTEM "x">]><a/>').code).toBe('NS_COLON');
    expect(errorOf('<!DOCTYPE a [<?a:b x?>]><a/>').code).toBe('NS_COLON');
    expect(parseEveryWay('<!DOCTYPE a [<!ENTITY a:b "x">]><a>&a:b;</a>', { namespaceAware: false })).toBe('<a>x</a>');
  });
});

describe('declarations (Namespaces §3)', () => {
  it('rejects an unbound prefix (NSC: Prefix Declared)', () => {
    expect(errorOf('<p:a/>')).toMatchObject({ code: 'NS_UNBOUND_PREFIX', column: 2 });
    expect(errorOf('<a p:b="1"/>').code).toBe('NS_UNBOUND_PREFIX');
  });

  it('rejects declaring the xmlns prefix or binding the xmlns namespace (NSC: Reserved Prefixes)', () => {
    expect(errorOf('<a xmlns:xmlns="u"/>').code).toBe('NS_RESERVED');
    expect(errorOf(`<a xmlns:xmlns="${XMLNS}"/>`).code).toBe('NS_RESERVED');
    expect(errorOf(`<a xmlns:p="${XMLNS}"/>`).code).toBe('NS_RESERVED');
    expect(errorOf(`<a xmlns="${XMLNS}"/>`).code).toBe('NS_RESERVED');
  });

  it('allows xml to be bound only to its namespace, and nothing else to that namespace', () => {
    expect(parseEveryWay(`<a xmlns:xml="${XML}"/>`)).toBe('<a></a>');
    expect(errorOf('<a xmlns:xml="u"/>').code).toBe('NS_RESERVED');
    expect(errorOf('<a xmlns:xml=""/>').code).toBe('NS_RESERVED');
    expect(errorOf(`<a xmlns:xml="${XML}/"/>`).code).toBe('NS_RESERVED');
    expect(errorOf(`<a xmlns:p="${XML}"/>`).code).toBe('NS_RESERVED');
    expect(errorOf(`<a xmlns="${XML}"/>`).code).toBe('NS_RESERVED');
  });

  it('rejects an element with the prefix xmlns', () => {
    expect(errorOf('<xmlns:a/>').code).toBe('NS_RESERVED');
  });

  it('rejects undeclaring a prefix in Namespaces 1.0, and allows it in 1.1', () => {
    expect(errorOf('<a xmlns:p="u"><b xmlns:p=""/></a>').code).toBe('NS_UNDECLARED_PREFIX');
    expect(parseEveryWay('<?xml version="1.1"?><a xmlns:p="u"><b xmlns:p=""/></a>')).toBe('<a><b></b></a>');
    expect(errorOf('<?xml version="1.1"?><a xmlns:p="u"><b xmlns:p=""><p:c/></b></a>').code).toBe('NS_UNBOUND_PREFIX');
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'never finds the prefix %s through a prototype',
    (prefix) => {
      expect(errorOf(`<foo xmlns="X"><${prefix}:u/></foo>`).code).toBe('NS_UNBOUND_PREFIX');
      expect(errorOf(`<f:f xmlns:f="F" ${prefix}:b="1"/>`).code).toBe('NS_UNBOUND_PREFIX');
    }
  );

  it('binds the declarations of a start tag before resolving its names, wherever they are', () => {
    expect(scopes('<o:c b="B" xmlns:o="O"/>')).toBe('<o:c={O} /o:c={O}');
    const r = reader('<p a:attr="v" xmlns:a="http://A"/>');
    r.next();
    expect(r.attributeNamespace(0)).toBe('http://A');
  });

  it('ends a binding with the element that declares it', () => {
    expect(scopes('<r xmlns:a="A"><a:x xmlns:a="R"><a:y/></a:x><a:z/><a:y/></r>')).toBe(
      '<r={} <a:x={R} <a:y={R} /a:y={R} /a:x={R} <a:z={A} /a:z={A} <a:y={A} /a:y={A} /r={}'
    );
    expect(scopes('<root xmlns:p="urn:outer"><p:item xmlns:p="urn:inner"/><p:item/></root>')).toBe(
      '<root={} <p:item={urn:inner} /p:item={urn:inner} <p:item={urn:outer} /p:item={urn:outer} /root={}'
    );
    expect(scopes('<root><n xmlns="u:d"><plain/></n><plain/></root>')).toBe(
      '<root={} <n={u:d} <plain={u:d} /plain={u:d} /n={u:d} <plain={} /plain={} /root={}'
    );
    expect(errorOf('<r xmlns:a="A"><a:x xmlns:b="U"/><b:y/></r>').code).toBe('NS_UNBOUND_PREFIX');
  });

  it('leaves unprefixed attributes in no namespace, even under a default namespace (§6.2)', () => {
    const r = reader('<elm xmlns="http://foo" attr="bar"/>');
    r.next();
    expect([r.namespaceURI(), r.attributeNamespace(0)]).toEqual(['http://foo', '']);
  });

  it('needs no declaration for the xml prefix, and accepts other names that start with xml', () => {
    expect(parseEveryWay('<xml:root xml:lang="en" xml:space="preserve"/>')).toBe(
      '<xml:root xml:lang="en" xml:space="preserve"></xml:root>'
    );
    expect(scopes('<xml:root/>')).toBe(`<xml:root={${XML}} /xml:root={${XML}}`);
    expect(parseEveryWay('<xmlfoo:a xmlns:xmlfoo="u" xmlns:xmlx="v" xmlx:b="1"/>')).toBe(
      '<xmlfoo:a xmlx:b="1"></xmlfoo:a>'
    );
    expect(parseEveryWay('<xmlns/>')).toBe('<xmlns></xmlns>');
  });

  it('binds the normalized value of the declaration, references and entities expanded', () => {
    expect(scopes('<a xmlns:p="a&amp;b"><p:x/></a>')).toBe('<a={} <p:x={a&b} /p:x={a&b} /a={}');
    expect(scopes('<!DOCTYPE a [<!ENTITY e "urn:e">]><a xmlns="&e;"/>')).toBe('<a={urn:e} /a={urn:e}');
  });

  it('does not resolve prefixes in attribute values', () => {
    expect(parseEveryWay('<r xmlns:xsi="x" xsi:type="bar:Bar"/>')).toBe('<r xsi:type="bar:Bar"></r>');
  });

  it('applies declarations defaulted from the DTD, and checks them as written ones', () => {
    expect(scopes('<!DOCTYPE a [<!ATTLIST a xmlns:p CDATA "urn:p">]><a><p:b/></a>')).toBe(
      '<a={} <p:b={urn:p} /p:b={urn:p} /a={}'
    );
    expect(scopes('<!DOCTYPE a [<!ATTLIST a xmlns CDATA "urn:d">]><a><b/></a>')).toBe(
      '<a={urn:d} <b={urn:d} /b={urn:d} /a={urn:d}'
    );
    expect(errorOf('<!DOCTYPE a [<!ATTLIST a xmlns:p CDATA "">]><a/>').code).toBe('NS_UNDECLARED_PREFIX');
    expect(errorOf('<!DOCTYPE a [<!ATTLIST a xmlns:xml CDATA "urn:bad">]><a/>').code).toBe('NS_RESERVED');
  });

  it('resolves the prefix of an attribute defaulted from the DTD in the element’s scope', () => {
    const r = reader('<!DOCTYPE a [<!ATTLIST b q:x CDATA "1">]><a xmlns:q="urn:q"><b/></a>');
    while (r.next() !== EventType.START_ELEMENT || r.name() !== 'b');
    expect([r.attributeName(0), r.attributeNamespace(0)]).toEqual(['q:x', 'urn:q']);
    expect(errorOf('<!DOCTYPE a [<!ATTLIST b q:x CDATA "1">]><a><b/></a>').code).toBe('NS_UNBOUND_PREFIX');
  });

  it('lets the default namespace be undeclared', () => {
    const r = reader('<a xmlns="u"><b xmlns=""/></a>');
    r.next();
    expect(r.namespaceURI()).toBe('u');
    r.next();
    expect(r.namespaceURI()).toBe('');
  });

  it('rejects two attributes with the same expanded name (NSC: Attributes Unique)', () => {
    expect(errorOf('<a xmlns:p="u" xmlns:q="u" p:x="1" q:x="2"/>').code).toBe('NS_DUPLICATE_ATTRIBUTE');
    expect(parseEveryWay('<a xmlns:p="u" xmlns="u" p:x="1" x="2"/>')).toBe('<a p:x="1" x="2"></a>');
    expect(parseEveryWay('<a xmlns:a="A" xmlns:b="B" a:x="1" b:x="2"/>')).toBe('<a a:x="1" b:x="2"></a>');
    expect(parseEveryWay('<a xmlns:p="u" xmlns:q="u" p:x="1" q:y="2"/>')).toBe('<a p:x="1" q:y="2"></a>');
  });

  it('keeps attributes with the same expanded name apart when namespaceAware is off', () => {
    expect(parseEveryWay('<a xmlns:p="u" xmlns:q="u" p:x="1" q:x="2"/>', { namespaceAware: false })).toBe(
      '<a p:x="1" q:x="2" xmlns:p="u" xmlns:q="u"></a>'
    );
  });

  it('compares namespace names after normalization', () => {
    expect(errorOf('<a xmlns:p="u&#x76;" xmlns:q="uv" p:x="1" q:x="2"/>').code).toBe('NS_DUPLICATE_ATTRIBUTE');
  });

  it('finds expanded-name duplicates among many attributes', () => {
    const attributes = Array.from({ length: 20 }, (_, i) => ` a${i}="${i}"`).join('');
    expect(errorOf(`<e xmlns:p="u" xmlns:q="u"${attributes} p:x="1" q:x="2"/>`).code).toBe('NS_DUPLICATE_ATTRIBUTE');
  });
});

describe('the namespace accessors', () => {
  it('gives prefixes, local names and URIs of elements and attributes', () => {
    const r = start('<p:a xmlns:p="u" xmlns="d" p:x="1" y="2" xml:lang="en"/>');
    expect([r.name(), r.prefix(), r.localName(), r.namespaceURI()]).toEqual(['p:a', 'p', 'a', 'u']);
    expect(r.attributeCount()).toBe(3);
    const attributes = Array.from({ length: 3 }, (_, i) => [
      r.attributeName(i),
      r.attributePrefix(i),
      r.attributeLocalName(i),
      r.attributeNamespace(i),
    ]);
    expect(attributes).toEqual([
      ['p:x', 'p', 'x', 'u'],
      ['y', '', 'y', ''],
      ['xml:lang', 'xml', 'lang', XML],
    ]);
    expect(r.attributeValue('u', 'x')).toBe('1');
    expect(r.attributeValue('', 'y')).toBe('2');
    expect(r.attributeValue('d', 'y')).toBeUndefined();
  });

  it('lists the namespace declarations of a start and end tag', () => {
    const r = start('<a xmlns="d" xmlns:p="u"><b/></a>');
    const declarations = () =>
      Array.from({ length: r.namespaceCount() }, (_, i) => [r.namespacePrefix(i), r.namespaceURI(i)]);
    expect(declarations()).toEqual([
      ['', 'd'],
      ['p', 'u'],
    ]);
    r.next();
    expect(r.namespaceCount()).toBe(0);
    r.next();
    r.next();
    expect(r.eventType()).toBe(EventType.END_ELEMENT);
    expect(declarations()).toEqual([
      ['', 'd'],
      ['p', 'u'],
    ]);
  });

  it('reports xmlns attributes only when namespacePrefixes is on', () => {
    expect(start('<a xmlns:p="u" b="1"/>').attributeCount()).toBe(1);
    const r = start('<a xmlns:p="u" b="1"/>', { namespacePrefixes: true });
    expect(r.attributeCount()).toBe(2);
    expect([r.attributeName(0), r.attributeNamespace(0), r.attributeLocalName(0)]).toEqual(['xmlns:p', XMLNS, 'p']);
  });

  it('gives no prefixes or URIs when namespaceAware is off', () => {
    const r = start('<p:a xmlns:p="u" p:b="1"/>', { namespaceAware: false });
    expect([r.prefix(), r.localName(), r.namespaceURI(), r.namespaceCount()]).toEqual(['', 'p:a', '', 0]);
    expect(r.attributeCount()).toBe(2);
    expect([r.attributeLocalName(1), r.attributeNamespace(1)]).toEqual(['p:b', '']);
  });

  it('keeps bindings right across a buffer compaction', () => {
    const filler = `<f>${'x'.repeat(100)}</f>`.repeat(40);
    const xml = `<p:a xmlns:p="urn:a">${filler}<p:b xmlns:p="urn:b">${filler}<p:c/></p:b>${filler}<p:d/></p:a>`;
    const bytes = new TextEncoder().encode(xml);
    const chunks = (function* () {
      for (let i = 0; i < bytes.length; i += 97) yield bytes.subarray(i, i + 97);
    })();
    const r = reader(chunks);
    const uris: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.START_ELEMENT && r.prefix() === 'p') uris.push(`${r.localName()}=${r.namespaceURI()}`);
    }
    expect(uris).toEqual(['a=urn:a', 'b=urn:b', 'c=urn:b', 'd=urn:a']);
  });

  it('gives bare and declaring elements their scope at both their start and their end', () => {
    const xml =
      '<?xml version="1.1"?><a xmlns="urn:a"><b/><c xmlns="urn:c" xmlns:p="urn:p"><d/><p:e/>' +
      '<f xmlns:p=""/></c><g/><h xmlns=""><i/></h><j/></a>';
    const r = reader(xml);
    const seen: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e === EventType.START_ELEMENT) seen.push(`<${r.name()}=${r.namespaceURI()} ${r.namespaceCount()}`);
      if (e === EventType.END_ELEMENT) seen.push(`/${r.name()}=${r.namespaceURI()} ${r.namespaceCount()}`);
    }
    expect(seen.join(' ')).toBe(
      '<a=urn:a 1 <b=urn:a 0 /b=urn:a 0 <c=urn:c 2 <d=urn:c 0 /d=urn:c 0 <p:e=urn:p 0 /p:e=urn:p 0 ' +
        '<f=urn:c 1 /f=urn:c 1 /c=urn:c 2 <g=urn:a 0 /g=urn:a 0 <h= 1 <i= 0 /i= 0 /h= 1 <j=urn:a 0 /j=urn:a 0 /a=urn:a 1'
    );
    expect(errorOf('<a xmlns:p="u"/><b/>').code).toBe('WF_SECOND_ROOT');
  });
});

describe('start tags that repeat the attributes of the one before', () => {
  /** Each start tag's namespace, and its attributes' namespaces and values. */
  function names(xml: string): string[] {
    const r = reader(xml);
    const out: string[] = [];
    for (let e = r.next(); e !== EventType.END_DOCUMENT; e = r.next()) {
      if (e !== EventType.START_ELEMENT) continue;
      const attributes = Array.from({ length: r.attributeCount() }, (_, i) => {
        return `{${r.attributeNamespace(i) ?? ''}}${r.attributeLocalName(i)}=${r.attributeValue(i)}`;
      });
      out.push(`{${r.namespaceURI() ?? ''}}${r.localName()} ${r.namespaceCount()} ${attributes.join(' ')}`);
    }
    return out;
  }

  it('binds and resolves the repeated attributes in each element’s own scope', () => {
    const declarations = ' xmlns:p="u" xmlns="d" p:x="1"';
    expect(names(`<r><a${declarations}/><b${declarations}><c${declarations}/></b></r>`)).toEqual([
      '{}r 0 ',
      '{d}a 2 {u}x=1',
      '{d}b 2 {u}x=1',
      '{d}c 2 {u}x=1',
    ]);
    expect(names('<r xmlns:p="u"><a p:x="1"/><s xmlns:p="v"><a p:x="1"/></s></r>').at(-1)).toBe('{}a 0 {v}x=1');
  });

  it('still rejects what the repeated attributes do wrong in a new scope', () => {
    expect(errorOf('<r><s xmlns:p="u"><a p:x="1"/></s><a p:x="1"/></r>').code).toBe('NS_UNBOUND_PREFIX');
    expect(errorOf('<r xmlns:p="u" xmlns:q="u"><a p:x="1" q:x="2"/><a p:x="1" q:x="2"/></r>').code).toBe(
      'NS_DUPLICATE_ATTRIBUTE'
    );
  });

  it('reads them the same way however the input arrives', () => {
    const tag = '<e xmlns:its="http://www.w3.org/2005/11/its" xmlns:xlink="http://www.w3.org/1999/xlink" a="1">';
    const element = `${tag}t</e>`;
    const xml = `<r>${element.repeat(20)}<e a="1"/>${tag}</e></r>`;
    expect(parseEveryWay(xml)).toBe(`<r>${'<e a="1">t</e>'.repeat(20)}<e a="1"></e><e a="1"></e></r>`);
  });

  it('reuses the attributes a tag starts with when it adds or leaves out others', () => {
    const shared = 'xmlns:p="urn:a-long-namespace" p:x="1"';
    const xml = `<r><e ${shared}/><e ${shared} y="2"/><e ${shared}\n p:z="3"></e><e ${shared}/><e xmlns:p="urn:a-long-namespace"/></r>`;
    expect(names(xml).slice(1)).toEqual([
      '{}e 1 {urn:a-long-namespace}x=1',
      '{}e 1 {urn:a-long-namespace}x=1 {}y=2',
      '{}e 1 {urn:a-long-namespace}x=1 {urn:a-long-namespace}z=3',
      '{}e 1 {urn:a-long-namespace}x=1',
      '{}e 1 ',
    ]);
    expect(parseEveryWay(xml)).toBe(
      '<r><e p:x="1"></e><e p:x="1" y="2"></e><e p:x="1" p:z="3"></e><e p:x="1"></e><e></e></r>'
    );
    expect(errorOf(`<r><e ${shared}/><e ${shared}y="2"/></r>`).code).toBe('WF_TAG');
    expect(errorOf(`<r><e ${shared}/><e ${shared} p:x="2"/></r>`).code).toBe('WF_DUPLICATE_ATTRIBUTE');
  });

  it('declares repeated namespaces again for siblings and children, however the input arrives', () => {
    const a = '<a xmlns="urn:d" xmlns:p="urn:p" p:x="1"';
    const xml = `<r>${a}>${a}><b/></a></a>${a}/><c/>${a}/></r>`;
    expect(names(xml)).toEqual([
      '{}r 0 ',
      '{urn:d}a 2 {urn:p}x=1',
      '{urn:d}a 2 {urn:p}x=1',
      '{urn:d}b 0 ',
      '{urn:d}a 2 {urn:p}x=1',
      '{}c 0 ',
      '{urn:d}a 2 {urn:p}x=1',
    ]);
    expect(parseEveryWay(xml)).toBe(
      '<r><a p:x="1"><a p:x="1"><b></b></a></a><a p:x="1"></a><c></c><a p:x="1"></a></r>'
    );
  });

  it('applies defaults the DTD declares for one element but not another', () => {
    const xml = '<!DOCTYPE r [<!ATTLIST b c CDATA "d">]><r><a x="1"/><b x="1"/><a x="1"/></r>';
    expect(parseEveryWay(xml)).toBe('<r><a x="1"></a><b c="d" x="1"></b><a x="1"></a></r>');
  });

  it('reports a repeated xml:id and repeats attributes after one that needed normalizing', () => {
    expect(
      errorOf('<r><a xml:id="x"/><a xml:id="x"/></r>', {
        errorHandler: {
          error: (e) => {
            throw e;
          },
        },
      }).code
    ).toBe('XMLID_DUPLICATE');
    expect(parseEveryWay('<r><a x="1"/><a x="&#33;"/><a x="1"/><a x="1"/></r>')).toBe(
      '<r><a x="1"></a><a x="!"></a><a x="1"></a><a x="1"></a></r>'
    );
  });
});
