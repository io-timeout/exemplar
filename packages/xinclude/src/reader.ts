import {
  type DtdItem,
  ErrorCode,
  EventType,
  ResolutionError,
  type ResolvedSource,
  type Source,
  type StreamFilter,
  XMLError,
} from '@exemplarjs/xml';
import {
  ADD_FILTER,
  type AsyncOpenedSource,
  type DecoderRegistry,
  type EntityListener,
  INCLUDED_DECLARATIONS,
  LISTEN_ENTITIES,
  type OpenedSource,
  type ResolvedOptions,
  isCharacterData,
  isAllWhitespace,
  openSource,
  escapeAndResolveURI,
} from '@exemplarjs/xml/internal';
import { ErrorFactory } from '@exemplarjs/xml/internal';
import { Declarations } from './declarations.ts';
import {
  type IncludeAttributes,
  attributeProblem,
  headersOf,
  inclusionKey,
  includeAttributesOf,
  isDocumentLoop,
  isIntraDocumentLoop,
} from './include.ts';
import { Inclusion } from './inclusion.ts';
import { type NamespaceDeclaration, NO_FIXUPS, endTagOverlay, topOverlay } from './overlay.ts';
import { type PointerPart, Selection, parsePointer } from './pointer.ts';
import {
  type FoundResource,
  type Headers,
  Pending,
  ResourceError,
  type Resume,
  contentOf,
  findResource,
  isStreamOnly,
} from './resources.ts';
import { type Parent, type Scope, ScopeStack } from './scopes.ts';
import { SplicingReader } from './splice.ts';
import { TextInclusionError, includedText } from './text.ts';

// Module-level constants, so V8 can inline them; imported bindings are read again on every use.
const { START_ELEMENT, END_ELEMENT, CHARACTERS, SPACE, START_DOCUMENT, END_DOCUMENT, DTD, NEED_INPUT } = EventType;

/** The XInclude namespace. */
export const XINCLUDE_NAMESPACE = 'http://www.w3.org/2001/XInclude';

/** What `xincludeProcessor()` takes: whether included elements get `xml:base` and `xml:lang`. */
export interface XIncludeSettings {
  readonly fixupBaseURIs: boolean;
  readonly fixupLanguage: boolean;
}

/** Where a reader sits among inclusions: the resources being included around it, for finding loops. */
interface InclusionContext {
  readonly settings: XIncludeSettings;
  /** The inclusion keys of the documents being included around this one, outermost first. */
  readonly chain: readonly string[];
  /** Whether the reader, and so the readers of included documents, may wait for promises and streams. */
  readonly async: boolean;
}

/** Returned by a step that has nothing for the caller, so the reader steps again. */
const SKIP = -1;

/** The depth of a fallback not being read. */
const NO_DEPTH = -1;

/** An open xi:include: its own events are passed over, unless its fallback is in use and being read. */
interface OpenInclude {
  /** The depth of the xi:include element. */
  readonly depth: number;
  readonly parent: Parent;
  /** Why the inclusion failed, and the code to fail with when no fallback stands in; undefined when it succeeded. */
  failure: { readonly code: ErrorCode; readonly message: string } | undefined;
  /** How many xi:fallback children it has had; more than one is fatal. */
  fallbackCount: number;
  /** The depth of the xi:fallback being read, or NO_DEPTH. */
  fallbackDepth: number;
  /** The namespace declarations added to the fallback element at the top, for its end tag. */
  declarations: readonly NamespaceDeclaration[];
  /** For a root xi:include, the elements it has been replaced with so far. */
  rootElementCount: number;
}

/**
 * A reader that carries out XInclude processing as it reads: each xi:include element gives way to
 * what it points to. Reading `<doc><xi:include href="part.xml"/></doc>` gives the events of `<doc>`,
 * then those of part.xml's document element, then `</doc>`, as if part.xml's element had been written
 * there.
 *
 * An included XML document is read by a reader of its own, of this same class so that its own
 * xi:includes are processed too; while it is read, this reader's accessors answer for that reader's
 * event (see `SplicingReader`). A resource that cannot be read leaves the xi:include to its
 * xi:fallback, whose content is read in its place; with no fallback the error is fatal.
 */
