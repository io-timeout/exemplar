import { describe, expect, it } from 'vitest';
import * as exemplar from '@/index.ts';

describe('@exemplarjs/xml', () => {
  it('exports the reading API and nothing internal', () => {
    expect(Object.keys(exemplar).toSorted()).toEqual([
      'AsyncEventReader',
      'Attribute',
      'DEFAULT_LIMITS',
      'ErrorCode',
      'EventReader',
      'EventType',
      'QName',
      'ResolutionError',
      'XMLError',
      'XMLInputFactory',
    ]);
  });

  it('reads a document through what it exports', () => {
    const reader = new exemplar.XMLInputFactory().createStreamReader('<a/>');
    expect(reader.next()).toBe(exemplar.EventType.START_ELEMENT);
    expect(exemplar.ErrorCode.WF_SECOND_ROOT).toBe('WF_SECOND_ROOT');
  });
});
