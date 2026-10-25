import { serialize } from '@test/helpers/dom.ts';
import { describe, expect, it } from 'vitest';
import { XMLInputFactory } from '@exemplarjs/xml';
import { DocumentBuilder } from '@/index.ts';

/** A document with nested entities holding text and markup. */
const NESTED = '<!DOCTYPE a [<!ENTITY i "<i>in</i>"><!ENTITY o "x&i;y"><!ENTITY t "text">]><a>&t;|&o;</a>';

describe('entity boundaries in the DOM (reportEntityBoundaries)', () => {
  it('builds the same tree when the reader reports entity boundaries', () => {
    const xml = '<!DOCTYPE a [<!ENTITY t "text">]><a>&t;</a>';
    const factory = new XMLInputFactory({ reportEntityBoundaries: true });
    expect(new DocumentBuilder(factory).parse(xml).documentElement?.textContent).toBe('text');
  });

  it.each([true, false])('builds the same tree from nested entities with references replaced: %s', (replace) => {
    const plain = new DocumentBuilder(new XMLInputFactory({ replaceEntityReferences: replace })).parse(NESTED);
    const reported = new DocumentBuilder(
      new XMLInputFactory({ replaceEntityReferences: replace, reportEntityBoundaries: true })
    ).parse(NESTED);
    expect(reported.isEqualNode(plain)).toBe(true);
    expect(serialize(reported)).toBe(serialize(plain));
  });

  it('builds the same tree asynchronously', async () => {
    const factory = new XMLInputFactory({ reportEntityBoundaries: true, replaceEntityReferences: false });
    const document = await new DocumentBuilder(factory).parseAsync(NESTED);
    expect(serialize(document.documentElement as NonNullable<typeof document.documentElement>)).toBe('<a>&t;|&o;</a>');
  });
});
