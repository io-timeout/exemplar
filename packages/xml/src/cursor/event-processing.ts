import type { Location } from '../errors/xml-error.ts';
import type { EntityStack } from './entity-stack.ts';
import type { EventCore } from './event-core.ts';
import { EventType } from './event-type.ts';
import type { EntityListener } from './internal.ts';
import type { StreamFilter, StreamReader } from './stream-reader.ts';
import type { DocumentValidator } from './validation.ts';

/** An entity's start or end, reported as an event with `reportEntityBoundaries`. */
interface Boundary {
  readonly type: typeof EventType.START_ENTITY | typeof EventType.END_ENTITY;
  readonly name: string;
  /** For an end, where the reference ends in the text that referred to the entity. */
  readonly location?: Location;
}

/**
 * The steps between the event core and the caller, each taken only when an option asks for it:
 *
 * - entity boundaries (`reportEntityBoundaries`): START_ENTITY and END_ENTITY events around an
 *   entity's content;
 * - coalescing (`coalescing`): a run of text, CDATA and entity text becomes one CHARACTERS event,
 *   which means reading one event past it and holding that back;
 * - validation: the validator sees every event, and may turn whitespace in element content into SPACE;
 * - filters: events a filter rejects are skipped.
 *
 * When none is asked for, `passesStraightThrough` is true and the reader calls the core directly.
 */
export class EventProcessing {
  readonly #reader: StreamReader;
  /** The core whose events are processed; see `connect`. */
  #core!: EventCore;
  /** The validator for this document, when the factory has one; see `connect`. */
  validation: DocumentValidator | undefined;
  readonly #coalescing: boolean;
  #filters: StreamFilter[] | undefined;
  /** Hears where expanded entities start and end. */
  listener: EntityListener | undefined;
  /** The entity depth of an expansion only the validator sees, when references aren't replaced; 0 when there is none. */
  validatorOnlyDepth = 0;
  /** With `reportEntityBoundaries`, the entity starts and ends not yet reported; otherwise undefined. */
  readonly #boundaries: Boundary[] | undefined;
  /** The start or end being reported as the current event. */
  #boundary: Boundary | undefined;
  /** The event the queued boundaries come before, reported after them; 0 when none waits. */
  #afterBoundaries: EventType | 0 = 0;
  /** That event's text, put back when it is reported. */
  #afterText: string | undefined;
  /** The error met where the queued boundaries end, thrown once they are reported; undefined when none waits. */
  #errorAfterBoundaries: unknown;
  /** With coalescing, the event read past the merged text, reported next; 0 when none is held. */
  #heldEvent: EventType | 0 = 0;
  /** Where the merged text that is the current event started, which the reader reports as its location. */
  textLocation: Location | undefined;
  /** With coalescing, while an asynchronous reader waits in the middle of a run of text, the text so far. */
  #pendingText: string | undefined;
  /** Where that text started. */
  #pendingLocation: Location | undefined;

  constructor(reader: StreamReader, coalescing: boolean, reportEntityBoundaries: boolean) {
    this.#reader = reader;
    this.#coalescing = coalescing;
    this.#boundaries = reportEntityBoundaries ? [] : undefined;
  }

  /** Connects the core and the validator, which the reader makes last, as making a validator may read the reader. */
  connect(core: EventCore, validation: DocumentValidator | undefined): void {
    this.#core = core;
    this.validation = validation;
  }

  /** Whether every event goes straight from the core to the caller, with no step to take. */
  get passesStraightThrough(): boolean {
    return (
      !this.#coalescing &&
      this.#boundaries === undefined &&
      this.validation === undefined &&
      this.#filters === undefined
    );
  }

  /** Whether anything hears where entities start and end. */
  get hearsEntities(): boolean {
    return this.listener !== undefined || this.#boundaries !== undefined;
  }