export class XIncludeReader extends SplicingReader {
  /** The source this document was read from, to read it again for an xi:include into itself. */
  readonly #source: Source | undefined;
  readonly #options: ResolvedOptions;
  readonly #registry: DecoderRegistry;
  readonly #context: InclusionContext;
  readonly #documentURI: string;
  /** The document being included, if any. */
  #inclusion: Inclusion | undefined;
  /** The xi:include elements open around the current event, innermost last. */
  readonly #openIncludes: OpenInclude[] = [];
  #filters: StreamFilter[] | undefined;
  #listener: EntityListener | undefined;
  /** The resolver's answer the reader waits for, if any. */
  readonly #pending = new Pending();
  /** The unparsed entities and notations the document declares, and those included content has brought in. */
  readonly #declarations = new Declarations(this, (what) => this.#declaredDifferently(what));
  /** For an isIntraDocument-document reference: what the pointer selects from this document's source, before its inclusions. */
  readonly #selection: Selection | undefined;
  /** What is in scope above the selected element, once it is found. */
  #origin: Scope | undefined;
  /** Whether the selected element has ended, which ends what this reader gives. */
  #selectionEnded = false;
  /** The error that ended the document, thrown again by every later call. */
  #endedBy: XMLError | undefined;
  /** What is in scope at each of the document's own open elements. */
  readonly #scopes: ScopeStack;

  constructor(
    source: Source | undefined,
    opened: OpenedSource,
    options: ResolvedOptions,
    registry: DecoderRegistry,
    input: AsyncOpenedSource | undefined,
    context: InclusionContext,
    pointer: readonly PointerPart[] = []
  ) {
    super(opened, options, registry, input);
    if (!options.namespaceAware) throw ErrorFactory.create(TypeError, 'XInclude needs a namespace-aware reader');
    this.#source = source;
    this.#options = options;
    this.#registry = registry;
    this.#documentURI = opened.systemId ?? opened.baseURI ?? '';
    this.#context = context;
    this.#scopes = new ScopeStack(this.#documentURI);
    if (pointer.length > 0) this.#selection = new Selection(pointer);
  }

  /** What is in scope above the element a source selection gives. @internal */
  _selectionOrigin(): Scope {
    return this.#origin as Scope;
  }

