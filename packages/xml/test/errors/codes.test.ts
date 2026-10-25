import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@/errors/codes.ts';

describe('ErrorCode', () => {
  it('gives every code its own name as its value, so codes are stable strings', () => {
    for (const [key, value] of Object.entries(ErrorCode)) expect(value).toBe(key);
  });

  it('names every code in upper snake case', () => {
    for (const code of Object.values(ErrorCode)) expect(code).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
  });

  it.each([
    [
      'encodings (§4.3.3)',
      ['ENCODING_UNSUPPORTED', 'ENCODING_INVALID_BYTES', 'ENCODING_MISMATCH', 'ENCODING_UNDECLARED'],
    ],
    ['characters and line ends (§2.2, §2.11)', ['WF_INVALID_CHARACTER', 'WF_LINE_END_IN_DECLARATION']],
    ['markup (§2.3–§2.8, §3.1)', ['WF_NAME', 'WF_TAG', 'WF_COMMENT', 'WF_PI', 'WF_CDATA_END_IN_TEXT', 'WF_DOCTYPE']],
    ['references (§4.1)', ['WF_REFERENCE', 'WF_CHARACTER_REFERENCE']],
    ['namespaces', ['NS_QNAME', 'NS_COLON', 'NS_UNBOUND_PREFIX', 'NS_RESERVED', 'NS_UNDECLARED_PREFIX']],
  ])('has the codes the lexical layer reports for %s', (_, codes) => {
    for (const code of codes) expect(Object.values(ErrorCode)).toContain(code);
  });
});
