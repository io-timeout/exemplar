import { describe, expect, it } from 'vitest';
import { EventType, XMLInputFactory } from '@exemplarjs/xml';
import * as validation from '@/index.ts';

describe('@exemplarjs/validation', () => {
  it('exports dtdValidator, and nothing else at run time', () => {
    expect(Object.keys(validation)).toEqual(['dtdValidator']);
  });

  it('gives a validator that creates a document validator for each cursor', () => {
    const validator: validation.Validator = validation.dtdValidator();
    const created: validation.DocumentValidator[] = [];
    const factory = new XMLInputFactory({
      validator: {
        create: (context: validation.ValidationContext) => {
          const made = validator.create(context);
          created.push(made);
          return made;
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      const reader = factory.createStreamReader('<!DOCTYPE a [<!ELEMENT a EMPTY>]><a/>');
      while (reader.next() !== EventType.END_DOCUMENT);
    }
    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
  });
});
