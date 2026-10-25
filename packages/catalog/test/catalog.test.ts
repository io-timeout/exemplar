import { type Files, NS, ROOT, catalog, entries, file, memoryReader } from '@test/helpers/catalog.ts';
import { describe, expect, it } from 'vitest';
import { ResolutionError } from '@exemplarjs/xml';
import { CatalogResolver, catalogResolver } from '@/index.ts';

/** The error code a call throws as a ResolutionError. */
function codeOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof ResolutionError) return error.code;
    throw error;
  }
  return 'none';
}

describe('external identifiers (§7.1)', () => {
  it('tries system entries, then rewrites, then suffixes, then public entries (§7.1.2)', () => {
    const c = entries(
      '<public publicId="-//A//EN" uri="public.dtd"/>' +
        '<systemSuffix systemIdSuffix="a.dtd" uri="suffix.dtd"/>' +
        '<rewriteSystem systemIdStartString="http://x/" rewritePrefix="rewritten/"/>' +
        '<system systemId="http://x/a.dtd" uri="system.dtd"/>'
    );
    expect(c.matchEntity('-//A//EN', 'http://x/a.dtd')).toBe('file:///c/system.dtd');
    expect(c.matchEntity('-//A//EN', 'http://x/b/a.dtd')).toBe('file:///c/rewritten/b/a.dtd');
    expect(c.matchEntity('-//A//EN', 'http://y/a.dtd')).toBe('file:///c/suffix.dtd');
    expect(c.matchEntity('-//A//EN', 'http://y/b.dtd')).toBe('file:///c/public.dtd');
  });

  it('delegates on the system identifier before trying public entries (§7.1.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<public publicId="-//A//EN" uri="public.dtd"/><delegateSystem systemIdStartString="http://d/" catalog="d.xml"/>'
      ),
      'file:///c/d.xml': file('<system systemId="http://d/a.dtd" uri="delegated.dtd"/>'),
    });
    expect(c.matchEntity('-//A//EN', 'http://d/a.dtd')).toBe('file:///c/delegated.dtd');
    expect(c.matchEntity('-//A//EN', 'http://d/other.dtd')).toBeUndefined();
    expect(c.matchEntity('-//A//EN', 'http://elsewhere/a.dtd')).toBe('file:///c/public.dtd');
  });

  it('matches system entries exactly, and takes the first that matches (§6.5.4)', () => {
    const c = entries(
      '<system systemId="http://x/a.dtd" uri="first.dtd"/><system systemId="http://x/a.dtd" uri="second.dtd"/>'
    );
    expect(c.matchEntity(undefined, 'http://x/a.dtd')).toBe('file:///c/first.dtd');
    expect(c.matchEntity(undefined, 'http://x/a.dtd2')).toBeUndefined();
    expect(c.matchEntity(undefined, 'http://x/')).toBeUndefined();
  });

  it('rewrites with the longest matching start string (§6.5.5)', () => {
    const c = entries(
      '<rewriteSystem systemIdStartString="http://www.oasis-open.org/" rewritePrefix="file:///share/doctypes/oasis/"/>' +
        '<rewriteSystem systemIdStartString="http://www.oasis-open.org/docbook/" rewritePrefix="file:///sourceforge/docbook/docbook/"/>' +
        '<rewriteSystem systemIdStartString="http://www.oasis-open.org/committees/" rewritePrefix="file:///projects/oasis/"/>'
    );
    expect(c.matchEntity(undefined, 'http://www.oasis-open.org/docbook/xml/4.1.2/docbookx.dtd')).toBe(
      'file:///sourceforge/docbook/docbook/xml/4.1.2/docbookx.dtd'
    );
    expect(c.matchEntity(undefined, 'http://www.oasis-open.org/other/x.dtd')).toBe(
      'file:///share/doctypes/oasis/other/x.dtd'
    );
  });

  it('rewrites with the first of equally long start strings', () => {
    const c = entries(
      '<rewriteSystem systemIdStartString="http://x/" rewritePrefix="first/"/><rewriteSystem systemIdStartString="http://x/" rewritePrefix="second/"/>'
    );
    expect(c.matchEntity(undefined, 'http://x/a.dtd')).toBe('file:///c/first/a.dtd');
  });

  it('maps by the longest matching suffix, the first of equals (§6.5.6)', () => {
    const c = entries(
      '<systemSuffix systemIdSuffix="docbookx.dtd" uri="file:///share/doctypes/xml/4.4/docbookx.dtd"/>' +
        '<systemSuffix systemIdSuffix="4.3/docbookx.dtd" uri="file:///share/doctypes/xml/4.3/docbookx.dtd"/>' +
        '<systemSuffix systemIdSuffix="docbookx.dtd" uri="file:///later.dtd"/>'
    );
    expect(c.matchEntity(undefined, 'file:/C|/local/docbookx.dtd')).toBe('file:///share/doctypes/xml/4.4/docbookx.dtd');
    expect(c.matchEntity(undefined, 'file:/C|/local/backup/4.3/docbookx.dtd')).toBe(
      'file:///share/doctypes/xml/4.3/docbookx.dtd'
    );
  });

  it('follows the prefer setting of the catalog or group an entry sits in (§4.1.1)', () => {
    const c = entries(
      '<group prefer="system"><public publicId="-//S//EN" uri="s.dtd"/></group><public publicId="-//P//EN" uri="p.dtd"/>',
      { prefer: 'system' }
    );
    expect(c.matchEntity('-//S//EN', undefined)).toBe('file:///c/s.dtd');
    expect(c.matchEntity('-//S//EN', 'http://elsewhere/s.dtd')).toBeUndefined();
    expect(c.matchEntity('-//P//EN', 'http://elsewhere/p.dtd')).toBeUndefined();
    const preferring = entries('<public publicId="-//P//EN" uri="p.dtd"/>');
    expect(preferring.matchEntity('-//P//EN', 'http://elsewhere/p.dtd')).toBe('file:///c/p.dtd');
  });

  it('lets a group prefer public identifiers inside a catalog that prefers system ones (§4.1.1)', () => {
    const c = entries('<group prefer="public"><public publicId="-//G//EN" uri="g.dtd"/></group>', { prefer: 'system' });
    expect(c.matchEntity('-//G//EN', 'http://elsewhere/g.dtd')).toBe('file:///c/g.dtd');
    const inFile = catalog({
      [ROOT]: file('<group prefer="public"><public publicId="-//G//EN" uri="g.dtd"/></group>', 'prefer="system"'),
    });
    expect(inFile.matchEntity('-//G//EN', 'http://elsewhere/g.dtd')).toBe('file:///c/g.dtd');
  });

  it('delegates public identifiers beside a system identifier only where public ones are preferred (§7.1.2)', () => {
    const files = {
      [ROOT]: file(
        '<group prefer="system"><delegatePublic publicIdStartString="-//S//" catalog="d.xml"/></group>' +
          '<delegatePublic publicIdStartString="-//P//" catalog="d.xml"/>'
      ),
      'file:///c/d.xml': file('<public publicId="-//S//EN" uri="s.dtd"/><public publicId="-//P//EN" uri="p.dtd"/>'),
    };
    const c = catalog(files);
    expect(c.matchEntity('-//S//EN', undefined)).toBe('file:///c/s.dtd');
    expect(c.matchEntity('-//S//EN', 'http://elsewhere/s.dtd')).toBeUndefined();
    expect(c.matchEntity('-//P//EN', 'http://elsewhere/p.dtd')).toBe('file:///c/p.dtd');
  });

  it('delegates to every matching catalog, longest match first, and stops there (§7.1.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<delegateSystem systemIdStartString="http://d/" catalog="short.xml"/>' +
          '<delegateSystem systemIdStartString="http://d/long/" catalog="long.xml"/>' +
          '<nextCatalog catalog="next.xml"/>'
      ),
      'file:///c/short.xml': file('<system systemId="http://d/long/s.dtd" uri="from-short.dtd"/>'),
      'file:///c/long.xml': file(
        '<nextCatalog catalog="long-next.xml"/><system systemId="http://d/long/s.dtd" uri="from-long.dtd"/>'
      ),
      'file:///c/long-next.xml': file('<system systemId="http://d/long/n.dtd" uri="n.dtd"/>'),
      'file:///c/next.xml': file('<system systemId="http://d/x.dtd" uri="next.dtd"/>'),
    });
    expect(c.matchEntity(undefined, 'http://d/long/s.dtd')).toBe('file:///c/from-long.dtd');
    expect(c.matchEntity(undefined, 'http://d/long/n.dtd')).toBe('file:///c/n.dtd');
    expect(c.matchEntity(undefined, 'http://d/x.dtd')).toBeUndefined();
  });

  it('drops the public identifier when delegating on the system identifier, and the other way round (§7.1.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<delegateSystem systemIdStartString="http://d/" catalog="d.xml"/><delegatePublic publicIdStartString="-//D//" catalog="d.xml"/>'
      ),
      'file:///c/d.xml': file(
        '<public publicId="-//A//EN" uri="a.dtd"/><system systemId="http://x/b.dtd" uri="b.dtd"/><public publicId="-//D//X" uri="dx.dtd"/>'
      ),
    });
    expect(c.matchEntity('-//A//EN', 'http://d/a.dtd')).toBeUndefined();
    expect(c.matchEntity('-//D//EN', 'http://x/b.dtd')).toBeUndefined();
    expect(c.matchEntity('-//D//X', 'http://x/b.dtd')).toBe('file:///c/dx.dtd');
  });

  it('delegates public identifiers longest match first (§7.1.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<delegatePublic publicIdStartString="-//D//" catalog="short.xml"/><delegatePublic publicIdStartString="-//D//DTD" catalog="long.xml"/>'
      ),
      'file:///c/short.xml': file(
        '<public publicId="-//D//DTD X//EN" uri="short.dtd"/><public publicId="-//D//DTD Y//EN" uri="y.dtd"/>'
      ),
      'file:///c/long.xml': file('<public publicId="-//D//DTD X//EN" uri="long.dtd"/>'),
    });
    expect(c.matchEntity('-//D//DTD X//EN', undefined)).toBe('file:///c/long.dtd');
    expect(c.matchEntity('-//D//DTD Y//EN', undefined)).toBe('file:///c/y.dtd');
  });

  it('normalizes public identifiers, and escapes system identifiers and URIs, on both sides (§6.2, §6.3)', () => {
    const c = entries(
      '<public publicId="  -//A//DTD   One//EN " uri="one.dtd"/><system systemId="http://x/a b é.dtd" uri="ab.dtd"/>'
    );
    expect(c.matchEntity('-//A//DTD\n One//EN', undefined)).toBe('file:///c/one.dtd');
    expect(c.matchEntity(undefined, 'http://x/a%20b%20%C3%A9.dtd')).toBe('file:///c/ab.dtd');
    expect(c.matchEntity(undefined, 'http://x/a b é.dtd')).toBe('file:///c/ab.dtd');
  });

  it('unwraps urn:publicid: URNs (§6.4, §7.1.1)', () => {
    const c = entries('<public publicId="-//OASIS//DTD DocBook XML V4.1.2//EN" uri="docbook.dtd"/>');
    const urn = 'urn:publicid:-:OASIS:DTD+DocBook+XML+V4.1.2:EN';
    expect(c.matchEntity(urn, undefined)).toBe('file:///c/docbook.dtd');
    expect(c.matchEntity(undefined, urn)).toBe('file:///c/docbook.dtd');
    expect(c.matchEntity('-//OASIS//DTD DocBook XML V4.1.2//EN', urn)).toBe('file:///c/docbook.dtd');
    expect(c.matchURI(urn)).toBe('file:///c/docbook.dtd');
  });

  it('drops a urn:publicid: system identifier that differs from the public identifier given (§7.1.1)', () => {
    const c = entries('<public publicId="-//Other//EN" uri="other.dtd"/><public publicId="-//A//EN" uri="a.dtd"/>');
    expect(c.matchEntity('-//Other//EN', 'urn:publicid:-:A:EN')).toBe('file:///c/other.dtd');
    expect(c.matchEntity('-//None//EN', 'urn:publicid:-:A:EN')).toBeUndefined();
  });

  it('treats a urn:publicid: system identifier as a public identifier alone, whatever prefer says (§7.1.1)', () => {
    const c = entries('<public publicId="-//A//EN" uri="a.dtd"/>', { prefer: 'system' });
    expect(c.matchEntity(undefined, 'urn:publicid:-:A:EN')).toBe('file:///c/a.dtd');
  });

  it('tries a relative system identifier as written, then made absolute (§7.1.1)', () => {
    const c = entries(
      '<system systemId="a.dtd" uri="literal.dtd"/><system systemId="http://x/doc/b.dtd" uri="absolute.dtd"/>'
    );
    expect(c.matchEntity(undefined, 'a.dtd', 'http://x/doc/main.xml')).toBe('file:///c/literal.dtd');
    expect(c.matchEntity(undefined, 'b.dtd', 'http://x/doc/main.xml')).toBe('file:///c/absolute.dtd');
    expect(c.matchEntity(undefined, 'b.dtd')).toBeUndefined();
    expect(c.matchEntity(undefined, 'http://y/b.dtd', 'http://x/doc/main.xml')).toBeUndefined();
  });

  it('tries system entries for a relative system identifier, made absolute too, before public ones (§7.1.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<system systemId="http://x/doc/b.dtd" uri="system.dtd"/>' +
          '<rewriteSystem systemIdStartString="http://x/rw/" rewritePrefix="rewritten/"/>' +
          '<delegateSystem systemIdStartString="http://x/d/" catalog="d.xml"/>' +
          '<public publicId="-//A//EN" uri="public.dtd"/>'
      ),
      'file:///c/d.xml': file('<system systemId="http://x/d/b.dtd" uri="delegated.dtd"/>'),
    });
    expect(c.matchEntity('-//A//EN', 'b.dtd', 'http://x/doc/main.xml')).toBe('file:///c/system.dtd');
    expect(c.matchEntity('-//A//EN', 'b.dtd', 'http://x/rw/main.xml')).toBe('file:///c/rewritten/b.dtd');
    expect(c.matchEntity('-//A//EN', 'b.dtd', 'http://x/d/main.xml')).toBe('file:///c/delegated.dtd');
    expect(c.matchEntity('-//A//EN', 'c.dtd', 'http://x/d/main.xml')).toBeUndefined();
    expect(c.matchEntity('-//A//EN', 'b.dtd', 'http://x/other/main.xml')).toBe('file:///c/public.dtd');
    expect(c.matchEntity('-//A//EN', 'b.dtd')).toBe('file:///c/public.dtd');
  });

  it('gives undefined for an external identifier with neither part', () => {
    expect(entries('<system systemId="" uri="empty.dtd"/>').matchEntity(undefined, undefined)).toBeUndefined();
  });

  it('keeps a system identifier’s fragment in matching and rewriting (§4.3)', () => {
    const c = entries('<rewriteSystem systemIdStartString="http://x/s/" rewritePrefix="s/"/>');
    expect(c.matchEntity(undefined, 'http://x/s/a.dtd#part')).toBe('file:///c/s/a.dtd#part');
  });
});