  /** After a source selection: whether it gave an element, or the path of one only a later part identified. @internal */
  _selectionOutcome(): 'selected' | readonly number[] | undefined {
    // Asked only of a reader for a reference into its own document, which always has a pointer.
    return (this.#selection as Selection).outcome();
  }

  /** The unparsed entities and notations this document declares or has included. @internal */
  _declarations(): Declarations {
    return this.#declarations;
  }

  // Reading

  override next(): EventType {
    if (this.#endedBy !== undefined) throw this.#endedBy;
    try {
      for (;;) {
        const event = this.#readStep();
        if (event === SKIP) continue;
        this.setEvent(event as EventType);
        if (event === NEED_INPUT || event === END_DOCUMENT || this.#filtersAccept()) return event as EventType;
      }
    } catch (error) {
      // An XMLError thrown here ends the document (§1.2); anything else, such as misuse, does not.
      if (error instanceof XMLError) this.#endedBy = error;
      throw error;
    }
  }

  /** Whether every filter accepts the current event. */
  #filtersAccept(): boolean {
    for (const filter of this.#filters ?? []) if (!filter(this)) return false;
    return true;
  }

  /** The next event from a resolver's answer, an included document or the document's own; SKIP when there is none. */
  #readStep(): number {
    this.clearChanges();
    if (this.#pending.waiting) return this.#tryInclusionStep(() => this.#pending.resume());
    const inclusion = this.#inclusion;
    if (inclusion !== undefined && !inclusion.done) return this.#includedEvent(inclusion);
    if (inclusion !== undefined) this.#endInclusion(inclusion);
    this.readFrom(undefined);
    if (this.#selectionEnded) return END_DOCUMENT;
    const event = super.next();
    // Accessors answer for the event read while it is looked at.
    this.setEvent(event);
    if (event === NEED_INPUT) return event;
    const selection = this.#selection;
    if (selection !== undefined && selection.depth === undefined) return this.#seekSelection(selection, event);
    return this.#ownEvent(event);
  }

  /** Waits for a resolver's answer, or for an included document to read on. */
  override async fill(): Promise<void> {
    const answer = this.#pending.fill();
    if (answer !== undefined) return answer;
    const inclusion = this.#inclusion;
    if (inclusion !== undefined && !inclusion.done) return inclusion.reader.fill();
    return super.fill();
  }

  /** An own event before a source selection: passed over, while the pointer looks for its element. */
  #seekSelection(selection: Selection, event: EventType): number {
    if (event === END_DOCUMENT) return event;
    if (event === END_ELEMENT) {
      this.#scopes.leave();
      selection.end();
      return SKIP;
    }
    if (event !== START_ELEMENT) return SKIP;
    this.#scopes.enter(this);
    const depth = this.#scopes.depth;
    if (!selection.select(this, depth)) return SKIP;
    this.#origin = this.#scopes.scopeAt(depth - 1);
    return this.#ownStartTag();
  }

  /** An event of the document's own. */
  #ownEvent(event: EventType): number {
    if (event === START_ELEMENT) {
      this.#scopes.enter(this);
      return this.#ownStartTag();
    }
    const openInclude = this.#openIncludes.at(-1);
    if (event === END_ELEMENT) {
      const depth = this.#scopes.depth;
      const result = this.#ownEndTag(openInclude);
      if (depth === this.#selection?.depth) this.#selectionEnded = true;
      return result;
    }
    // Inside an xi:include, only a fallback in use is read.
    if (openInclude?.fallbackDepth === NO_DEPTH && event !== END_DOCUMENT) return SKIP;
    const atRoot =
      openInclude !== undefined && openInclude.parent.isRoot && this.#scopes.depth === openInclude.fallbackDepth;
    if (atRoot && isCharacterData(event)) return this.#textBesideRoot(this.ownText());
    return event;
  }

  /** Text beside the document element: white space, reported as the cursor reports the prolog's; anything else is fatal. */
  #textBesideRoot(text: string): number {
    if (!isAllWhitespace(text)) this.#failTextAtRoot();
    return this.#options.reportPrologWhitespace ? SPACE : SKIP;
  }

  /** An own start tag, once its scope is recorded. */
  #ownStartTag(): number {
    const openInclude = this.#openIncludes.at(-1);
    if (openInclude?.fallbackDepth === NO_DEPTH) return this.#startInsideInclude(openInclude);
    if (this.ownNamespaceURI() === XINCLUDE_NAMESPACE) return this.#xincludeElement();
    if (openInclude !== undefined && this.#scopes.depth === openInclude.fallbackDepth + 1)
      this.#fixUpFallbackTop(openInclude);
    return START_ELEMENT;
  }

  /** An own end tag: of an xi:include, of its fallback, or of an element given in either's place. */
  #ownEndTag(openInclude: OpenInclude | undefined): number {
    const depth = this.#scopes.leave();
    if (openInclude === undefined) return END_ELEMENT;
    if (depth === openInclude.depth) return this.#endInclude(openInclude);
    if (depth === openInclude.fallbackDepth) {
      openInclude.fallbackDepth = NO_DEPTH;
      return SKIP;
    }
    if (openInclude.fallbackDepth === NO_DEPTH) return SKIP;
    if (depth === openInclude.fallbackDepth + 1) this.setOverlay(endTagOverlay(openInclude.declarations));
    return END_ELEMENT;
  }

  /** The end of an xi:include: what it was replaced with is complete, or its fallback is missing. */
  #endInclude(openInclude: OpenInclude): number {
    this.#openIncludes.pop();
    if (openInclude.failure !== undefined && openInclude.fallbackCount === 0)
      this.#fatal(openInclude.failure.code, openInclude.failure.message);
    if (openInclude.parent.isRoot && openInclude.rootElementCount !== 1) this.#failNotOneRoot();
    return SKIP;
  }

