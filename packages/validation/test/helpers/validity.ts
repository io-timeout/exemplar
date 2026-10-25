import { EventType, type InputOptions, type XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { dtdValidator } from '@/index.ts';

/** A validating factory that collects validity errors; the options are merged in. */
export function validating(errors: XMLError[], options: InputOptions = {}): XMLInputFactory {
  return new XMLInputFactory({ validator: dtdValidator(), errorHandler: { error: (e) => errors.push(e) }, ...options });
}

/** The validity errors a document gets through the cursor. */
export function validityErrors(xml: string, options: InputOptions = {}): XMLError[] {
  const errors: XMLError[] = [];
  const reader = validating(errors, options).createStreamReader(xml);
  while (reader.next() !== EventType.END_DOCUMENT);
  return errors;
}

/** The codes of the validity errors a document gets through the cursor. */
export function validity(xml: string, options: InputOptions = {}): string[] {
  return validityErrors(xml, options).map((e) => e.code);
}

/** The event types a validating cursor reports for a document. */
export function eventTypes(xml: string, options: InputOptions = {}): EventType[] {
  const reader = validating([], options).createStreamReader(xml);
  const types: EventType[] = [];
  for (let event = reader.next(); event !== EventType.END_DOCUMENT; event = reader.next()) types.push(event);
  return types;
}

/** Options that read external files from memory, by system id, from anywhere. */
export function withFiles(files: Readonly<Record<string, string>>): InputOptions {
  return {
    accessExternalDTD: 'all',
    accessExternalEntities: 'all',
    entityResolver: {
      resolveEntity: (request) => {
        const text = files[request.systemId ?? ''];
        return text === undefined ? undefined : { text, systemId: `http://example.com/${request.systemId ?? ''}` };
      },
    },
  };
}

/** A document with a DOCTYPE for its root and an internal subset. */
export function withSubset(root: string, subset: string, body: string): string {
  return `<!DOCTYPE ${root} [${subset}]>${body}`;
}