describe('URI references (§7.2)', () => {
  it('resolves through uri, rewriteURI, uriSuffix and delegateURI entries (§7.2.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<uri name="http://x/u.xml" uri="u.xml"/><rewriteURI uriStartString="http://x/r/" rewritePrefix="r/"/>' +
          '<uriSuffix uriSuffix="/s.xml" uri="s.xml"/><delegateURI uriStartString="http://d/" catalog="d.xml"/>' +
          '<system systemId="http://x/sys.xml" uri="sys.xml"/>'
      ),
      'file:///c/d.xml': file('<uri name="http://d/a.xml" uri="d-a.xml"/>'),
    });
    expect(c.matchURI('http://x/u.xml')).toBe('file:///c/u.xml');
    expect(c.matchURI('http://x/r/p/q.xml')).toBe('file:///c/r/p/q.xml');
    expect(c.matchURI('http://y/any/s.xml')).toBe('file:///c/s.xml');
    expect(c.matchURI('http://d/a.xml')).toBe('file:///c/d-a.xml');
    expect(c.matchURI('http://d/b.xml')).toBeUndefined();
  });

  it('tries uri entries, then rewrites, then suffixes, then delegation (§7.2.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<delegateURI uriStartString="http://x/" catalog="d.xml"/><uriSuffix uriSuffix="a.xml" uri="suffix.xml"/>' +
          '<rewriteURI uriStartString="http://x/r/" rewritePrefix="rewritten/"/><uri name="http://x/r/a.xml" uri="uri.xml"/>'
      ),
      'file:///c/d.xml': file('<uri name="http://x/d.xml" uri="delegated.xml"/>'),
    });
    expect(c.matchURI('http://x/r/a.xml')).toBe('file:///c/uri.xml');
    expect(c.matchURI('http://x/r/b.xml')).toBe('file:///c/rewritten/b.xml');
    expect(c.matchURI('http://x/q/a.xml')).toBe('file:///c/suffix.xml');
    expect(c.matchURI('http://x/d.xml')).toBe('file:///c/delegated.xml');
  });

  it('rewrites and suffixes by the longest match (§6.5.8, §6.5.9)', () => {
    const c = entries(
      '<rewriteURI uriStartString="http://x/" rewritePrefix="short/"/><rewriteURI uriStartString="http://x/long/" rewritePrefix="long/"/>' +
        '<uriSuffix uriSuffix=".xsl" uri="any.xsl"/><uriSuffix uriSuffix="/html/docbook.xsl" uri="html.xsl"/>'
    );
    expect(c.matchURI('http://x/long/a.xml')).toBe('file:///c/long/a.xml');
    expect(c.matchURI('http://x/a.xml')).toBe('file:///c/short/a.xml');
    expect(c.matchURI('http://y/html/docbook.xsl')).toBe('file:///c/html.xsl');
    expect(c.matchURI('http://y/fo/docbook.xsl')).toBe('file:///c/any.xsl');
  });

  it('delegates URIs to every matching catalog, longest match first, and stops there (§7.2.2)', () => {
    const c = catalog({
      [ROOT]: file(
        '<delegateURI uriStartString="http://d/" catalog="short.xml"/><delegateURI uriStartString="http://d/long/" catalog="long.xml"/>' +
          '<nextCatalog catalog="next.xml"/>'
      ),
      'file:///c/short.xml': file(
        '<uri name="http://d/long/a.xml" uri="short-a.xml"/><uri name="http://d/long/b.xml" uri="short-b.xml"/>'
      ),
      'file:///c/long.xml': file('<uri name="http://d/long/a.xml" uri="long-a.xml"/>'),
      'file:///c/next.xml': file('<uri name="http://d/c.xml" uri="next-c.xml"/>'),
    });
    expect(c.matchURI('http://d/long/a.xml')).toBe('file:///c/long-a.xml');
    expect(c.matchURI('http://d/long/b.xml')).toBe('file:///c/short-b.xml');
    expect(c.matchURI('http://d/c.xml')).toBeUndefined();
  });

  it('leaves a URI reference’s fragment out of matching (§4.3)', () => {
    const c = entries(
      '<uri name="http://x/u.xml" uri="u.xml"/><rewriteURI uriStartString="http://x/r/" rewritePrefix="r/"/>'
    );
    expect(c.matchURI('http://x/u.xml#part')).toBe('file:///c/u.xml');
    expect(c.matchURI('http://x/r/a.xml#part')).toBe('file:///c/r/a.xml');
  });

  it('tries a relative reference as written, then made absolute (§7.2.1)', () => {
    const c = entries(
      '<uri name="part.xml" uri="literal.xml"/><uri name="http://x/doc/other.xml" uri="absolute.xml"/>'
    );
    expect(c.matchURI('part.xml', 'http://x/doc/main.xml')).toBe('file:///c/literal.xml');
    expect(c.matchURI('other.xml', 'http://x/doc/main.xml')).toBe('file:///c/absolute.xml');
    expect(c.matchURI('other.xml')).toBeUndefined();
    expect(c.matchURI('other.xml', 'not a base')).toBeUndefined();
  });

  it('resolves a urn:publicid: URI through public entries, under either prefer setting (§7.2.1)', () => {
    const c = entries('<group prefer="system"><public publicId="-//A//EN" uri="a.dtd"/></group>');
    expect(c.matchURI('urn:publicid:-:A:EN')).toBe('file:///c/a.dtd');
  });
});

