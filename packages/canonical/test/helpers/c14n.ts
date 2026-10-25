import { type Document, DocumentBuilder, type Element } from '@exemplarjs/dom';
import { XMLError, XMLInputFactory } from '@exemplarjs/xml';
import { type CanonicalInput, type CanonicalNode, type CanonicalizeOptions, canonicalize } from '@/index.ts';

/** A factory that reads external files from memory, as `file:///examples/<name>`. */
export function factoryFor(files: Readonly<Record<string, string>> = {}): XMLInputFactory {
  return new XMLInputFactory({
    accessExternalDTD: 'all',
    accessExternalEntities: 'all',
    entityResolver: {
      resolveEntity: (request) => {
        const text = files[request.systemId ?? ''];
        return text === undefined ? undefined : { text, systemId: `file:///examples/${request.systemId ?? ''}` };
      },
    },
  });
}

/** The code canonicalization fails with, or 'none'. */
export function failure(input: CanonicalInput, options: CanonicalizeOptions = {}): string {
  try {
    canonicalize(input, options);
  } catch (error) {
    if (error instanceof XMLError) return error.code;
    throw error;
  }
  return 'none';
}

/** A DOM tree of a document, read as canonicalization reads it: entities expanded and defaults applied. */
export function tree(text: string, factory = new XMLInputFactory()): Document {
  return new DocumentBuilder(factory).parse({ text, systemId: 'file:///examples/doc.xml' });
}

/** The first element of a tree with a tag name. */
export function element(doc: Document, tagName: string): Element {
  const found = doc.getElementsByTagName(tagName).item(0);
  if (found === null) throw new Error(`No element ${tagName}`);
  return found;
}

/** A node that must be there. */
export function present<T>(node: T | null | undefined): T {
  if (node === null || node === undefined) throw new Error('No such node');
  return node;
}

/** A plain node as data: its type and name, and what it holds. */
export interface FakeSpec {
  readonly type: number;
  readonly name?: string;
  readonly value?: string | null;
  readonly namespaceURI?: string | null;
  readonly localName?: string | null;
  readonly attributes?: readonly FakeSpec[];
  readonly children?: readonly FakeSpec[];
  readonly xmlVersion?: string;
  readonly xmlEncoding?: string | null;
  readonly inputEncoding?: string | null;
}

/** A tree of plain node-like objects, linked as a DOM Level 2 tree is; nodes given no attributes have none at all. */
export function fakeTree(spec: FakeSpec): CanonicalNode {
  return build(spec, null, null);
}

/** Builds one plain node and the nodes below it. */
function build(spec: FakeSpec, parent: CanonicalNode | null, owner: CanonicalNode | null): CanonicalNode {
  const node: Record<string, unknown> = {
    nodeType: spec.type,
    nodeName: spec.name ?? '',
    nodeValue: spec.value ?? null,
    namespaceURI: spec.namespaceURI ?? null,
    localName: spec.localName ?? null,
    parentNode: parent,
    ownerDocument: owner,
    nextSibling: null,
    firstChild: null,
    attributes: null,
    xmlVersion: spec.xmlVersion,
    xmlEncoding: spec.xmlEncoding,
    inputEncoding: spec.inputEncoding,
  };
  const self = node as unknown as CanonicalNode;
  const document = spec.type === 9 ? self : owner;
  const attributes = (spec.attributes ?? []).map((a) => build(a, null, document));
  if (spec.attributes !== undefined) {
    node['attributes'] = { length: attributes.length, item: (i: number) => attributes[i] ?? null };
  }
  let previous: Record<string, unknown> | undefined;
  for (const child of spec.children ?? []) {
    const built = build(child, self, document) as unknown as Record<string, unknown>;
    if (previous === undefined) node['firstChild'] = built;
    else previous['nextSibling'] = built;
    previous = built;
  }
  return self;
}
