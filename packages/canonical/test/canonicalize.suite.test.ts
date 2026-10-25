import { describe, expect, it } from 'vitest';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';
import { canonicalize } from '@/index.ts';

const FORMS = ['suite-first', 'suite-second'] as const;

describe("canonicalize: the XML suite's first canonical form", () => {
  it.each(FORMS)('%s sorts attributes by name, namespace declarations among them', (method) => {
    const xml = '<a z="1" xmlns:p="urn:p" p:b="2" a="3" xmlns="urn:d"/>';
    expect(canonicalize(xml, { method })).toBe('<a a="3" p:b="2" xmlns="urn:d" xmlns:p="urn:p" z="1"></a>');
  });

  it.each(FORMS)('%s escapes &, <, >, ", tab, line feed and carriage return in text and attributes', (method) => {
    const xml = '<a v="&amp;&lt;>&quot;\'&#9;&#10;&#13;">&amp;&lt;&gt;"\'&#9;&#10;&#13;</a>';
    const escaped = "&amp;&lt;&gt;&quot;'&#9;&#10;&#13;";
    expect(canonicalize(xml, { method })).toBe(`<a v="${escaped}">${escaped}</a>`);
  });

  it.each(FORMS)('%s writes processing instructions with a space after the target, even without data', (method) => {
    expect(canonicalize('<?p?><a><?q  d ?></a>', { method })).toBe('<?p ?><a><?q d ?></a>');
  });

  it.each(FORMS)('%s writes processing instructions of the DTD before the root', (method) => {
    expect(canonicalize('<!DOCTYPE a [<?p d?><!ELEMENT a ANY>]><a/>', { method })).toBe('<?p d?><a></a>');
  });

  it.each(FORMS)('%s leaves out comments, even when asked for them, and whitespace outside the root', (method) => {
    expect(canonicalize('<!--1-->\n<a><!--2--> </a>\n<!--3-->', { method, comments: true })).toBe('<a> </a>');
  });

  it.each(FORMS)('%s writes CDATA sections and entities as their text, with defaults applied', (method) => {
    const xml = '<!DOCTYPE a [<!ENTITY e "x"><!ATTLIST a d CDATA "y">]><a><![CDATA[<]]>&e;</a>';
    expect(canonicalize(xml, { method })).toBe('<a d="y">&lt;x</a>');
  });

  it.each(FORMS)('%s writes nested elements, empty ones as start-end tag pairs', (method) => {
    expect(canonicalize('<a><b c="1"><d/>t</b><e></e></a>', { method })).toBe('<a><b c="1"><d></d>t</b><e></e></a>');
  });

  it.each(FORMS)('%s writes C1 characters of an XML 1.0 document as they are', (method) => {
    expect(canonicalize('<a>&#x85;&#x9F;</a>', { method })).toBe('<a>\u0085\u009F</a>');
  });

  it.each(FORMS)('%s does not require the DTD to be read', (method) => {
    expect(canonicalize('<!DOCTYPE a SYSTEM "a.dtd"><a/>', { method })).toBe('<a></a>');
  });

  it.each(FORMS)('%s canonicalizes the rest of a cursor from where it stands', (method) => {
    const reader = new XMLInputFactory().createStreamReader('<a><b/></a><?p d?>');
    while (reader.next() !== EventType.PROCESSING_INSTRUCTION);
    expect(canonicalize(reader, { method })).toBe('<?p d?>');
  });
});

describe("canonicalize: the XML suite's second canonical form", () => {
  it('adds the notations, sorted by name, in a DOCTYPE before the root', () => {
    const xml =
      '<?p?><!DOCTYPE a [<!NOTATION z SYSTEM "s"><!NOTATION b PUBLIC "p"><!NOTATION c PUBLIC "p" "s"><!NOTATION d SYSTEM "">]><a/>';
    expect(canonicalize(xml, { method: 'suite-second' })).toBe(
      "<?p ?><!DOCTYPE a [\n<!NOTATION b PUBLIC 'p'>\n<!NOTATION c PUBLIC 'p' 's'>\n<!NOTATION d SYSTEM ''>\n<!NOTATION z SYSTEM 's'>\n]>\n<a></a>"
    );
    expect(canonicalize(xml, { method: 'suite-first' })).toBe('<?p ?><a></a>');
  });

  it('adds no DOCTYPE to a document without notations', () => {
    expect(canonicalize('<!DOCTYPE a [<!ELEMENT a ANY>]><a/>', { method: 'suite-second' })).toBe('<a></a>');
  });
});

describe("canonicalize: the XML suite's forms of XML 1.1 documents", () => {
  it.each(FORMS)('%s starts with an XML declaration', (method) => {
    expect(canonicalize('<?xml version="1.1"?><a/>', { method })).toBe('<?xml version="1.1"?><a></a>');
  });

  it.each(FORMS)('%s writes C0 and C1 controls as decimal character references', (method) => {
    const xml = '<?xml version="1.1"?><a b="&#x1;&#x85;">&#x1F;&#x7F;&#x9F;&#xA0;&#9;</a>';
    expect(canonicalize(xml, { method })).toBe(
      '<?xml version="1.1"?><a b="&#1;&#133;">&#31;&#127;&#159;\u00A0&#9;</a>'
    );
  });

  it('puts the declaration before the notations of the second form', () => {
    const xml = '<?xml version="1.1"?><!DOCTYPE a [<!NOTATION n SYSTEM "s">]><a/>';
    expect(canonicalize(xml, { method: 'suite-second' })).toBe(
      '<?xml version="1.1"?><!DOCTYPE a [\n<!NOTATION n SYSTEM \'s\'>\n]>\n<a></a>'
    );
  });
});