describe('the other kind of entry, as the JDK tries it', () => {
  it('answers a lookup its own kind cannot, in any catalog file, after its own kind in every file', () => {
    const c = catalog({
      [ROOT]: file(
        '<system systemId="http://x/a.xml" uri="system-a.xml"/><uri name="http://x/b.dtd" uri="uri-b.dtd"/><nextCatalog catalog="next.xml"/>'
      ),
      'file:///c/next.xml': file(
        '<uri name="http://x/a.xml" uri="uri-a.xml"/><system systemId="http://x/b.dtd" uri="system-b.dtd"/>'
      ),
    });
    expect(c.matchURI('http://x/a.xml')).toBe('file:///c/uri-a.xml');
    expect(c.matchEntity(undefined, 'http://x/b.dtd')).toBe('file:///c/system-b.dtd');
    expect(c.matchURI('http://x/b.dtd')).toBe('file:///c/uri-b.dtd');
    expect(c.matchEntity(undefined, 'http://x/a.xml')).toBe('file:///c/system-a.xml');
    const one = entries('<system systemId="http://x/s.xml" uri="s.xml"/><uri name="http://x/u.dtd" uri="u.dtd"/>');
    expect(one.matchURI('http://x/s.xml')).toBe('file:///c/s.xml');
    expect(one.matchEntity(undefined, 'http://x/u.dtd')).toBe('file:///c/u.dtd');
  });

  it('tries the uri entries for a system identifier without its fragment, as written and made absolute', () => {
    const c = entries('<uri name="http://x/doc/u.dtd" uri="u.dtd"/>');
    expect(c.matchEntity(undefined, 'http://x/doc/u.dtd#f')).toBe('file:///c/u.dtd');
    expect(c.matchEntity(undefined, 'u.dtd', 'http://x/doc/main.xml')).toBe('file:///c/u.dtd');
    expect(c.matchEntity('-//A//EN', undefined)).toBeUndefined();
  });

  it('tries the system entries for a URI, as written and made absolute', () => {
    const c = entries('<system systemId="http://x/doc/s.xml" uri="s.xml"/>');
    expect(c.matchURI('s.xml', 'http://x/doc/main.xml')).toBe('file:///c/s.xml');
    expect(c.matchURI('http://x/doc/s.xml#f')).toBe('file:///c/s.xml');
  });
});

