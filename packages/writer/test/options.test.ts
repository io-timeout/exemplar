import { describe, expect, it } from 'vitest';
import { resolveOutputOptions } from '@/options.ts';

describe('resolveOutputOptions', () => {
  it('fills in the defaults of the JAXP output properties', () => {
    expect(resolveOutputOptions({})).toEqual({
      indent: undefined,
      repairNamespaces: false,
      escaping: 'roundTrip',
      checkWellFormedness: true,
      omitXMLDeclaration: false,
      version: '1.0',
      doctypePublic: undefined,
      doctypeSystem: undefined,
      cdataSectionElements: new Set(),
      encoding: 'UTF-8',
      namespaceAware: true,
    });
  });

  it('keeps every option it is given', () => {
    expect(
      resolveOutputOptions({
        indent: '\t',
        repairNamespaces: true,
        escaping: 'minimal',
        checkWellFormedness: false,
        omitXMLDeclaration: true,
        version: '1.1',
        doctypePublic: '-//P',
        doctypeSystem: 's.dtd',
        cdataSectionElements: ['script', 'p:style'],
        encoding: 'ISO-8859-1',
        namespaceAware: false,
      })
    ).toEqual({
      indent: '\t',
      repairNamespaces: true,
      escaping: 'minimal',
      checkWellFormedness: false,
      omitXMLDeclaration: true,
      version: '1.1',
      doctypePublic: '-//P',
      doctypeSystem: 's.dtd',
      cdataSectionElements: new Set(['script', 'p:style']),
      encoding: 'ISO-8859-1',
      namespaceAware: false,
    });
  });

  it('keeps an empty indent, which still starts lines', () => {
    expect(resolveOutputOptions({ indent: '' }).indent).toBe('');
  });

  it('copies the CDATA element names into a set of its own', () => {
    const names = ['a'];
    const resolved = resolveOutputOptions({ cdataSectionElements: names });
    names.push('b');
    expect([...resolved.cdataSectionElements]).toEqual(['a']);
  });
});
