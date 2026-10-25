import type {
  AsyncStreamReader,
  Doctype,
  DtdItem,
  EntityDeclaration,
  NotationDeclaration,
  StreamReader,
} from '@exemplarjs/xml';
import { escapeAndResolveURI } from '@exemplarjs/xml/internal';

/** A document's unparsed entities and notations: those it declares, and those included content has brought in. */
export class Declarations {
  /** The document's reader, whose DOCTYPE holds its own declarations. */
  readonly #document: { doctype(): Doctype };
  /** Fails on a declaration included content makes differently, given what it is. */
  readonly #failOnConflict: (what: string) => never;
  /** The unparsed entities by name: the document's own, read when first needed, and those included. */
  readonly #entities = new Map<string, EntityDeclaration>();
  /** The notations by name, likewise. */
  readonly #notations = new Map<string, NotationDeclaration>();
  #ownDeclarationsRead = false;
  /** The declarations included content has brought in, in the order they came. */
  readonly included: DtdItem[] = [];

  /** Reads the document's own declarations from its doctype; `failOnConflict` fails on one included differently. */
  constructor(document: { doctype(): Doctype }, failOnConflict: (what: string) => never) {
    this.#document = document;
    this.#failOnConflict = failOnConflict;
  }

  /** The unparsed entity of a name the document declares or has included. */
  entity(name: string): EntityDeclaration | undefined {
    if (!this.#ownDeclarationsRead) this.#readOwnDeclarations();
    return this.#entities.get(name);
  }

  /** The notation of a name the document declares or has included. */
  notation(name: string): NotationDeclaration | undefined {
    if (!this.#ownDeclarationsRead) this.#readOwnDeclarations();
    return this.#notations.get(name);
  }

  /** Reads the document's own unparsed entities and notations once; content names them only after the DTD ends. */
  #readOwnDeclarations(): void {
    this.#ownDeclarationsRead = true;
    const doctype = this.#document.doctype();
    for (const entity of doctype.entities) if (entity.notation !== undefined) this.#entities.set(entity.name, entity);
    for (const notation of doctype.notations) this.#notations.set(notation.name, notation);
  }

  /** Adds the unparsed entities and notations an included start tag names in its attributes, from `theirs`. */
  addNamedBy(tag: StreamReader | AsyncStreamReader, theirs: Declarations): void {
    for (let i = 0; i < tag.attributeCount(); i++) {
      const type = tag.attributeType(i);
      if (type === 'NOTATION') this.#addNotation(theirs, tag.attributeValue(i));
      if (type !== 'ENTITY' && type !== 'ENTITIES') continue;
      for (const name of tag.attributeValue(i).split(' ')) this.#addEntity(theirs, name);
    }
  }

  /** Adds an included document's unparsed entity, with its notation; one declared differently under the name is fatal. */
  #addEntity(theirs: Declarations, name: string): void {
    const entity = theirs.entity(name);
    if (entity === undefined) return;
    const ours = this.entity(name);
    if (ours === undefined) {
      this.#entities.set(name, entity);
      this.included.push({ kind: 'entity', declaration: entity });
      this.#addNotation(theirs, entity.notation as string);
      return;
    }
    if (!sameExternalId(ours, entity) || ours.notation !== entity.notation) {
      this.#failOnConflict(`The unparsed entity ${name}`);
    }
  }

  /** Adds an included document's notation; one declared differently under the name is fatal. */
  #addNotation(theirs: Declarations, name: string): void {
    const notation = theirs.notation(name);
    if (notation === undefined) return;
    const ours = this.notation(name);
    if (ours === undefined) {
      this.#notations.set(name, notation);
      this.included.push({ kind: 'notation', declaration: notation });
      return;
    }
    if (!sameExternalId(ours, notation)) this.#failOnConflict(`The notation ${name}`);
  }
}

/** Whether two declarations have the same public identifier, and system identifiers that resolve to the same URI. */
function sameExternalId(
  first: EntityDeclaration | NotationDeclaration,
  second: EntityDeclaration | NotationDeclaration
): boolean {
  return first.publicId === second.publicId && resolvedSystemId(first) === resolvedSystemId(second);
}

/** A declaration's system identifier made absolute against the base URI of where it is declared, where it can be. */
function resolvedSystemId(declaration: EntityDeclaration | NotationDeclaration): string | undefined {
  const { systemId, baseURI } = declaration;
  if (systemId === undefined) return undefined;
  return escapeAndResolveURI(systemId, baseURI) ?? systemId;
}