describe('catalog entry files (§4, §8)', () => {
  it('searches nextCatalog files after the current file, in order, ignoring ones that are no catalog (§4, §8)', () => {
    const c = catalog({
      [ROOT]: file(
        '<nextCatalog catalog="missing.xml"/><nextCatalog catalog="plain.xml"/>' +
          '<nextCatalog catalog="a.xml"/><nextCatalog catalog="b.xml"/><system systemId="http://x/0" uri="0"/>'
      ),
      'file:///c/plain.xml': '<catalog><system systemId="http://x/1" uri="plain"/></catalog>',
      'file:///c/a.xml': file('<system systemId="http://x/1" uri="a"/>'),
      'file:///c/b.xml': file('<system systemId="http://x/1" uri="b"/><system systemId="http://x/2" uri="b"/>'),
    });
    expect([0, 1, 2, 3].map((n) => c.matchEntity(undefined, `http://x/${n}`))).toEqual([
      'file:///c/0',
      'file:///c/a',
      'file:///c/b',
      undefined,
    ]);
  });

  it('searches the files given in order, each one’s nextCatalog files straight after it (§4)', () => {
    const files: Files = {
      'file:///c/first.xml': file(
        '<nextCatalog catalog="first-next.xml"/><system systemId="http://x/1" uri="first-1"/>'
      ),
      'file:///c/first-next.xml': file('<system systemId="http://x/2" uri="first-next-2"/>'),
      'file:///c/second.xml': file(
        '<system systemId="http://x/1" uri="second-1"/><system systemId="http://x/2" uri="second-2"/><system systemId="http://x/3" uri="second-3"/>'
      ),
    };
    const c = catalogResolver({
      files: ['file:///c/first.xml', 'file:///c/second.xml'],
      read: memoryReader(files).read,
      resolve: 'continue',
    });
    expect(['1', '2', '3'].map((n) => c.matchEntity(undefined, `http://x/${n}`))).toEqual([
      'file:///c/first-1',
      'file:///c/first-next-2',
      'file:///c/second-3',
    ]);
  });

  it('searches a file named twice only once, which is no circular reference', () => {
    const files: Files = {
      [ROOT]: file('<nextCatalog catalog="a.xml"/><nextCatalog catalog="b.xml"/>'),
      'file:///c/a.xml': file('<nextCatalog catalog="shared.xml"/>'),
      'file:///c/b.xml': file('<nextCatalog catalog="shared.xml"/><nextCatalog catalog="a.xml"/>'),
      'file:///c/shared.xml': file('<system systemId="http://x/s" uri="s"/>'),
    };
    const { read, asked } = memoryReader(files);
    const c = catalogResolver({ files: [ROOT, ROOT], read, resolve: 'continue' });
    expect(c.matchEntity(undefined, 'http://x/none')).toBeUndefined();
    expect(c.matchEntity(undefined, 'http://x/s')).toBe('file:///c/s');
    expect(asked.toSorted()).toEqual([ROOT, 'file:///c/a.xml', 'file:///c/b.xml', 'file:///c/shared.xml'].toSorted());
  });

  it('reads each catalog file once, and only when a search reaches it, by default', () => {
    const files: Files = {
      [ROOT]: file(
        '<system systemId="http://x/0" uri="0"/><nextCatalog catalog="next.xml"/><delegateURI uriStartString="http://d/" catalog="d.xml"/>'
      ),
      'file:///c/next.xml': file('<system systemId="http://x/1" uri="1"/>'),
      'file:///c/d.xml': file('<uri name="http://d/a" uri="d-a"/>'),
    };
    const { read, asked } = memoryReader(files);
    const c = catalogResolver({ files: [ROOT], read, resolve: 'continue' });
    expect(asked).toEqual([]);
    c.matchEntity(undefined, 'http://x/0');
    expect(asked).toEqual([ROOT]);
    c.matchEntity(undefined, 'http://x/1');
    c.matchEntity(undefined, 'http://x/9');
    expect(asked).toEqual([ROOT, 'file:///c/next.xml']);
    c.matchURI('http://d/a');
    expect(asked).toEqual([ROOT, 'file:///c/next.xml', 'file:///c/d.xml']);
  });

  it('reads every catalog file the files lead to when the resolver is made, with defer off', () => {
    const files: Files = {
      [ROOT]: file(
        '<nextCatalog catalog="next.xml"/><delegatePublic publicIdStartString="-//P" catalog="p.xml"/>' +
          '<delegateSystem systemIdStartString="http://s/" catalog="s.xml"/><delegateURI uriStartString="http://u/" catalog="u.xml"/>'
      ),
      'file:///c/next.xml': file('<nextCatalog catalog="p.xml"/>'),
      'file:///c/p.xml': file('<public publicId="-//P//EN" uri="p.dtd"/>'),
      'file:///c/s.xml': file(''),
      'file:///c/u.xml': '<not-a-catalog/>',
    };
    const { read, asked } = memoryReader(files);
    const c = catalogResolver({ files: [ROOT, 'file:///c/missing.xml'], read, defer: false, resolve: 'continue' });
    expect(asked).toEqual([
      ROOT,
      'file:///c/next.xml',
      'file:///c/p.xml',
      'file:///c/s.xml',
      'file:///c/u.xml',
      'file:///c/missing.xml',
    ]);
    expect(c.matchEntity('-//P//EN', undefined)).toBe('file:///c/p.dtd');
    expect(asked).toHaveLength(6);
  });

  it('treats a catalog file whose reader throws as one that cannot be read (§8)', () => {
    const c = catalogResolver({
      files: [ROOT, 'file:///c/b.xml'],
      read: (uri) => {
        if (uri === ROOT) throw new Error('unreadable');
        return { text: file('<system systemId="http://x/a" uri="b.dtd"/>'), systemId: uri };
      },
      resolve: 'continue',
    });
    expect(c.matchEntity(undefined, 'http://x/a')).toBe('file:///c/b.dtd');
  });

  it('returns the first match without resolving it again (§5.3)', () => {
    const c = entries('<uri name="http://x/a" uri="http://x/b"/><uri name="http://x/b" uri="http://x/c"/>');
    expect(c.matchURI('http://x/a')).toBe('http://x/b');
  });

  it.each([
    ['nextCatalog back to itself', { [ROOT]: file('<nextCatalog catalog="catalog.xml"/>') }],
    [
      'nextCatalog through another file',
      {
        [ROOT]: file('<nextCatalog catalog="b.xml"/>'),
        'file:///c/b.xml': file('<system systemId="http://x/b" uri="b"/><nextCatalog catalog="catalog.xml"/>'),
      },
    ],
    [
      'delegation back to the delegating file',
      {
        [ROOT]: file('<delegateSystem systemIdStartString="http://x/" catalog="d.xml"/>'),
        'file:///c/d.xml': file('<delegateSystem systemIdStartString="http://x/" catalog="catalog.xml"/>'),
      },
    ],
  ])('fails with CATALOG_CIRCULAR on %s (§8)', (_how, files) => {
    expect(codeOf(() => catalog(files).matchEntity(undefined, 'http://x/none'))).toBe('CATALOG_CIRCULAR');
    expect(codeOf(() => catalog(files, { defer: false }))).toBe('CATALOG_CIRCULAR');
  });

  it('finds a match before a circular reference is reached', () => {
    const files = {
      [ROOT]: file('<nextCatalog catalog="b.xml"/>'),
      'file:///c/b.xml': file('<system systemId="http://x/b" uri="b"/><nextCatalog catalog="catalog.xml"/>'),
    };
    expect(catalog(files).matchEntity(undefined, 'http://x/b')).toBe('file:///c/b');
  });

  it('reads files from the default reader when given none, which finds no file: catalog that does not exist', () => {
    const c = catalogResolver({ files: ['file:///no/such/catalog.xml'], resolve: 'continue' });
    expect(c.matchEntity(undefined, 'http://x/a')).toBeUndefined();
  });
});

