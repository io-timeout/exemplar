import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { StringSink, XMLOutputFactory } from '@/index.ts';

/** Copies a document through the event writer from a reader that reports entity boundaries. */
function copiedWithBoundaries(xml: string): string {
  const sink = new StringSink();
  const writer = new XMLOutputFactory({ omitXMLDeclaration: true }).createEventWriter(sink);
  writer.add(new XMLInputFactory({ reportEntityBoundaries: true }).createEventReader(xml));
  writer.flush();
  return sink.toString();
}

describe('entity boundaries through the event writer (reportEntityBoundaries)', () => {
  it('writes the expanded text and nothing for the boundaries', () => {
    expect(copiedWithBoundaries('<!DOCTYPE a [<!ENTITY t "text">]><a>&t;</a>')).toContain('<a>text</a>');
  });

  it('writes the markup an entity holds, nested entities included', () => {
    const xml = '<!DOCTYPE a [<!ENTITY i "in"><!ENTITY o "<b x=\'1\'>[&i;]</b>">]><a>&o;&o;</a>';
    expect(copiedWithBoundaries(xml)).toBe(
      `${xml.slice(0, xml.indexOf('<a>'))}<a><b x="1">[in]</b><b x="1">[in]</b></a>`
    );
  });

  it('writes an empty entity as nothing', () => {
    expect(copiedWithBoundaries('<!DOCTYPE a [<!ENTITY e "">]><a>&e;</a>')).toBe('<!DOCTYPE a [<!ENTITY e "">]><a/>');
  });
});