  /** A start tag inside an xi:include being passed over: only its children in the XInclude namespace matter. */
  #startInsideInclude(openInclude: OpenInclude): number {
    if (this.#scopes.depth !== openInclude.depth + 1 || this.ownNamespaceURI() !== XINCLUDE_NAMESPACE) return SKIP;
    const local = this.ownLocalName();
    if (local !== 'fallback') this.#fatal(ErrorCode.XINCLUDE_STRUCTURE, `xi:${local} cannot be inside xi:include`);
    if (++openInclude.fallbackCount > 1)
      this.#fatal(ErrorCode.XINCLUDE_STRUCTURE, 'xi:include holds more than one xi:fallback');
    if (openInclude.failure !== undefined) openInclude.fallbackDepth = this.#scopes.depth;
    return SKIP;
  }

  /** A start tag in the XInclude namespace outside any xi:include being passed over. */
  #xincludeElement(): number {
    const local = this.ownLocalName();
    if (local === 'fallback') this.#fatal(ErrorCode.XINCLUDE_STRUCTURE, 'xi:fallback must be a child of xi:include');
    if (local !== 'include') return START_ELEMENT;
    return this.#startInclude();
  }

  // Own elements

  /** The include parent of an xi:include at the current depth. */
  #includeParent(): Parent {
    const parentDepth = this.#scopes.depth - 1;
    return { ...this.#scopes.scopeAt(parentDepth), isRoot: parentDepth === 0 && this.#selection === undefined };
  }

  /** A start tag at the top of a fallback in use: it keeps the namespaces the xi: elements around it declared. */
  #fixUpFallbackTop(openInclude: OpenInclude): void {
    openInclude.declarations = this.#setTopOverlay(
      openInclude,
      this,
      this.#scopes.scopeAt(this.#scopes.depth),
      NO_FIXUPS
    );
  }

  /** Sets the overlay for a start tag at the top of what replaces an xi:include; returns its declarations, for its end tag. */
  #setTopOverlay(
    openInclude: OpenInclude,
    tag: XIncludeReader,
    scope: Scope,
    fixups: XIncludeSettings
  ): readonly NamespaceDeclaration[] {
    // Only one element may replace an xi:include at the root.
    if (openInclude.parent.isRoot && ++openInclude.rootElementCount > 1) this.#failNotOneRoot();
    const overlay = topOverlay(tag, scope, openInclude.parent, fixups, this.#options.namespacePrefixes);
    this.setOverlay(overlay);
    return overlay?.declarations ?? [];
  }

  // xi:include

  /** Starts replacing an xi:include: checks its attributes, then reads the resource it points to. */
  #startInclude(): number {
    const include = includeAttributesOf(this);
    const problem = attributeProblem(include);
    if (problem !== undefined) this.#fatal(ErrorCode.XINCLUDE_ATTRIBUTE, problem);
    const parent = this.#includeParent();
    const depth = this.#scopes.depth;
    this.#openIncludes.push(newOpenInclude(depth, parent));
    const base = this.#scopes.baseAt(depth);
    return this.#tryInclusionStep(() =>
      include.parse === 'text' ? this.#acquireText(include, base, parent) : this.#acquireXml(include, base, parent)
    );
  }

  /** Gets the resource a `parse="text"` xi:include points to, and gives it as text. */
  #acquireText(include: IncludeAttributes, base: string, parent: Parent): number {
    const { href, encoding } = include;
    return this.#acquire(href === '', href, base, headersOf(include), (source) =>
      this.#includeText(source, encoding, parent.isRoot)
    );
  }

  /** Gets the document a `parse="xml"` xi:include points to and opens it, failing on a loop before and after. */
  #acquireXml(include: IncludeAttributes, base: string, parent: Parent): number {
    const { href, xpointer } = include;
    const parts = xpointer === undefined ? [] : parsePointer(xpointer);
    if (parts === undefined) {
      throw ErrorFactory.create(
        ResourceError,
        `${xpointer as string} is not a well-formed XPointer`,
        ErrorCode.XINCLUDE_POINTER
      );
    }
    const isIntraDocument = href === '';
    // Fails on an inclusion that leads back to one in the chain.
    const checkLoop = (uri: string): void => {
      const chain = this.#context.chain;
      const looped = isIntraDocument ? isIntraDocumentLoop(chain, uri, xpointer) : isDocumentLoop(chain, uri);
      if (looped) this.#fatal(ErrorCode.XINCLUDE_LOOP, `${uri} includes itself`);
    };
    checkLoop(isIntraDocument ? this.#documentURI : (escapeAndResolveURI(href, base || undefined) ?? href));
    return this.#acquire(isIntraDocument, href, base, headersOf(include), (source, uri) => {
      checkLoop(uri);
      this.#inclusion = this.#openInclusion(source, uri, parts, parent, inclusionKey(uri, xpointer), isIntraDocument);
      return SKIP;
    });
  }

  /** Runs a step of an inclusion; a resource error leaves the xi:include to its fallback. */
  #tryInclusionStep(step: () => number): number {
    try {
      return step();
    } catch (error) {
      // A read the access list refuses is a resource error, which a fallback answers; other refusals are fatal.
      if (error instanceof ResolutionError && error.code !== ErrorCode.ACCESS_REFUSED) {
        this.#fatal(error.code, error.message);
      }
      const failure = ErrorFactory.expect(error, ResourceError, ResolutionError);
      this.#markFailed(failure instanceof ResourceError ? failure.code : ErrorCode.XINCLUDE_RESOURCE, failure.message);
      return SKIP;
    }
  }

  /** Marks the innermost xi:include as failed, for its fallback to stand in. */
  #markFailed(code: ErrorCode, message: string): void {
    (this.#openIncludes.at(-1) as OpenInclude).failure = { code, message };
  }

  /** Reads a resource as text, which cannot replace the document element, even when it is empty. */
  #includeText(source: ResolvedSource, encoding: string | undefined, root: boolean): number {
    let text = '';
    try {
      text = includedText(source, encoding, super.version() === '1.1', this.#registry);
    } catch (error) {
      const failure = ErrorFactory.expect(error, TextInclusionError);
      if (!failure.isFatal) throw ErrorFactory.create(ResourceError, failure.message);
      this.#fatal(ErrorCode.XINCLUDE_TEXT, failure.message);
    }
    this.setText(text);
    if (root) this.#failTextAtRoot();
    return text === '' ? SKIP : CHARACTERS;
  }

  /** Starts including a document, whole or as a pointer selects. */
  #openInclusion(
    source: ResolvedSource,
    uri: string,
    parts: readonly PointerPart[],
    parent: Parent,
    key: string,
    isIntraDocument: boolean
  ): Inclusion {
    // A pointer into another document reads it after its inclusions; one into this document, its source.
    const reader = this.#includedReader(source, uri, key, isIntraDocument ? parts : []);
    return new Inclusion(reader, uri, parts, parent, key, isIntraDocument);
  }

  /** A reader for an included document, which carries on the chain of inclusions and the listener for entities. */
  #includedReader(source: ResolvedSource, uri: string, key: string, pointer: readonly PointerPart[]): XIncludeReader {
    const object = { ...source, systemId: uri };
    const opened = openSource(object, this.#registry);
    const context = { ...this.#context, chain: [...this.#context.chain, key] };
    // An asynchronous reader reads included documents with asynchronous readers, which wait for resolvers too.
    const input = this.#context.async ? { opened, queue: undefined, pump: undefined } : undefined;
    const reader = new XIncludeReader(object, opened, this.#options, this.#registry, input, context, pointer);
    if (this.#listener !== undefined) reader[LISTEN_ENTITIES](this.#listener);
    return reader;
  }

  /** Gets a resource, the current document for an empty href, and goes on with it at once or once a resolver answers. */
  #acquire(isIntraDocument: boolean, href: string, base: string, headers: Headers, resume: Resume): number {
    const { uri, source: found } = isIntraDocument
      ? this.#thisDocument()
      : findResource(this.#options, href, base, headers);
    const promised = found instanceof Promise;
    if (!promised && !isStreamOnly(found)) return resume(found, found.systemId ?? uri);
    if (!this.#context.async) {
      const how = promised ? 'with a promise' : 'with a stream';
      throw ErrorFactory.create(
        TypeError,
        `The resolver for ${uri} answers ${how}, which needs an asynchronous reader`
      );
    }
    return this.#pending.wait(uri, found, resume);
  }

  /** The current document again, for an xi:include whose href is empty: from its source, or from a resolver. */
  #thisDocument(): FoundResource {
    const uri = this.#documentURI;
    const source = contentOf(this.#source);
    if (source !== undefined) return { uri, source };
    if (uri !== '') return findResource(this.#options, uri, uri, {});
    throw ErrorFactory.create(ResourceError, 'The document cannot be read again to include part of itself');
  }

  // Included documents

  /** The next event of the included document, as this reader gives it; SKIP for one it passes over. */
  #includedEvent(inclusion: Inclusion): number {
    const reader = inclusion.reader;
    const event = reader.next();
    this.readFrom(reader);
    this.setEvent(event);
    switch (event) {
      case START_ELEMENT: {
        const given = inclusion.enter();
        if (given === 'skipped') return SKIP;
        if (given === 'top') this.#fixUpIncludedTop(inclusion);
        return this.#giveIncludedStartTag(reader);
      }
      case END_ELEMENT: {
        const given = inclusion.leave();
        if (given === 'skipped') return SKIP;
        if (given === 'top') this.setOverlay(endTagOverlay(inclusion.declarations));
        return END_ELEMENT;
      }
      case END_DOCUMENT: {
        return this.#includedDocumentEnd(inclusion);
      }
      case START_DOCUMENT:
      case DTD: {
        return SKIP;
      }
      case NEED_INPUT: {
        return event;
      }
      default: {
        return this.#includedContent(inclusion, event);
      }
    }
  }

  /** Text, comments and PIs: given inside the selected element, and for a whole document at its top level too. */
  #includedContent(inclusion: Inclusion, event: EventType): number {
    if (!inclusion.givesContent()) return SKIP;
    // An included document's top-level white space is dropped, unless it now lies outside the document element.
    if (inclusion.scopes.depth > 0 || !isCharacterData(event)) return event;
    return inclusion.parent.isRoot ? this.#textBesideRoot(inclusion.reader.text()) : SKIP;
  }

  /** An included start tag about to be given: the unparsed entities and notations it names join this document's. */
  #giveIncludedStartTag(reader: XIncludeReader): number {
    this.#declarations.addNamedBy(reader, reader._declarations());
    return START_ELEMENT;
  }

  /** Fails on a declaration the included document makes differently from this one. */
  #declaredDifferently(what: string): never {
    return this.#fatal(ErrorCode.XINCLUDE_DECLARATION, `${what} is declared differently in the included document`);
  }

  /** The included document has ended: done, or a pointer found nothing, or found only what a later part identifies. */
  #includedDocumentEnd(inclusion: Inclusion): number {
    const outcome = inclusion.end();
    if (outcome === 'selected') return SKIP;
    if (outcome === undefined) {
      this.#markFailed(ErrorCode.XINCLUDE_POINTER, 'The pointer identifies nothing in the included document');
      return SKIP;
    }
    return this.#rereadForLaterPart(inclusion, outcome);
  }

  /** Reads an included document again, to give the element at the child sequence the winning part identified. */
  #rereadForLaterPart(inclusion: Inclusion, steps: readonly number[]): number {
    inclusion.reader.close();
    const part: PointerPart = { kind: 'element', id: undefined, steps };
    const { uri, parent, key, isIntraDocument } = inclusion;
    return this.#tryInclusionStep(() =>
      this.#acquire(isIntraDocument, uri, uri, {}, (source) => {
        this.#inclusion = this.#openInclusion(source, uri, [part], parent, key, isIntraDocument);
        return SKIP;
      })
    );
  }

  /** Closes a finished inclusion's reader. */
  #endInclusion(inclusion: Inclusion): void {
    inclusion.reader.close();
    this.#inclusion = undefined;
  }

  /** A start tag at the top of what an inclusion gives: fixed up with xml:base, xml:lang and the namespaces it needs. */
  #fixUpIncludedTop(inclusion: Inclusion): void {
    const { reader, scopes } = inclusion;
    const openInclude = this.#openIncludes.at(-1) as OpenInclude;
    inclusion.declarations = this.#setTopOverlay(
      openInclude,
      reader,
      scopes.scopeAt(scopes.depth),
      this.#context.settings
    );
  }

  /** Fails on an xi:include at the root that is replaced with no element or several. */
  #failNotOneRoot(): never {
    return this.#fatal(ErrorCode.XINCLUDE_ROOT, 'The document element must be replaced with exactly one element');
  }

  /** Fails on text that would stand beside the document element. */
  #failTextAtRoot(): never {
    return this.#fatal(ErrorCode.XINCLUDE_ROOT, 'Text cannot replace the document element');
  }

  /** Throws a fatal XInclude error at the current event, telling the error handler first. */
  #fatal(code: ErrorCode, message: string): never {
    const error = ErrorFactory.create(XMLError, code, message, this.location());
    this.#options.errorHandler.fatalError?.(error);
    throw error;
  }

  // Hooks for the factory, filters, entity listeners and the DOM

  override close(): void {
    this.#inclusion?.reader.close();
    super.close();
  }

  override [ADD_FILTER](filter: StreamFilter): void {
    this.#filters ??= [];
    this.#filters.push(filter);
  }

  override [LISTEN_ENTITIES](listener: EntityListener): void {
    this.#listener = listener;
    super[LISTEN_ENTITIES](this.#ownEntities(listener));
  }

  /** Passes on the entities expanded in the document's own content, not those in content an xi:include ignores (§3.1). */
  #ownEntities(listener: EntityListener): EntityListener {
    const ignored = (): boolean => this.#openIncludes.at(-1)?.fallbackDepth === NO_DEPTH;
    return {
      startEntity: (name) => {
        if (!ignored()) listener.startEntity(name);
      },
      endEntity: (name) => {
        if (!ignored()) listener.endEntity(name);
      },
      readExternal: (name, inputEncoding, xmlEncoding, xmlVersion) =>
        listener.readExternal?.(name, inputEncoding, xmlEncoding, xmlVersion),
    };
  }

  override [INCLUDED_DECLARATIONS](): readonly DtdItem[] {
    return this.#declarations.included;
  }
}

/** The record of an xi:include at a depth, before anything is known of what replaces it. */
function newOpenInclude(depth: number, parent: Parent): OpenInclude {
  return {
    depth,
    parent,
    failure: undefined,
    fallbackCount: 0,
    fallbackDepth: NO_DEPTH,
    declarations: [],
    rootElementCount: 0,
  };
}
