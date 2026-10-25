import type { ResolvedOptions } from '../config/options.ts';
import type { EntityDeclaration } from '../dtd/declarations.ts';
import type { DtdContext, ExternalText, Frame } from '../dtd/input.ts';
import { DtdParser } from '../dtd/parser.ts';
import type { DeclarationStore } from '../dtd/store.ts';
import { type ExternalReader, ResolutionPendingError, entityRequest, resolveRequest } from '../entities/external.ts';
import type { EntityCounter } from '../entities/limits.ts';
import type { ErrorCode } from '../errors/codes.ts';
import type { Location } from '../errors/xml-error.ts';
import type { OpenedSource } from '../input/source.ts';
import type { ResolvedSource } from '../resolvers/resolver.ts';
import type { Tokenizer } from '../tokenizer/tokenizer.ts';
import type { EntityStack } from './entity-stack.ts';
import type { ErrorReporter } from './error-reporter.ts';

/**
 * A subset for the DTD parser to read: the internal subset, read in place in the document's buffer
 * between `pos` and `end`, or the external subset, read whole from its own text.
 */
function subsetFrame(
  kind: 'internal' | 'external',
  text: string,
  pos: number,
  end: number,
  baseURI: string | undefined,
  locate: (index: number) => Location
): Frame {
  const isExternal = kind === 'external';
  return {
    text,
    pos,
    end,
    entityName: undefined,
    isExternal,
    isDocumentText: !isExternal,
    betweenDeclarations: false,
    baseURI,
    isEntityExpansion: false,
    locate,
  };
}

/**
 * Reads the DTD a DOCTYPE declares into a `DeclarationStore`: first the internal subset, between the
 * DOCTYPE's brackets, then the external subset its system id names, fetched through the resolvers.
 * The parser reads both; this class sets up their text, the access lists and the error reporting.
 *
 * An asynchronous reader may have to wait for a resolver. It then reads the DTD again from the start
 * once the answer has come (`loadAgain`), holding back the errors of the attempts that waited so that
 * each is reported once.
 */
export class DtdLoader {
  readonly #options: ResolvedOptions;
  /** The document's base URI, which the subsets' system ids resolve against. */
  readonly #baseURI: string | undefined;
  readonly #entities: EntityStack;
  readonly #errors: ErrorReporter;
  /** Whether a validator reads the document, so that the DTD's validity errors are reported. */
  readonly #validating: boolean;

  constructor(
    options: ResolvedOptions,
    opened: OpenedSource,
    entities: EntityStack,
    errors: ErrorReporter,
    validating: boolean
  ) {
    this.#options = options;
    this.#baseURI = opened.baseURI ?? opened.systemId;
    this.#entities = entities;
    this.#errors = errors;
    this.#validating = validating;
  }

  /** Reads the declarations of the DOCTYPE `tokenizer` holds into `store`, fetching external text with `external` and counting expansions with `counter`. */
  load(tokenizer: Tokenizer, store: DeclarationStore, external: ExternalReader, counter: EntityCounter): void {
    store.hasDoctype = true;
    store.isStandalone = tokenizer.declaration?.standalone === true;
    store.hasExternalSubset = tokenizer.doctype.systemId !== undefined;
    const parser = new DtdParser(store, this.#context(store, external, counter));
    if (tokenizer.doctype.subsetStart >= 0) {
      const locate = (index: number): Location => this.#entities.documentLocation(index);
      parser.parse(
        subsetFrame(
          'internal',
          tokenizer.buffer,
          tokenizer.doctype.subsetStart,
          tokenizer.doctype.subsetEnd,
          this.#baseURI,
          locate
        )
      );
    }
    const subset = this.#externalSubset(tokenizer, store, external);
    if (subset === undefined) return;
    store.hasExternalSubset = true;
    const { text, systemId, locate } = subset;
    store.items.push({ kind: 'startEntity', name: '[dtd]' });
    parser.parse(subsetFrame('external', text, 0, text.length, systemId, locate));
    store.items.push({ kind: 'endEntity', name: '[dtd]' });
  }

  /** As `load`, for an asynchronous reader, which calls it again each time a resolver answers; returns false while one has yet to. */
  loadAgain(tokenizer: Tokenizer, store: DeclarationStore, external: ExternalReader, counter: EntityCounter): boolean {
    const errors = this.#errors;
    errors.holdErrors();
    try {
      this.load(tokenizer, store, external, counter);
    } catch (error) {
      if (error instanceof ResolutionPendingError) {
        errors.discardHeldErrors();
        return false;
      }
      errors.releaseHeldErrors();
      throw error;
    }
    errors.releaseHeldErrors();
    return true;
  }

  /** Reads the external subset the DOCTYPE names, or the one a resolver offers when it names none. */
  #externalSubset(tokenizer: Tokenizer, store: DeclarationStore, external: ExternalReader): ExternalText | undefined {
    if (tokenizer.doctype.systemId === undefined) {
      const offered = external.externalSubset(
        tokenizer.buffer.slice(tokenizer.nameStart, tokenizer.nameEnd),
        this.#baseURI
      );
      return offered && this.#readResolved(external, offered, []);
    }
    const request = resolveRequest('[dtd]', tokenizer.doctype.publicId, tokenizer.doctype.systemId, this.#baseURI);
    let resolved;
    try {
      resolved = external.resolve(request, this.#options.accessExternalDTD);
    } catch (error) {
      this.#errors.reportRefused(error, this.#entities.locationIn(tokenizer, tokenizer.tokenStart));
    }
    if (resolved === undefined) store.hasUnreadDeclarations = true;
    return resolved && this.#readResolved(external, resolved, []);
  }

  /** What the DTD parser needs: the declarations to fill, entity expansion, error reporting and parameter entities. */
  #context(store: DeclarationStore, external: ExternalReader, counter: EntityCounter): DtdContext {
    const errors = this.#errors;
    const error = (code: ErrorCode, message: string, location: Location): void => errors.error(code, message, location);
    return {
      store,
      known: this.#options.entities,
      counter,
      version11: this.#entities.document.version11,
      namespaceAware: this.#options.namespaceAware,
      fail: (code, message, location, entities) => errors.fatal(code, message, location, entities),
      error,
      readParameterEntity: (entity) => this.#readParameterEntity(external, entity),
      ...(this.#validating && { invalid: error }),
    };
  }

  /** Reads an external parameter entity, as the DTD access list allows; undefined when it is not read. */
  #readParameterEntity(external: ExternalReader, entity: EntityDeclaration): ExternalText | undefined {
    const request = entityRequest(entity, `%${entity.name}`);
    const resolved = external.resolve(request, this.#options.accessExternalDTD);
    return resolved && this.#readResolved(external, resolved, [request.name]);
  }

  /** Reads a resolved external subset or parameter entity as text; its fatal errors name `entities` as the ones being read. */
  #readResolved(
    external: ExternalReader,
    resolved: { source: ResolvedSource; systemId?: string },
    entities: string[]
  ): ExternalText {
    const opened = external.openResolved(resolved.source, resolved.systemId);
    return external.readText(opened, resolved.systemId, this.#entities.document.version11, (code, message, location) =>
      this.#errors.fatal(code, message, location, entities)
    );
  }
}
