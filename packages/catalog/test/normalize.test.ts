import { describe, expect, it } from 'vitest';
import { CATALOG_NAMESPACE, normalizePublicId, normalizeURI, unwrapURN } from '@/normalize.ts';

describe('CATALOG_NAMESPACE', () => {
  it('is the OASIS XML Catalogs namespace (§6)', () => {
    expect(CATALOG_NAMESPACE).toBe('urn:oasis:names:tc:entity:xmlns:xml:catalog');
  });
});

describe('normalizePublicId (§6.2)', () => {
  it.each([
    ['-//OASIS//DTD DocBook XML V4.1.2//EN', '-//OASIS//DTD DocBook XML V4.1.2//EN'],
    ['  -//A//DTD   One//EN ', '-//A//DTD One//EN'],
    ['-//A//DTD\tTab\nLine\r\nEnd//EN', '-//A//DTD Tab Line End//EN'],
    ['\n\t ', ''],
    ['', ''],
    ['a b', 'a b'],
  ])('normalizes %j to %j', (id, expected) => {
    expect(normalizePublicId(id)).toBe(expected);
  });
});

describe('normalizeURI (§6.3)', () => {
  it.each([
    ['http://example.com/a.dtd', 'http://example.com/a.dtd'],
    ['http://x/a b.dtd', 'http://x/a%20b.dtd'],
    ['http://x/café.dtd', 'http://x/caf%C3%A9.dtd'],
    ['http://x/\u{1F600}', 'http://x/%F0%9F%98%80'],
    ['http://x/"<>\\^`{|}', 'http://x/%22%3C%3E%5C%5E%60%7B%7C%7D'],
    ['http://x/\u0001\u007F', 'http://x/%01%7F'],
    ["http://x/!#$&'()*+,-./:;=?@[]_~", "http://x/!#$&'()*+,-./:;=?@[]_~"],
  ])('escapes %j as %j', (uri, expected) => {
    expect(normalizeURI(uri)).toBe(expected);
  });

  it('leaves existing escapes alone, so normalizing twice changes nothing', () => {
    expect(normalizeURI('http://x/a%20b.dtd')).toBe('http://x/a%20b.dtd');
    expect(normalizeURI(normalizeURI('http://x/a bé'))).toBe(normalizeURI('http://x/a bé'));
  });
});

describe('unwrapURN (§6.4)', () => {
  it.each([
    ['urn:publicid:ISO%2FIEC+10179%3A1996:DTD+DSSSL+Architecture:EN', 'ISO/IEC 10179:1996//DTD DSSSL Architecture//EN'],
    ['urn:publicid:-:OASIS:DTD+DocBook+XML+V4.1.2:EN', '-//OASIS//DTD DocBook XML V4.1.2//EN'],
    ['urn:publicid:-;A', '-::A'],
    ['urn:publicid:%2B%3A%2F%3B%27%3F%23%25', "+:/;'?#%"],
    ['urn:publicid:%2b%3a%2f', '+:/'],
    ['URN:PUBLICID:Upper+Case', 'Upper Case'],
    ['urn:publicid:%41', '%41'],
    ['urn:publicid:++a++', 'a'],
  ])('unwraps %j to %j', (urn, expected) => {
    expect(unwrapURN(urn)).toBe(expected);
  });

  it.each(['urn:other:x', 'http://example.com/a.dtd', 'urn:publicid', '-//A//EN'])(
    'gives undefined for %j, which is not in the publicid namespace',
    (uri) => {
      expect(unwrapURN(uri)).toBeUndefined();
    }
  );
});
