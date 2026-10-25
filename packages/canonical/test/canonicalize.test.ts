import { factoryFor, failure, tree } from '@test/helpers/c14n.ts';
import { describe, expect, it } from 'vitest';
import { ErrorCode, EventType, XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { type CanonicalMethod, canonicalize } from '@/index.ts';

const INCLUSIVE: CanonicalMethod[] = ['c14n', 'c14n11'];
const ALL: CanonicalMethod[] = ['c14n', 'c14n11', 'exc-c14n'];

describe('canonicalize: the canonical form of a document (C14N 1.0 §1.1, C14N 1.1 §1.1)', () => {
  it.each(ALL)('%s encodes the document in UTF-8, as a string or as bytes', (method) => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><doc>&#169;</doc>';
    expect(canonicalize(xml, { method })).toBe('<doc>©</doc>');
    const bytes = canonicalize(xml, { method, output: 'bytes' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([...new TextEncoder().encode('<doc>©</doc>')]);
  });

  it.each(ALL)('%s normalizes line breaks to #xA on input', (method) => {
    expect(canonicalize('<a>1\r\n2\r3</a>', { method })).toBe('<a>1\n2\n3</a>');
  });

  it.each(ALL)('%s normalizes attribute values as a validating processor would', (method) => {
    const xml = '<!DOCTYPE a [<!ATTLIST a t NMTOKENS #IMPLIED>]><a c=" x\ty " t="  p\n q  "/>';
    expect(canonicalize(xml, { method })).toBe('<a c=" x y " t="p q"></a>');
  });

  it.each(ALL)('%s replaces character and parsed entity references', (method) => {
    const xml = '<!DOCTYPE a [<!ENTITY e "&#38;#x41;-<b/>">]><a>&#x42;&e;&amp;</a>';
    expect(canonicalize(xml, { method })).toBe('<a>BA-<b></b>&amp;</a>');
  });

  it.each(ALL)('%s replaces CDATA sections with their character content', (method) => {
    expect(canonicalize('<a><![CDATA[<x> & ]]]]><![CDATA[>]]></a>', { method })).toBe('<a>&lt;x&gt; &amp; ]]&gt;</a>');
  });

  it.each(ALL)('%s removes the XML declaration and the document type declaration', (method) => {
    const xml = '<?xml version="1.0" standalone="yes"?>\n<!DOCTYPE a [<!ELEMENT a ANY>]>\n<a/>';
    expect(canonicalize(xml, { method })).toBe('<a></a>');
  });

  it.each(ALL)('%s writes empty elements as start-end tag pairs', (method) => {
    expect(canonicalize('<a><b/><c></c></a>', { method })).toBe('<a><b></b><c></c></a>');
  });

  it.each(ALL)('%s drops whitespace outside the document element and within tags', (method) => {
    const xml = '\n<?p  d?>\n\n<a   b = "1"\n>\n<c\n/></a\n>\n\n<?q?>\n';
    expect(canonicalize(xml, { method })).toBe('<?p d?>\n<a b="1">\n<c></c></a>\n<?q?>');
  });

  it.each(ALL)('%s keeps all other whitespace', (method) => {
    expect(canonicalize('<a> \t\n<b>  </b>\n</a>', { method })).toBe('<a> \t\n<b>  </b>\n</a>');
  });

  it.each(ALL)('%s delimits attribute values with quotation marks', (method) => {
    expect(canonicalize(`<a b='x"y' c='z'/>`, { method })).toBe('<a b="x&quot;y" c="z"></a>');
  });

  it.each(ALL)('%s escapes special characters in text and attribute values', (method) => {
    const xml = '<a v="&amp;&lt;>&quot;\'&#9;&#10;&#13;">&amp;&lt;&gt;"\'&#13;&#9;</a>';
    expect(canonicalize(xml, { method })).toBe('<a v="&amp;&lt;>&quot;\'&#x9;&#xA;&#xD;">&amp;&lt;&gt;"\'&#xD;\t</a>');
  });

  it.each(INCLUSIVE)('%s removes superfluous namespace declarations', (method) => {
    const xml = '<a xmlns="urn:d" xmlns:p="urn:p"><b xmlns="urn:d" xmlns:p="urn:p"><c xmlns=""/></b></a>';
    expect(canonicalize(xml, { method })).toBe('<a xmlns="urn:d" xmlns:p="urn:p"><b><c xmlns=""></c></b></a>');
    expect(canonicalize('<a xmlns=""><b xmlns=""/></a>', { method })).toBe('<a><b></b></a>');
  });

  it.each(INCLUSIVE)('%s redeclares a namespace whose URI changes', (method) => {
    const xml = '<a xmlns:p="urn:1"><b xmlns:p="urn:2"><c xmlns:p="urn:1"/></b></a>';
    expect(canonicalize(xml, { method })).toBe('<a xmlns:p="urn:1"><b xmlns:p="urn:2"><c xmlns:p="urn:1"></c></b></a>');
  });

  it.each(ALL)('%s adds default attributes', (method) => {
    const xml = '<!DOCTYPE a [<!ATTLIST a d CDATA "x" f CDATA #FIXED "y" i CDATA #IMPLIED>]><a/>';
    expect(canonicalize(xml, { method })).toBe('<a d="x" f="y"></a>');
  });

  it.each(INCLUSIVE)(
    '%s orders namespace declarations by prefix and attributes by namespace URI and local name',
    (method) => {
      const xml = '<a z="1" xmlns:b="urn:y" b:c="2" xmlns:a="urn:z" a:a="3" a="4" xmlns="urn:d"/>';
      expect(canonicalize(xml, { method })).toBe(
        '<a xmlns="urn:d" xmlns:a="urn:z" xmlns:b="urn:y" a="4" z="1" b:c="2" a:a="3"></a>'
      );
    }
  );

  it.each(ALL)('%s keeps comments and puts top-level ones on lines of their own only when asked', (method) => {
    const xml = '<!--1--><?p?><a><!--2--></a><!--3-->';
    expect(canonicalize(xml, { method })).toBe('<?p?>\n<a></a>');
    expect(canonicalize(xml, { method, comments: true })).toBe('<!--1-->\n<?p?>\n<a><!--2--></a>\n<!--3-->');
  });

  it.each(ALL)('%s puts text decoded from an encoding that is not Unicode in Normalization Form C', (method) => {
    const decomposed = 'e\u0301';
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><a b="${decomposed}">${decomposed}<!--${decomposed}--></a>`;
    expect(canonicalize(xml, { method, comments: true })).toBe('<a b="\u00E9">\u00E9<!--\u00E9--></a>');
    expect(canonicalize(`<a>${decomposed}</a>`, { method })).toBe(`<a>${decomposed}</a>`);
  });

  it('uses Canonical XML 1.0 by default', () => {
    const xml = '<a xmlns:p="urn:p"><b/></a>';
    expect(canonicalize(xml)).toBe(canonicalize(xml, { method: 'c14n' }));
    expect(canonicalize(xml)).not.toBe(canonicalize(xml, { method: 'exc-c14n' }));
  });
});

describe('canonicalize: Exclusive XML Canonicalization (Exc-C14N §3)', () => {
  it('renders a namespace only where the element or an attribute uses it', () => {
    const xml = '<a xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q"><p:b q:c="1" d="2"><e/></p:b></a>';
    expect(canonicalize(xml, { method: 'exc-c14n' })).toBe(
      '<a xmlns="urn:d"><p:b xmlns:p="urn:p" xmlns:q="urn:q" d="2" q:c="1"><e></e></p:b></a>'
    );
  });

  it('renders a used namespace again below an output ancestor that did not use it', () => {
    const xml = '<a xmlns:p="urn:p"><p:b><c><p:d/></c></p:b><p:e/></a>';
    expect(canonicalize(xml, { method: 'exc-c14n' })).toBe(
      '<a><p:b xmlns:p="urn:p"><c><p:d></p:d></c></p:b><p:e xmlns:p="urn:p"></p:e></a>'
    );
  });

  it('undeclares the default namespace with xmlns="" where an output ancestor rendered one', () => {
    const xml = '<a xmlns="urn:d"><b xmlns=""><c/></b></a>';
    expect(canonicalize(xml, { method: 'exc-c14n' })).toBe('<a xmlns="urn:d"><b xmlns=""><c></c></b></a>');
  });

  it('does not render the xml namespace for xml: attributes', () => {
    expect(canonicalize('<a xml:lang="en"/>', { method: 'exc-c14n' })).toBe('<a xml:lang="en"></a>');
  });

  it('treats the prefixes of the InclusiveNamespaces PrefixList as Canonical XML does, #default naming the default', () => {
    const xml = '<a xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q"><b/></a>';
    expect(canonicalize(xml, { method: 'exc-c14n' })).toBe('<a xmlns="urn:d"><b></b></a>');
    expect(canonicalize(xml, { method: 'exc-c14n', inclusivePrefixes: ['p', '#default'] })).toBe(
      '<a xmlns="urn:d" xmlns:p="urn:p"><b></b></a>'
    );
    expect(canonicalize('<a><b/></a>', { method: 'exc-c14n', inclusivePrefixes: ['p', '#default'] })).toBe(
      '<a><b></b></a>'
    );
  });

  it('ignores the PrefixList under the inclusive methods', () => {
    const xml = '<a xmlns:p="urn:p"><b/></a>';
    expect(canonicalize(xml, { inclusivePrefixes: ['q'] })).toBe('<a xmlns:p="urn:p"><b></b></a>');
  });
});

describe('canonicalize: input', () => {
  it('reads the external subset and external entities through the factory given', () => {
    const files = { 'a.dtd': '<!ATTLIST a d CDATA "x">', 'e.txt': 'text' };
    const xml = '<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY e SYSTEM "e.txt">]><a>&e;</a>';
    expect(canonicalize({ text: xml, systemId: 'file:///examples/doc.xml' }, { factory: factoryFor(files) })).toBe(
      '<a d="x">text</a>'
    );
  });

  it.each(['string', 'bytes'] as const)('reads a source given as %s', (kind) => {
    const xml = '<a>\u00E9</a>';
    expect(canonicalize(kind === 'string' ? xml : new TextEncoder().encode(xml))).toBe('<a>\u00E9</a>');
  });

  it('canonicalizes a cursor from where it stands, as the cursor was configured', () => {
    const reader = new XMLInputFactory().createStreamReader('<a xmlns:p="urn:p"><b/></a>');
    expect(canonicalize(reader)).toBe('<a xmlns:p="urn:p"><b></b></a>');
    expect(reader.eventType()).toBe(EventType.END_DOCUMENT);
  });

  it('drops whitespace outside the root even from a cursor that reports it', () => {
    const factory = new XMLInputFactory({ reportPrologWhitespace: true });
    expect(canonicalize(factory.createStreamReader('\n<a> </a>\n'))).toBe('<a> </a>');
    expect(canonicalize(factory.createStreamReader('\n<a> </a>\n'), { method: 'suite-first' })).toBe('<a> </a>');
  });

  it('renders namespaces as declarations from a cursor that reports them as attributes', () => {
    const reader = new XMLInputFactory({ namespacePrefixes: true }).createStreamReader('<a xmlns:p="urn:p" p:b="1"/>');
    expect(canonicalize(reader)).toBe('<a xmlns:p="urn:p" p:b="1"></a>');
  });

  it('refuses an asynchronous cursor with a TypeError', () => {
    // @ts-expect-error -- canonicalize takes a synchronous cursor, and refuses an asynchronous one
    expect(() => canonicalize(new XMLInputFactory().createAsyncStreamReader('<a/>'))).toThrow(TypeError);
    // @ts-expect-error -- canonicalize takes a synchronous cursor, and refuses an asynchronous one
    expect(() => canonicalize(new XMLInputFactory().createAsyncStreamReader())).toThrow(/synchronous/);
  });

  it('refuses the suite forms of a DOM node with a TypeError', () => {
    for (const method of ['suite-first', 'suite-second'] as const) {
      expect(() => canonicalize(tree('<a/>'), { method })).toThrow(TypeError);
    }
  });
});

describe('canonicalize: what it refuses', () => {
  it.each(ALL)('%s fails with C14N_UNREAD on an external subset it cannot read', (method) => {
    expect(failure('<!DOCTYPE a SYSTEM "a.dtd"><a/>', { method })).toBe(ErrorCode.C14N_UNREAD);
  });

  it.each(ALL)('%s fails with C14N_UNREAD on a parameter entity it cannot read', (method) => {
    expect(failure('<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent">%p;]><a/>', { method })).toBe(ErrorCode.C14N_UNREAD);
  });

  it.each(ALL)('%s fails with C14N_UNREAD, where the reference is, on an external entity it cannot read', (method) => {
    const xml = '<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]>\n<a>\n  &e;</a>';
    expect(() => canonicalize(xml, { method })).toThrow(
      expect.objectContaining({ code: ErrorCode.C14N_UNREAD, line: 3, column: 3 })
    );
  });

  it.each(['relative', '../x', 'x/y#z', '//host/path'])(
    'fails with C14N_RELATIVE_NAMESPACE on the namespace URI %j',
    (uri) => {
      for (const method of ALL) {
        expect(failure(`<a xmlns="${uri}"/>`, { method })).toBe(ErrorCode.C14N_RELATIVE_NAMESPACE);
        expect(failure(`<a><b xmlns:p="${uri}"/></a>`, { method })).toBe(ErrorCode.C14N_RELATIVE_NAMESPACE);
      }
    }
  );

  it.each(['urn:x', 'http://e.com/', 'a+b-c.d:', ''])('accepts the namespace URI %j', (uri) => {
    expect(failure(`<a xmlns="${uri}"/>`)).toBe('none');
  });

  it.each(ALL)('%s fails with C14N_VERSION on an XML 1.1 document', (method) => {
    expect(failure('<?xml version="1.1"?><a/>', { method })).toBe(ErrorCode.C14N_VERSION);
  });

  it('fails with the well-formedness error of a document that is not well-formed', () => {
    expect(() => canonicalize('<a></b>')).toThrow(XMLError);
    expect(failure('<a></b>')).not.toMatch(/^C14N/);
  });
});
