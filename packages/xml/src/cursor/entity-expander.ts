import type { ResolvedOptions } from '../config/options.ts';
import type { EntityDeclaration } from '../dtd/declarations.ts';
import type { DeclarationStore } from '../dtd/store.ts';
import { type ExpansionContext, expandAttributeValue, lookupGeneral } from '../entities/attribute-value.ts';
import { ExternalReader, ResolutionPendingError, entityRequest } from '../entities/external.ts';
import { EntityCounter, type ExceededLimit } from '../entities/limits.ts';
import { ErrorCode } from '../errors/codes.ts';
import type { DecoderRegistry } from '../input/decoders.ts';
import { checkDeclaredEncoding } from '../input/detect.ts';
import { CountedSource, type ChunkSource, stringSource } from '../input/source.ts';
import { scanError } from '../scan/scanner.ts';
import type { Tokenizer, TokenizerOptions } from '../tokenizer/tokenizer.ts';
import type { ElementStack } from './element-stack.ts';
import type { EntityStack } from './entity-stack.ts';
import type { ErrorReporter } from './error-reporter.ts';
import type { EventProcessing } from './event-processing.ts';
import { EventType } from './event-type.ts';
import { fail } from './internal.ts';

/** The other parts of the reader that the expander works with; the stream reader hands them over. */
export interface ExpanderParts {
  readonly entities: EntityStack;
  readonly elements: ElementStack;
  readonly errors: ErrorReporter;
  readonly processing: EventProcessing;
  /** Creates a tokenizer for an entity's text, set up as the reader's own tokenizers are. */
  createTokenizer(source: ChunkSource, options: Omit<TokenizerOptions, 'maxNameLength'>): Tokenizer;
  /** Slices the names and bindings that still point into a tokenizer's buffer, before another text is read in its place. */
  sliceBeforeLeaving(tokenizer: Tokenizer): void;
}

/**
 * Expands entity references, in content and in attribute values.
 *
 * In content, a reference such as `&chapter;` is looked up in the DTD. If expansion is on, the
 * entity's text is read in place of the reference: an internal entity's text without markup
 * becomes one CHARACTERS event at once, and any other text gets a tokenizer of its own, pushed on
 * the entity stack, so its tags and text come out as ordinary events until it ends. An external
 * entity is fetched through the resolvers first. If expansion is off, or the entity can't be read,
 * the reference is reported as an ENTITY_REFERENCE event instead.
 *
 * Every expansion is counted against the entity limits, so that a document like the "billion
 * laughs" stops early. When references aren't replaced but a validator reads the document, an
 * entity is still expanded for the validator alone, and the caller sees only the reference.
 */
export class EntityExpander {
  readonly #options: ResolvedOptions;
  readonly #registry: DecoderRegistry;
  readonly #async: boolean;
  readonly #parts: ExpanderParts;
  #externalReader: ExternalReader | undefined;
  #counter: EntityCounter | undefined;
  /** The entity name an ENTITY_REFERENCE event reports. */
  name = '';
  /** The replacement text an ENTITY_REFERENCE event reports; empty for an external entity. */
  text = '';
  /** The text of the markup-free internal entity that a CHARACTERS event reports. */
  literalText = '';
  /** That entity's name, while something listens for its end. */
  #literalEntityName: string | undefined;
  /** The name of the reference that started an expansion only the validator sees. */
  #hiddenName = '';
  /** That entity's replacement text. */
  #hiddenText = '';
  /** The document offset of that reference, where its ENTITY_REFERENCE event is reported. */
  hiddenOffset = 0;

  constructor(options: ResolvedOptions, registry: DecoderRegistry, async: boolean, parts: ExpanderParts) {
    this.#options = options;
    this.#registry = registry;
    this.#async = async;
    this.#parts = parts;
  }

  /** What reads external entities, made when first needed. */
  get external(): ExternalReader {
    this.#externalReader ??= new ExternalReader(this.#options, this.#registry, this.#async);
    return this.#externalReader;
  }

  /** What counts entity expansions against the limits, made when first needed. */
  get counter(): EntityCounter {
    this.#counter ??= new EntityCounter(this.#options.limits);
    return this.#counter;
  }

  /** Counts expansions from the start again, for a DTD read again from its start. */
  restartCounts(): void {
    this.#counter = undefined;
  }

  /** The resolver's answer an asynchronous reader waits for, no longer waited for once taken. */
  takePending(): Promise<void> | undefined {
    const external = this.#externalReader;
    const pending = external?.pending;
    if (external !== undefined) external.pending = undefined;
    return pending;
  }

  /** Counts an event read inside an entity against `entityReferenceNodes`. */
  countNode(): void {
    this.#failIfExceeded(this.counter.countEntityNode());
  }

