import type { Limits } from '../config/options.ts';
import { ErrorCode } from '../errors/codes.ts';

/** A limit an expansion went over: the error's code and message. */
export interface ExceededLimit {
  readonly code: ErrorCode;
  readonly message: string;
}

/**
 * Counts entity expansions in one document against the limits, as they happen and as the JDK counts
 * them. Entities can nest: in the "billion laughs" document each entity refers to ten copies of the
 * next, so a few hundred bytes expand to gigabytes. Counting every expansion and the characters each
 * adds stops such a document after at most the limits' worth of work.
 */
export class EntityCounter {
  readonly #limits: Limits;
  /** How many entities have been expanded. */
  #expansions = 0;
  /** How many characters expansions have added, in all. */
  #totalSize = 0;
  /** How many events have come from inside entities. */
  #entityNodes = 0;

  constructor(limits: Limits) {
    this.#limits = limits;
  }

  /** Records an expansion of an internal general entity of `size` characters; returns the limit it goes over. */
  countGeneralExpansion(size: number): ExceededLimit | undefined {
    return this.#countExpansion() ?? this.#checkEntitySize(size, false) ?? this.#addToTotal(size);
  }

  /** Records an expansion of an internal parameter entity; one inside a markup declaration doesn't count toward the total. */
  countParameterExpansion(size: number, countsTowardTotal: boolean): ExceededLimit | undefined {
    return (
      this.#countExpansion() ??
      this.#checkEntitySize(size, true) ??
      (countsTowardTotal ? this.#addToTotal(size) : undefined)
    );
  }

  /** Records an expansion of an external entity, which counts only as one; a general entity's text counts as it is read. */
  countExternalExpansion(): ExceededLimit | undefined {
    return this.#countExpansion();
  }

  /** Records `size` more characters read from an external general entity, `lengthSoFar` of it in all; returns the limit it goes over. */
  countExternalText(size: number, lengthSoFar: number): ExceededLimit | undefined {
    return this.#checkEntitySize(lengthSoFar, false) ?? this.#addToTotal(size);
  }

  /** Counts one more expansion; returns the limit it goes over. */
  #countExpansion(): ExceededLimit | undefined {
    const limit = this.#limits.entityExpansions;
    if (++this.#expansions <= limit) return undefined;
    return { code: ErrorCode.LIMIT_ENTITY_EXPANSIONS, message: `More than ${limit} entity expansions` };
  }

  /** Checks one entity, `length` characters long so far, against its kind's limit. */
  #checkEntitySize(length: number, isParameter: boolean): ExceededLimit | undefined {
    const limit = isParameter ? this.#limits.parameterEntitySize : this.#limits.generalEntitySize;
    if (length <= limit) return undefined;
    return {
      code: isParameter ? ErrorCode.LIMIT_PARAMETER_ENTITY_SIZE : ErrorCode.LIMIT_GENERAL_ENTITY_SIZE,
      message: `An entity is longer than ${limit} characters`,
    };
  }

  /** Adds `size` characters to the total; returns the limit it goes over. */
  #addToTotal(size: number): ExceededLimit | undefined {
    const limit = this.#limits.totalEntitySize;
    this.#totalSize += size;
    if (this.#totalSize <= limit) return undefined;
    return {
      code: ErrorCode.LIMIT_TOTAL_ENTITY_SIZE,
      message: `Entities expand to more than ${limit} characters in all`,
    };
  }

  /** Records one node produced inside an entity; returns the limit it goes over. */
  countEntityNode(): ExceededLimit | undefined {
    if (++this.#entityNodes <= this.#limits.entityReferenceNodes) return undefined;
    return {
      code: ErrorCode.LIMIT_ENTITY_REPLACEMENT,
      message: `Entities produce more than ${this.#limits.entityReferenceNodes} nodes`,
    };
  }
}
