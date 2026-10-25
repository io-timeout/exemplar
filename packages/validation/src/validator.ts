import { type AttributeDeclaration, ErrorCode, EventType, type Location } from '@exemplarjs/xml';
import {
  type DocumentValidator,
  type ValidationContext,
  type Validator,
  isNmtoken,
  isXmlName,
} from '@exemplarjs/xml/internal';
import { type Automaton, type ContentModel, compileContentModel } from './content-model.ts';

// Module-level constants, so V8 can inline them; imported bindings are read again on every use.
const { CHARACTERS, ENTITY_REFERENCE } = EventType;

/** Creates a DTD validator to pass to a factory as `validator`; it checks every validity constraint of XML 1.0 and 1.1. */
export function dtdValidator(): Validator {
  return { create: (context) => new DtdValidator(context) };
}

/** An open element: its name and content model, where its children have got to, and what has been reported. */
interface ElementFrame {
  readonly name: string;
  /** Its compiled content model; undefined when the element type isn't declared. */
  readonly model: ContentModel | undefined;
  /** Whether its declaration is external, which the standalone constraint asks about whitespace. */
  readonly declaredExternally: boolean;
  /** For element content, the automaton's state after the children so far. */
  automatonState: number;
  /** Whether a content error has been reported, after which its content is not checked further. */
  contentErrorReported: boolean;
}

/**
 * Checks one document against its DTD as the cursor reads it. The cursor calls it for each event
 * (see `DocumentValidator`); it reports each broken validity constraint as a recoverable error,
 * so reading carries on. IDREFs are checked at the end, once every ID is known.
 */
class DtdValidator implements DocumentValidator {
  readonly #context: ValidationContext;
  /** Each element type's content model, compiled once. */
  readonly #models = new Map<string, ContentModel>();
  /** The open elements, innermost last. */
  readonly #frames: ElementFrame[] = [];
  /** The ID values seen so far. */
  readonly #ids = new Set<string>();
  /** The IDREF values seen so far, with where each was, to check at the end. */
  readonly #idReferences: [string, Location][] = [];
  /** The name the DOCTYPE gives the root element; undefined without a DOCTYPE. */
  #doctypeName: string | undefined;

  constructor(context: ValidationContext) {
    this.#context = context;
  }