  /** The value of attribute `attributeIndex` of the current start tag, normalized with its entity references expanded (§3.3.3). */
  expandedAttributeValue(attributeIndex: number, store: DeclarationStore): string {
    const { entities, errors } = this.#parts;
    const tokenizer = entities.current;
    const valueStart = tokenizer.attributeValueStart[attributeIndex] as number;
    const context: ExpansionContext = {
      store,
      known: this.#options.entities,
      counter: this.counter,
      version11: entities.document.version11,
      namespaceAware: this.#options.namespaceAware,
      fail: (code, message) => this.#fail(code, message, valueStart),
      error: (code, message) => errors.error(code, message, entities.locationIn(tokenizer, valueStart)),
    };
    return expandAttributeValue(
      tokenizer.buffer.slice(valueStart, tokenizer.attributeValueEnd[attributeIndex]),
      context,
      tokenizer.isReplacementText
    );
  }

  /**
   * Expands the reference in content at document offset `offset`, following the Entity Declared rules
   * (§4.1). Returns ENTITY_REFERENCE when the reference is reported rather than expanded, CHARACTERS for
   * a markup-free entity's `literalText`, NEED_INPUT while a resolver has yet to answer, or undefined
   * when the entity's own tokenizer now reads on.
   */
  expandReference(store: DeclarationStore, offset: number): EventType | undefined {
    const tokenizer = this.#parts.entities.current;
    if (this.#options.namespaceAware && tokenizer.nameColonCount > 0) {
      this.#fail(ErrorCode.NS_COLON, 'An entity name must not contain a colon', tokenizer.nameStart);
    }
    if (this.#parts.elements.depth === 0) {
      this.#fail(ErrorCode.WF_CONTENT_OUTSIDE_ROOT, 'References are not allowed outside the root element');
    }
    const name = tokenizer.buffer.slice(tokenizer.nameStart, tokenizer.nameEnd);
    this.name = name;
    this.text = '';
    const found = lookupGeneral(store, this.#options.entities, name);
    if (found.kind === 'fatal') {
      this.#fail(ErrorCode.WF_UNDECLARED_ENTITY, `The entity ${name} is not declared`, tokenizer.nameStart);
    }
    if (found.kind === 'undeclared') {
      const location = this.#parts.entities.locationIn(tokenizer, tokenizer.nameStart);
      this.#parts.errors.error(ErrorCode.VC_ENTITY_DECLARED, `The entity ${name} is not declared`, location);
    }
    return found.kind === 'entity' ? this.#expandEntity(found.entity, offset) : EventType.ENTITY_REFERENCE;
  }

  /** Expands a declared entity in content, or reports it when expansion is off or it is not read. */
  #expandEntity(entity: EntityDeclaration, offset: number): EventType | undefined {
    const { name, value } = entity;
    if (entity.notation !== undefined) {
      this.#fail(ErrorCode.WF_UNPARSED_ENTITY, `The entity ${name} is unparsed and cannot be referred to`);
    }
    if (!this.#options.replaceEntityReferences) {
      this.text = value ?? '';
      if (this.#parts.processing.validation === undefined) return EventType.ENTITY_REFERENCE;
      if (this.#parts.processing.validatorOnlyDepth === 0) return this.#expandHidden(entity, offset);
    }
    if (this.#parts.entities.isOpen(name)) {
      this.#fail(ErrorCode.WF_RECURSIVE_ENTITY, `The entity ${name} refers to itself`);
    }
    return value === undefined ? this.#expandExternal(entity, offset) : this.#expandInternal(name, value, offset);
  }

  /** Expands an entity for the validator alone; the caller sees the reference once the expansion ends (§3). */
  #expandHidden(entity: EntityDeclaration, offset: number): EventType | undefined {
    const { entities, processing } = this.#parts;
    const depth = entities.depth;
    processing.validatorOnlyDepth = depth + 1;
    this.#hiddenName = entity.name;
    this.#hiddenText = this.text;
    this.hiddenOffset = offset;
    const event =
      entity.value === undefined
        ? this.#expandExternal(entity, offset)
        : this.#expandInternal(entity.name, entity.value, offset);
    // An entity that is not read, or waits for a resolver, opened no expansion.
    if (entities.depth === depth) processing.validatorOnlyDepth = 0;
    return event;
  }

  /** Expands an internal entity: text without markup becomes one CHARACTERS event, anything else is tokenized. */
  #expandInternal(name: string, value: string, offset: number): EventType | undefined {
    this.#failIfExceeded(this.counter.countGeneralExpansion(value.length));
    const { entities, processing } = this.#parts;
    if (processing.validatorOnlyDepth === 0 && !value.includes('<') && !value.includes('&')) {
      if (value.includes(']]>')) this.#fail(ErrorCode.WF_CDATA_END_IN_TEXT, ']]> is not allowed in character data');
      processing.entityStarted(name);
      processing.validation?.entity(name);
      if (value === '') {
        processing.entityEnded(name, entities);
        return undefined;
      }
      this.countNode();
      this.literalText = value;
      if (processing.hearsEntities) this.#literalEntityName = name;
      return EventType.CHARACTERS;
    }
    const source = stringSource(value);
    const tokenizer =
      entities.takeSpareTokenizer()?.reset(source) ??
      this.#parts.createTokenizer(source, { replacementText: true, version11: entities.document.version11 });
    this.#enter(name, tokenizer, offset, true, undefined);
    tokenizer.readDeclaration();
    return undefined;
  }