describe('CatalogResolver as a resolver itself', () => {
  const FILES: Files = {
    [ROOT]: file(
      '<uri name="http://x/u.xml" uri="u.xml"/><system systemId="http://x/e.ent" uri="e.ent"/><uri name="http://x/gone.xml" uri="gone.xml"/>'
    ),
    'file:///c/u.xml': '<u/>',
    'file:///c/e.ent': 'entity text',
  };

  it('is the class the package exports', () => {
    expect(catalog(FILES)).toBeInstanceOf(CatalogResolver);
  });

  it('reads what an entity maps to with its reader', () => {
    expect(catalog(FILES).resolveEntity({ name: 'e', systemId: 'http://x/e.ent' })).toEqual({
      systemId: 'file:///c/e.ent',
      text: 'entity text',
    });
  });

  it('reads what a URI maps to with its reader', () => {
    expect(catalog(FILES).resolve('http://x/u.xml', undefined)).toEqual({ systemId: 'file:///c/u.xml', text: '<u/>' });
    expect(catalog(FILES).resolve('u.xml', 'http://x/main.xml')).toEqual({ systemId: 'file:///c/u.xml', text: '<u/>' });
  });

  it('gives undefined for a mapped resource its reader cannot read', () => {
    expect(catalog(FILES, { resolve: 'strict' }).resolve('http://x/gone.xml', undefined)).toBeUndefined();
  });

  it('reads with its reader, giving undefined when the reader throws', () => {
    expect(catalog(FILES).read('file:///c/u.xml')).toEqual({ systemId: 'file:///c/u.xml', text: '<u/>' });
    const throwing = catalogResolver({
      files: [ROOT],
      read: () => {
        throw new Error('no');
      },
    });
    expect(throwing.read('file:///c/u.xml')).toBeUndefined();
  });

  it('fails with CATALOG_NO_MATCH under strict when nothing matches', () => {
    const strict = catalog(FILES, { resolve: 'strict' });
    expect(strict.resolution).toBe('strict');
    expect(
      codeOf(() =>
        strict.resolveEntity({ name: 'e', publicId: '-//X//EN', systemId: 'e.ent', baseURI: 'http://x/doc/' })
      )
    ).toBe('CATALOG_NO_MATCH');
    expect(codeOf(() => strict.resolve('none.xml', 'http://x/doc/'))).toBe('CATALOG_NO_MATCH');
    expect(codeOf(() => strict.resolve('none.xml', undefined))).toBe('CATALOG_NO_MATCH');
  });

  it('names the identifiers nothing matches in its error', () => {
    const strict = catalog(FILES, { resolve: 'strict' });
    expect(() =>
      strict.resolveEntity({ name: 'e', publicId: '-//X//EN', systemId: 'e.ent', baseURI: 'http://x/doc/' })
    ).toThrow(/-\/\/X\/\/EN.*http:\/\/x\/doc\/e\.ent/);
  });

  it('gives undefined under continue when nothing matches', () => {
    const c = catalog(FILES, { resolve: 'continue' });
    expect(c.resolution).toBe('continue');
    expect(c.resolveEntity({ name: 'e', systemId: 'http://x/none' })).toBeUndefined();
    expect(c.resolve('http://x/none.xml', undefined)).toBeUndefined();
  });

  it('gives an entity empty content under ignore when nothing matches, and a URI nothing', () => {
    const c = catalog(FILES, { resolve: 'ignore' });
    expect(c.resolution).toBe('ignore');
    expect(c.resolveEntity({ name: 'e', systemId: 'none.ent', baseURI: 'http://x/doc/' })).toEqual({
      text: '',
      systemId: 'http://x/doc/none.ent',
    });
    expect(c.resolveEntity({ name: 'e', systemId: 'none.ent' })).toEqual({ text: '', systemId: 'none.ent' });
    expect(c.resolveEntity({ name: 'e', publicId: '-//X//EN' })).toEqual({ text: '' });
    expect(c.resolve('http://x/none.xml', undefined)).toBeUndefined();
  });

  it('remembers its answers, and starts again once it has remembered many', () => {
    const c = entries('<rewriteURI uriStartString="http://x/" rewritePrefix="r/"/>');
    for (let i = 0; i < 10_001; i++) expect(c.matchURI(`http://x/${i}`)).toBe(`file:///c/r/${i}`);
    expect(c.matchURI('http://x/0')).toBe('file:///c/r/0');
    expect(c.matchURI('http://y/0')).toBeUndefined();
    expect(c.matchURI('http://y/0')).toBeUndefined();
  });
});

describe('the catalog namespace (§6)', () => {
  it('applies xml:base, and ignores elements in other namespaces with their content (§6, §6.1)', () => {
    const c = entries(
      '<group xml:base="http://mirror/dtd/"><system systemId="http://x/a.dtd" uri="a.dtd"/>' +
        '<system systemId="http://x/b.dtd" uri="b.dtd" xml:base="../other/"/></group>' +
        `<ext xmlns="urn:other"><system ${NS} systemId="http://x/c.dtd" uri="c.dtd"/></ext><system systemId="http://x/d.dtd" uri="d.dtd"/>`
    );
    expect(c.matchEntity(undefined, 'http://x/a.dtd')).toBe('http://mirror/dtd/a.dtd');
    expect(c.matchEntity(undefined, 'http://x/b.dtd')).toBe('http://mirror/other/b.dtd');
    expect(c.matchEntity(undefined, 'http://x/c.dtd')).toBeUndefined();
    expect(c.matchEntity(undefined, 'http://x/d.dtd')).toBe('file:///c/d.dtd');
  });
});
