import { errorOf, parseEveryWay } from '@test/helpers/parse.ts';
import { describe, expect, it } from 'vitest';

describe('attributes (§3.1)', () => {
  it('rejects an attribute that appears twice (WFC: Unique Att Spec)', () => {
    expect(errorOf('<a b="1" b="2"/>')).toMatchObject({ code: 'WF_DUPLICATE_ATTRIBUTE', column: 10 });
  });

  it('finds duplicates among many attributes', () => {
    const attributes = Array.from({ length: 30 }, (_, i) => ` a${i}="${i}"`).join('');
    expect(parseEveryWay(`<e${attributes}/>`)).toContain('a29="29"');
    expect(errorOf(`<e${attributes} a17="x"/>`).code).toBe('WF_DUPLICATE_ATTRIBUTE');
  });
});