  /** Reports a validity error. */
  #error(code: ErrorCode, message: string, location?: Location): void {
    this.#context.error(code, message, location);
  }

  dtd(): void {
    this.#doctypeName = this.#context.reader.doctype().name;
    this.#checkDeclarations();
  }

  startElement(): void {
    const name = this.#context.reader.name();
    const parent = this.#frames.at(-1);
    if (parent === undefined) this.#checkRoot(name);
    else this.#checkChild(parent, name);
    const declaration = this.#context.store().elements.get(name);
    if (declaration === undefined) this.#error(ErrorCode.VC_ELEMENT_VALID, `The element type ${name} is not declared`);
    const model = declaration === undefined ? undefined : this.#compiledModel(name, declaration.content);
    this.#frames.push({
      name,
      model,
      declaredExternally: declaration?.declaredExternally ?? false,
      automatonState: model?.kind === 'CHILDREN' ? model.automaton.start : 0,
      contentErrorReported: false,
    });
    this.#checkAttributes(name);
  }

  endElement(): void {
    const frame = this.#frames.pop() as ElementFrame;
    const model = frame.model;
    if (model?.kind !== 'CHILDREN' || frame.contentErrorReported || model.automaton.accepts(frame.automatonState))
      return;
    const expected = model.automaton.expected(frame.automatonState).join(', ');
    this.#error(ErrorCode.VC_ELEMENT_VALID, `The content of ${frame.name} is incomplete; expected ${expected}`);
  }

  text(event: EventType): boolean {
    const frame = this.#frames.at(-1);
    const model = frame?.model;
    if (frame === undefined || model === undefined) return false;
    if (model.kind === 'EMPTY') {
      this.#contentError(frame, `The element ${frame.name} is declared EMPTY and must have no content`);
      return false;
    }
    if (model.kind !== 'CHILDREN') return false;
    const reader = this.#context.reader;
    if (event !== CHARACTERS || !reader.isWhitespace() || this.#context.textHasReferences()) {
      this.#contentError(frame, `Character data is not allowed in the element content of ${frame.name}`);
      return false;
    }
    if (this.#context.standalone() && frame.declaredExternally) {
      this.#error(
        ErrorCode.VC_STANDALONE,
        `A standalone document has whitespace in ${frame.name}, whose element content is declared externally`
      );
    }
    return true;
  }

  markup(event: EventType): void {
    this.#reportInEmpty(event === ENTITY_REFERENCE ? 'an entity reference' : 'markup');
  }

  entity(name: string): void {
    this.#reportInEmpty(`the entity ${name}`);
  }

  /** Reports what an element declared EMPTY holds; `description` names it. */
  #reportInEmpty(description: string): void {
    const frame = this.#frames.at(-1);
    if (frame?.model?.kind === 'EMPTY') {
      this.#contentError(frame, `The element ${frame.name} is declared EMPTY and cannot hold ${description}`);
    }
  }

  endDocument(): void {
    for (const [value, location] of this.#idReferences) {
      if (!this.#ids.has(value)) this.#error(ErrorCode.VC_IDREF, `No element has the ID ${value}`, location);
    }
  }

  /** The root element must have the DOCTYPE's name, and a document without one cannot be valid. */
  #checkRoot(name: string): void {
    if (this.#doctypeName === undefined) {
      this.#error(ErrorCode.VC_ROOT_ELEMENT, 'The document has no DOCTYPE to be valid against');
    } else if (name !== this.#doctypeName) {
      this.#error(ErrorCode.VC_ROOT_ELEMENT, `The root element is ${name}, but the DOCTYPE names ${this.#doctypeName}`);
    }
  }

  /** Checks a child element against its parent's content model. */
  #checkChild(parent: ElementFrame, name: string): void {
    const model = parent.model;
    if (model === undefined || parent.contentErrorReported) return;
    if (model.kind === 'EMPTY') {
      this.#contentError(parent, `The element ${parent.name} is declared EMPTY and must have no content`);
    } else if (model.kind === 'MIXED') {
      if (!model.names.has(name)) this.#contentError(parent, `The element ${name} is not allowed in ${parent.name}`);
    } else if (model.kind === 'CHILDREN') {
      this.#advancePastChild(parent, model.automaton, name);
    }
  }

  /** Moves an element's content automaton past a child, reporting a child the model does not allow there. */
  #advancePastChild(parent: ElementFrame, automaton: Automaton, name: string): void {
    const next = automaton.next(parent.automatonState, name);
    if (next >= 0) {
      parent.automatonState = next;
      return;
    }
    const expected = automaton.expected(parent.automatonState).join(', ') || 'no more elements';
    this.#contentError(parent, `The element ${name} is not allowed here in ${parent.name}; expected ${expected}`);
  }

  /** Reports a content error once per element. */
  #contentError(frame: ElementFrame, message: string): void {
    if (frame.contentErrorReported) return;
    frame.contentErrorReported = true;
    this.#error(ErrorCode.VC_ELEMENT_VALID, message);
  }

  /** An element type's content model, compiled the first time it is asked for. */
  #compiledModel(name: string, content: string): ContentModel {
    let model = this.#models.get(name);
    if (model === undefined) {
      model = compileContentModel(content);
      this.#models.set(name, model);
    }
    return model;
  }

  /** Checks a start tag's attributes, the ones the DTD defaults included. */
  #checkAttributes(element: string): void {
    const context = this.#context;
    const list = context.attributes();
    const store = context.store();
    const standalone = context.standalone();
    const declared = store.attributes.get(element);
    for (let i = 0; i < list.count; i++) {
      const name = list.names[i] as string;
      const declaration = declared?.get(name);
      if (declaration === undefined) {
        this.#error(ErrorCode.VC_ATTRIBUTE_TYPE, `The attribute ${name} is not declared for ${element}`);
        continue;
      }
      const value = list.values[i] as string;
      this.#checkValue(declaration, value);
      if (declaration.mode === 'FIXED' && value !== declaration.value) {
        this.#error(
          ErrorCode.VC_FIXED_DEFAULT,
          `The attribute ${name} must have its fixed value ${declaration.value as string}`
        );
      }
      if (standalone && declaration.declaredExternally) this.#checkStandalone(name, i);
    }
    if (declared !== undefined) this.#checkRequired(element, declared, list.names, list.count);
  }

  /** Reports each #REQUIRED attribute that is not among the first `count` names of a start tag's attributes. */
  #checkRequired(
    element: string,
    declared: ReadonlyMap<string, AttributeDeclaration>,
    names: readonly string[],
    count: number
  ): void {
    for (const declaration of declared.values()) {
      if (declaration.mode === 'REQUIRED' && !names.slice(0, count).includes(declaration.name)) {
        this.#error(ErrorCode.VC_REQUIRED_ATTRIBUTE, `The element ${element} needs the attribute ${declaration.name}`);
      }
    }
  }

  /** A standalone document must not depend on external attribute declarations for defaults or normalization. */
  #checkStandalone(name: string, attributeIndex: number): void {
    const list = this.#context.attributes();
    if (list.isSpecified[attributeIndex] !== true) {
      this.#error(
        ErrorCode.VC_STANDALONE,
        `The attribute ${name} is defaulted from an external declaration in a standalone document`
      );
    } else if (list.changedByNormalizing[attributeIndex] === true) {
      this.#error(
        ErrorCode.VC_STANDALONE,
        `The value of ${name} changes under an external declaration's normalization in a standalone document`
      );
    }
  }

  /** Checks a value against its declared type (§3.3.1); CDATA takes any value. */
  #checkValue(declaration: AttributeDeclaration, value: string): void {
    const { name, type } = declaration;
    switch (type) {
      case 'ID': {
        this.#checkId(name, value);
        break;
      }
      case 'IDREF':
      case 'IDREFS': {
        this.#checkReferences(name, value, type === 'IDREFS');
        break;
      }
      case 'ENTITY':
      case 'ENTITIES': {
        this.#checkEntities(name, value, type === 'ENTITIES');
        break;
      }
      case 'NMTOKEN':
      case 'NMTOKENS': {
        this.#checkTokens(name, value, type === 'NMTOKENS');
        break;
      }
      case 'NOTATION':
      case 'ENUMERATION': {
        this.#checkEnumerated(declaration, value);
        break;
      }
    }
  }

  /** An ID must be a Name that no other element's ID has (VC: ID). */
  #checkId(name: string, value: string): void {
    if (!this.#checkIsName(name, value, ErrorCode.VC_ID)) return;
    if (this.#ids.has(value)) this.#error(ErrorCode.VC_ID, `The ID ${value} is used more than once`);
    this.#ids.add(value);
  }

  /** Notes ID references, which are checked once the whole document has been read. */
  #checkReferences(name: string, value: string, allowsSeveral: boolean): void {
    for (const token of this.#tokensOf(name, value, allowsSeveral)) {
      if (this.#checkIsName(name, token, ErrorCode.VC_IDREF))
        this.#idReferences.push([token, this.#context.reader.location()]);
    }
  }

  /** ENTITY and ENTITIES values must name unparsed entities (VC: Entity Name). */
  #checkEntities(name: string, value: string, allowsSeveral: boolean): void {
    for (const token of this.#tokensOf(name, value, allowsSeveral)) {
      if (!this.#checkIsName(name, token, ErrorCode.VC_ENTITY_NAME)) continue;
      if (this.#context.store().generalEntities.get(token)?.notation === undefined) {
        this.#error(ErrorCode.VC_ENTITY_NAME, `${token} is not the name of an unparsed entity`);
      }
    }
  }

  /** NMTOKEN and NMTOKENS values must be name tokens (VC: Name Token). */
  #checkTokens(name: string, value: string, allowsSeveral: boolean): void {
    for (const token of this.#tokensOf(name, value, allowsSeveral)) {
      if (!isNmtoken(token)) this.#error(ErrorCode.VC_NAME_TOKEN, `The value of ${name} must be name tokens`);
    }
  }

  /** A NOTATION or enumerated value must be one the declaration lists (VC: Notation Attributes, VC: Enumeration). */
  #checkEnumerated(declaration: AttributeDeclaration, value: string): void {
    const { name, type } = declaration;
    if (type === 'NOTATION') this.#checkNoColon(name, value);
    const values = declaration.values as readonly string[];
    if (values.includes(value)) return;
    const code = type === 'NOTATION' ? ErrorCode.VC_NOTATION_ATTRIBUTES : ErrorCode.VC_ENUMERATION;
    this.#error(code, `The value of ${name} must be one of ${values.join(', ')}`);
  }

  /** The tokens of a value: one, or several separated by spaces when the type allows several; an empty value is reported. */
  #tokensOf(name: string, value: string, allowsSeveral: boolean): string[] {
    if (value !== '') return allowsSeveral ? value.split(' ') : [value];
    this.#error(ErrorCode.VC_ATTRIBUTE_TYPE, `The attribute ${name} must not be empty`);
    return [];
  }

  /** Whether a value is a Name, reporting it with `code` when not; also reports a colon when namespace-aware. */
  #checkIsName(name: string, value: string, code: ErrorCode): boolean {
    if (!isXmlName(value)) {
      this.#error(code, `The value of ${name} must be a name`);
      return false;
    }
    this.#checkNoColon(name, value);
    return true;
  }

  /** Reports a colon in the value of an ID, IDREF, ENTITY or NOTATION attribute, which Namespaces forbids. */
  #checkNoColon(name: string, value: string): void {
    if (this.#context.namespaceAware && value.includes(':')) {
      this.#error(ErrorCode.VC_NAMESPACE_COLON, `The value of ${name} must not contain a colon`);
    }
  }

  /** The constraints on the DTD's declarations, checked once it has been read. */
  #checkDeclarations(): void {
    const store = this.#context.store();
    for (const element of store.elements.values()) {
      const model = this.#compiledModel(element.name, element.content);
      if (model.kind === 'MIXED' && model.duplicate !== undefined) {
        this.#error(
          ErrorCode.VC_NO_DUPLICATE_TYPES,
          `${model.duplicate} appears twice in the content of ${element.name}`
        );
      }
    }
    for (const [element, declarations] of store.attributes)
      this.#checkAttributeList(element, [...declarations.values()]);
    for (const entity of store.generalEntities.values()) {
      if (entity.notation !== undefined && !store.notations.has(entity.notation)) {
        this.#error(
          ErrorCode.VC_NOTATION_DECLARED,
          `The notation ${entity.notation} of ${entity.name} is not declared`
        );
      }
    }
  }

  /** The constraints on an element type's attribute declarations together, then on each. */
  #checkAttributeList(element: string, declarations: readonly AttributeDeclaration[]): void {
    const store = this.#context.store();
    const ids = declarations.filter((declaration) => declaration.type === 'ID');
    const notations = declarations.filter((declaration) => declaration.type === 'NOTATION');
    if (ids.length > 1) this.#error(ErrorCode.VC_ONE_ID, `The element ${element} has more than one ID attribute`);
    if (notations.length > 1) {
      this.#error(ErrorCode.VC_ONE_NOTATION, `The element ${element} has more than one NOTATION attribute`);
    }
    if (notations.length > 0 && store.elements.get(element)?.content === 'EMPTY') {
      this.#error(ErrorCode.VC_NOTATION_EMPTY, `The EMPTY element ${element} cannot have a NOTATION attribute`);
    }
    for (const declaration of declarations) this.#checkAttributeDeclaration(declaration);
  }

  /** The constraints on one attribute declaration. */
  #checkAttributeDeclaration(declaration: AttributeDeclaration): void {
    if (declaration.type === 'ID' && (declaration.mode === 'DEFAULT' || declaration.mode === 'FIXED')) {
      this.#error(ErrorCode.VC_ID_DEFAULT, `The ID attribute ${declaration.name} must be #IMPLIED or #REQUIRED`);
    }
    const values = declaration.values ?? [];
    if (new Set(values).size < values.length) {
      this.#error(ErrorCode.VC_DUPLICATE_TOKENS, `A value is listed twice for the attribute ${declaration.name}`);
    }
    const notations = this.#context.store().notations;
    if (declaration.type === 'NOTATION') {
      for (const notation of values.filter((value) => !notations.has(value))) {
        this.#error(ErrorCode.VC_NOTATION_ATTRIBUTES, `The notation ${notation} is not declared`);
      }
    }
    if (declaration.value !== undefined && !defaultFits(declaration)) {
      this.#error(ErrorCode.VC_DEFAULT_SYNTAX, `The default of ${declaration.name} does not fit its type`);
    }
    if (declaration.name === 'xml:space' && !xmlSpaceFits(declaration)) {
      this.#error(ErrorCode.VC_ATTRIBUTE_TYPE, 'xml:space must be declared as an enumeration of default and preserve');
    }
  }
}

/** Whether xml:space is declared as §2.10 requires: an enumeration of `default`, `preserve` or both. */
function xmlSpaceFits(declaration: AttributeDeclaration): boolean {
  const values = declaration.values ?? [];
  return declaration.type === 'ENUMERATION' && values.every((value) => value === 'default' || value === 'preserve');
}

/** Whether a declared default meets its type's syntax (VC: Attribute Default Value Syntactically Correct). */
function defaultFits(declaration: AttributeDeclaration): boolean {
  const value = declaration.value as string;
  switch (declaration.type) {
    case 'IDREF':
    case 'ENTITY': {
      return isXmlName(value);
    }
    case 'IDREFS':
    case 'ENTITIES': {
      return value !== '' && value.split(' ').every((token) => isXmlName(token));
    }
    case 'NMTOKEN': {
      return isNmtoken(value);
    }
    case 'NMTOKENS': {
      return value !== '' && value.split(' ').every((token) => isNmtoken(token));
    }
    case 'NOTATION':
    case 'ENUMERATION': {
      return (declaration.values as readonly string[]).includes(value);
    }
    default: {
      return true;
    }
  }
}