  /** The name of the entity whose start or end is the current event. */
  get boundaryName(): string {
    return (this.#boundary as Boundary).name;
  }

  /** Where the current event is when it is an entity's end; undefined for any other event. */
  get boundaryLocation(): Location | undefined {
    return this.#boundary?.location;
  }

  /** Adds a filter that every event must pass. */
  addFilter(filter: StreamFilter): void {
    this.#filters ??= [];
    this.#filters.push(filter);
  }

  /** The next event, after each step the options ask for: merged, among entity boundaries, validated, and past those a filter rejects. */
  next(): EventType {
    for (;;) {
      let event = this.#coalescing ? this.#nextCoalesced() : this.#nextForCaller();
      if (this.validation !== undefined) event = this.#showToValidator(event);
      if (this.#filters === undefined || event === EventType.NEED_INPUT || event === EventType.END_DOCUMENT) {
        return event;
      }
      if (this.#accepts(event)) return event;
    }
  }

  /** Whether every filter accepts the event. */
  #accepts(event: EventType): boolean {
    const reader = this.#reader;
    this.#core.event = event;
    for (const accept of this.#filters as StreamFilter[]) if (!accept(reader)) return false;
    return true;
  }

  /** The next event; with `reportEntityBoundaries`, an entity's start or end comes first, as an event of its own. */
  #nextWithBoundaries(): EventType {
    const core = this.#core;
    const queue = this.#boundaries;
    if (queue === undefined) return core.advance();
    this.#boundary = queue.shift();
    if (this.#boundary !== undefined) return this.#boundary.type;
    if (this.#afterBoundaries !== 0) {
      const event = this.#afterBoundaries;
      this.#afterBoundaries = 0;
      core.literalText = this.#afterText;
      return event;
    }
    if (this.#errorAfterBoundaries !== undefined) this.#throwErrorAfterBoundaries();
    let event;
    try {
      event = core.advance();
    } catch (error) {
      return this.#boundaryBeforeError(error);
    }
    this.#boundary = queue.shift();
    if (this.#boundary === undefined) return event;
    // The starts and ends met while reading the event come before it; its text waits, as merging text may reuse the field.
    this.#afterBoundaries = event;
    this.#afterText = core.literalText;
    core.literalText = undefined;
    return this.#boundary.type;
  }

  /** Reports the starts and ends met before an error first, as SAX hears of them; rethrows it when there are none. */
  #boundaryBeforeError(error: unknown): EventType {
    this.#boundary = (this.#boundaries as Boundary[]).shift();
    if (this.#boundary === undefined) throw error;
    this.#core.pointAtFailedToken();
    this.#errorAfterBoundaries = error;
    return this.#boundary.type;
  }

  /** Throws the error the boundaries just reported came before. */
  #throwErrorAfterBoundaries(): never {
    const error = this.#errorAfterBoundaries;
    this.#errorAfterBoundaries = undefined;
    throw error;
  }

  /** The next event the caller sees; the events of an expansion only the validator sees go to it alone. */
  #nextForCaller(): EventType {
    let event = this.#nextWithBoundaries();
    while (this.validatorOnlyDepth !== 0 && event !== EventType.NEED_INPUT) {
      this.#showToValidator(event);
      event = this.#nextWithBoundaries();
    }
    return event;
  }

  /** Tells the listener that an entity's expansion starts, and queues the boundary when it is reported. */
  entityStarted(name: string): void {
    if (this.validatorOnlyDepth !== 0) return;
    this.listener?.startEntity(name);
    this.#boundaries?.push({ type: EventType.START_ENTITY, name });
  }

  /** Tells the listener that an entity's expansion has ended, and queues the boundary, located after the reference, when it is reported. */
  entityEnded(name: string, entities: EntityStack): void {
    if (this.validatorOnlyDepth !== 0) return;
    this.listener?.endEntity(name);
    if (this.#boundaries === undefined) return;
    const referring = entities.current;
    const location = entities.locationIn(referring, referring.nextTokenStart);
    this.#boundaries.push({ type: EventType.END_ENTITY, name, location });
  }

  /** The next event with coalescing on: a run of text, CDATA and entity text becomes one CHARACTERS event, and the event after it is held back. */
  #nextCoalesced(): EventType {
    if (this.#heldEvent !== 0) return this.#releaseHeldEvent();
    const reader = this.#reader;
    const core = this.#core;
    let event = this.#nextForCaller();
    let text = this.#pendingText;
    if (text === undefined) {
      if (event !== EventType.CHARACTERS && event !== EventType.CDATA) return event;
      core.event = event;
      text = reader.text();
      this.#pendingLocation = reader.location();
      event = this.#nextForCaller();
    }
    while (event === EventType.CHARACTERS || event === EventType.CDATA) {
      core.event = event;
      text += reader.text();
      event = this.#nextForCaller();
    }
    if (event === EventType.NEED_INPUT) {
      this.#pendingText = text;
      return event;
    }
    this.#pendingText = undefined;
    this.#heldEvent = event;
    core.literalText = text;
    this.textLocation = this.#pendingLocation;
    return EventType.CHARACTERS;
  }

  /** Reports the event held back behind merged text. */
  #releaseHeldEvent(): EventType {
    const event = this.#heldEvent as EventType;
    this.#heldEvent = 0;
    this.#core.literalText = undefined;
    this.textLocation = undefined;
    return event;
  }

  /** Shows an event to the validator and returns it, as SPACE when the validator finds it is whitespace in element content. */
  #showToValidator(event: EventType): EventType {
    const validation = this.validation as DocumentValidator;
    this.#core.event = event;
    if (event === EventType.CHARACTERS || event === EventType.CDATA) {
      return validation.text(event) && event === EventType.CHARACTERS ? EventType.SPACE : event;
    }
    if (event === EventType.START_ELEMENT) validation.startElement();
    else if (event === EventType.END_ELEMENT) validation.endElement();
    else if (event === EventType.DTD) validation.dtd();
    else if (event === EventType.END_DOCUMENT) validation.endDocument();
    else if (event === EventType.COMMENT || event === EventType.PROCESSING_INSTRUCTION) validation.markup(event);
    else if (event === EventType.ENTITY_REFERENCE) validation.markup(event);
    return event;
  }
}