  /** Expands an external parsed entity a resolver supplies; one that is not read is reported as a skipped entity. */
  #expandExternal(entity: EntityDeclaration, offset: number): EventType | undefined {
    if (!this.#options.supportExternalEntities) return EventType.ENTITY_REFERENCE;
    const { entities, errors } = this.#parts;
    const referringTokenizer = entities.current;
    let resolved;
    try {
      resolved = this.external.resolve(entityRequest(entity), this.#options.accessExternalEntities);
    } catch (error) {
      if (error instanceof ResolutionPendingError) return EventType.NEED_INPUT;
      errors.reportRefused(error, entities.locationIn(referringTokenizer, referringTokenizer.tokenStart));
    }
    if (resolved === undefined) return EventType.ENTITY_REFERENCE;
    this.#failIfExceeded(this.counter.countExternalExpansion());
    const opened = this.external.openResolved(resolved.source, resolved.systemId);
    const version11 = entities.document.version11;
    // Its size is known only as it is read, so it is counted then, as the JDK counts it.
    const text = new CountedSource(opened.text, (size, length) =>
      this.#failIfExceeded(this.counter.countExternalText(size, length))
    );
    const entityTokenizer = this.#parts.createTokenizer(text, { textDeclaration: true, version11 });
    this.#enter(entity.name, entityTokenizer, offset, false, resolved.systemId);
    entityTokenizer.readDeclaration();
    if (entityTokenizer.declaration?.version === '1.1' && !version11) {
      throw scanError(ErrorCode.WF_ENTITY_VERSION, 0, 'An XML 1.0 document cannot use an XML 1.1 entity');
    }
    const detection = opened.text.detection;
    const declaration = entityTokenizer.declaration;
    const problem = checkDeclaredEncoding(detection, declaration?.encoding);
    if (problem?.level === 'fatal') throw scanError(problem.code, 0, problem.message);
    this.#parts.processing.listener?.readExternal?.(
      entity.name,
      detection?.decoderName,
      declaration?.encoding,
      declaration?.version
    );
    return undefined;
  }

  /** Starts reading an entity's text with `tokenizer`, in place of the current text. */
  #enter(name: string, tokenizer: Tokenizer, offset: number, isInternal: boolean, systemId: string | undefined): void {
    const { entities, processing } = this.#parts;
    const parent = entities.current;
    // The names and bindings so far refer to the text being left, so slice them first.
    this.#parts.sliceBeforeLeaving(parent);
    entities.enter(name, tokenizer, offset - parent.bufferOffset, this.#parts.elements.depth, isInternal, systemId);
    processing.entityStarted(name);
    // The validator hears of an expansion it alone sees from the reference that ends it.
    if (entities.depth !== processing.validatorOnlyDepth) processing.validation?.entity(name);
  }

  /** Closes the innermost entity, whose text has ended; returns ENTITY_REFERENCE when only the validator saw it expand, else undefined. */
  endEntity(): EventType | undefined {
    const { entities, processing } = this.#parts;
    const hidden = entities.depth === processing.validatorOnlyDepth;
    const frame = entities.leave(this.#parts.elements.depth);
    if (hidden) {
      processing.validatorOnlyDepth = 0;
      this.name = this.#hiddenName;
      this.text = this.#hiddenText;
      return EventType.ENTITY_REFERENCE;
    }
    processing.entityEnded(frame.entityName, entities);
    return undefined;
  }

  /** Ends the markup-free entity whose text was the last event, telling anything that listens for entity ends. */
  endLiteral(): void {
    const name = this.#literalEntityName;
    if (name === undefined) return;
    this.#literalEntityName = undefined;
    this.#parts.processing.entityEnded(name, this.#parts.entities);
  }

  /** Throws when an entity limit has been passed, as `exceeded` reports. */
  #failIfExceeded(exceeded: ExceededLimit | undefined): void {
    if (exceeded) this.#fail(exceeded.code, exceeded.message);
  }

  /** Throws a fatal error at an index in the current text, the current token's start by default. */
  #fail(code: ErrorCode, message: string, index?: number): never {
    return fail(this.#parts.entities.current, code, message, index);
  }
}
