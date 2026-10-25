import { describe, expect, it } from 'vitest';
import { DocumentBuilder } from '@/builder.ts';
import { DOMConfiguration, DOMError, DOMLocator, DOMStringList } from '@/config.ts';
import * as dom from '@/index.ts';
import * as nodes from '@/nodes/index.ts';
import { DOMParser, PARSER_ERROR_NAMESPACE, XMLSerializer } from '@/parser.ts';

describe('the package entry point', () => {
  it('exports the builder, the browser-style entry points and the configuration classes', () => {
    expect(dom.DocumentBuilder).toBe(DocumentBuilder);
    expect([dom.DOMParser, dom.XMLSerializer, dom.PARSER_ERROR_NAMESPACE]).toEqual([
      DOMParser,
      XMLSerializer,
      PARSER_ERROR_NAMESPACE,
    ]);
    expect([dom.DOMConfiguration, dom.DOMError, dom.DOMLocator, dom.DOMStringList]).toEqual([
      DOMConfiguration,
      DOMError,
      DOMLocator,
      DOMStringList,
    ]);
  });

  it.each([
    'Attr',
    'CDATASection',
    'CharacterData',
    'Comment',
    'DOMImplementation',
    'DOMImplementationRegistry',
    'Document',
    'DocumentFragment',
    'DocumentPosition',
    'DocumentType',
    'Element',
    'Entity',
    'EntityReference',
    'NamedNodeMap',
    'Node',
    'NodeList',
    'NodeType',
    'Notation',
    'ProcessingInstruction',
    'Text',
    'TypeInfo',
    'UserDataOperation',
  ] as const)('exports %s from the node module', (name) => {
    expect(dom[name]).toBe(nodes[name]);
  });

  it('keeps the builder internals out of the public API', () => {
    expect(Object.keys(dom)).not.toContain('NO_ATTRIBUTES');
    expect(Object.keys(dom)).not.toContain('setEntityBase');
  });
});
