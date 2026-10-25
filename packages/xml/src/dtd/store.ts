import type {
  AttributeDeclaration,
  ElementDeclaration,
  EntityDeclaration,
  NotationDeclaration,
} from './declarations.ts';

/** What the DTD held, in the order it was read, as SAX reports it: the declarations that bind, PIs, comments and entity boundaries. */
export type DtdItem =
  | { readonly kind: 'entity'; readonly declaration: EntityDeclaration }
  | { readonly kind: 'element'; readonly declaration: ElementDeclaration }
  | { readonly kind: 'attribute'; readonly declaration: AttributeDeclaration }
  | { readonly kind: 'notation'; readonly declaration: NotationDeclaration }
  | { readonly kind: 'pi'; readonly target: string; readonly data: string }
  | { readonly kind: 'comment'; readonly text: string }
  | { readonly kind: 'startEntity' | 'endEntity'; readonly name: string }
  /** A parameter entity that was not read, named with a leading `%`. */
  | { readonly kind: 'skippedEntity'; readonly name: string };

/**
 * What the DTD declared, as far as it was read, for the rest of the reader to look up: the entities
 * a reference names, the attributes an element defaults, and the declarations a validator checks.
 * The first declaration of a name binds (§4.2, §3.3). It also notes whether some of the DTD wasn't
 * read, which decides whether an undeclared entity is a fatal error or only a validity error (§4.1).
 */
export class DeclarationStore {
  /** The general entities, by name: those `&name;` refers to. */
  readonly generalEntities = new Map<string, EntityDeclaration>();
  /** The parameter entities, by name: those `%name;` refers to, inside the DTD. */
  readonly parameterEntities = new Map<string, EntityDeclaration>();
  /** The element type declarations, by element name. */
  readonly elements = new Map<string, ElementDeclaration>();
  /** The attribute declarations, by element name and then attribute name. */
  readonly attributes = new Map<string, Map<string, AttributeDeclaration>>();
  /** The notation declarations, by name. */
  readonly notations = new Map<string, NotationDeclaration>();
  /** The processing instructions in the DTD, in the order they were read. */
  readonly processingInstructions: { readonly target: string; readonly data: string }[] = [];
  /** Everything SAX reports from the DTD, in order. */
  readonly items: DtdItem[] = [];
  /** Whether the document has a DOCTYPE at all. */
  hasDoctype = false;
  /** Whether the DOCTYPE names an external subset, read or not. */
  hasExternalSubset = false;
  /** Whether the internal subset refers to a parameter entity. */
  hasParameterReferences = false;
  /** Whether some declarations were not read: an external subset or a parameter entity that was not. */
  hasUnreadDeclarations = false;
  /** Whether a skipped parameter entity has stopped entity and attribute-list declarations from being applied (§5.1). */
  stoppedApplying = false;
  /** Whether the document says `standalone="yes"`. */
  isStandalone = false;

  /** Whether an undeclared entity is a fatal error (WFC: Entity Declared) rather than a validity error. */
  get undeclaredEntityIsFatal(): boolean {
    return !this.hasDoctype || this.isStandalone || (!this.hasExternalSubset && !this.hasParameterReferences);
  }

  /** Adds an entity declaration unless one of that name was already read. */
  declareEntity(entity: EntityDeclaration): void {
    const map = entity.isParameterEntity ? this.parameterEntities : this.generalEntities;
    this.#addIfNew(map, entity.name, entity, { kind: 'entity', declaration: entity });
  }

  /** Adds an attribute declaration unless the element already declares that attribute. */
  declareAttribute(attribute: AttributeDeclaration): void {
    let list = this.attributes.get(attribute.element);
    if (!list) {
      list = new Map();
      this.attributes.set(attribute.element, list);
    }
    this.#addIfNew(list, attribute.name, attribute, { kind: 'attribute', declaration: attribute });
  }

  /** Adds an element declaration unless one of that name was already read; returns whether it was new. */
  declareElement(element: ElementDeclaration): boolean {
    return this.#addIfNew(this.elements, element.name, element, { kind: 'element', declaration: element });
  }

  /** Adds a notation declaration unless one of that name was already read; returns whether it was new. */
  declareNotation(notation: NotationDeclaration): boolean {
    return this.#addIfNew(this.notations, notation.name, notation, { kind: 'notation', declaration: notation });
  }

  /** Adds a declaration under its name unless one is there, and lists it; returns whether it was new. */
  #addIfNew<T>(map: Map<string, T>, name: string, declaration: T, item: DtdItem): boolean {
    if (map.has(name)) return false;
    map.set(name, declaration);
    this.items.push(item);
    return true;
  }

  /** Adds a processing instruction read in the DTD. */
  addProcessingInstruction(target: string, data: string): void {
    this.processingInstructions.push({ target, data });
    this.items.push({ kind: 'pi', target, data });
  }

  /** A general entity as the reference at hand may use it: under `standalone="yes"`, external declarations do not count. */
  generalEntity(name: string): EntityDeclaration | undefined {
    const entity = this.generalEntities.get(name);
    return entity?.declaredExternally === true && this.isStandalone ? undefined : entity;
  }
}
