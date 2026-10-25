import { EventType, type Location } from '@exemplarjs/xml';
import {
  StreamReader as Cursor,
  EVENT_OFFSET,
  EVENT_POSITION,
  type LineSegment,
  isIndex,
  isAllWhitespace,
  outOfRange,
} from '@exemplarjs/xml/internal';
import type { AddedAttribute, NamespaceDeclaration, Overlay } from './overlay.ts';

// Module-level constants, so V8 can inline them; imported bindings are read again on every use.
const { START_ELEMENT, END_ELEMENT, SPACE, START_DOCUMENT, END_DOCUMENT } = EventType;

// Keys for the splicing state, private to this module: out of Object.keys and JSON, and clear of StreamReader's names.
const EVENT: unique symbol = Symbol('event');
const VIEW: unique symbol = Symbol('view');
const INSERTED_TEXT: unique symbol = Symbol('insertedText');
const OVERLAY: unique symbol = Symbol('overlay');

/**
 * A cursor that can give another cursor's event, or text, in place of the one it read, with tags
 * changed by an overlay. XInclude needs this: while an included document is read, the including
 * reader's accessors (`name()`, `attributeValue()`, …) answer for the included reader's event, and the
 * top included element gains its fix-up attributes, without copying anything.
 */
export class SplicingReader extends Cursor {
  /** The event given. */
  private [EVENT]: EventType = START_DOCUMENT;
  /** Where accessors read: another cursor, or this one's own event when undefined. */
  private [VIEW]: Cursor | undefined;
  /** Text given in place of an event. */
  private [INSERTED_TEXT]: string | undefined;
  /** How the current start or end tag differs from the one read. */
  private [OVERLAY]: Overlay | undefined;

  /** Sets the event given. */
  protected setEvent(event: EventType): void {
    this[EVENT] = event;
  }

  /** Makes accessors read another cursor's current event, or this one's own when undefined. */
  protected readFrom(view: Cursor | undefined): void {
    this[VIEW] = view;
  }

  /** Starts an event with no overlay and no text in place of the one read. */
  protected clearChanges(): void {
    this[OVERLAY] = undefined;
    this[INSERTED_TEXT] = undefined;
  }

  /** Changes the current start or end tag with an overlay. */
  protected setOverlay(overlay: Overlay | undefined): void {
    this[OVERLAY] = overlay;
  }

  /** Gives text in place of the event read. */
  protected setText(text: string): void {
    this[INSERTED_TEXT] = text;
  }

  /** The local name of this cursor's own current element, whatever is given in its place. */
  protected ownLocalName(): string {
    return super.localName();
  }

  /** The namespace URI of this cursor's own current element, whatever is given in its place. */
  protected ownNamespaceURI(): string {
    return super.namespaceURI();
  }

  /** The text of this cursor's own current event, whatever is given in its place. */
  protected ownText(): string {
    return super.text();
  }

  override eventType(): EventType {
    return this[EVENT];
  }

  override hasNext(): boolean {
    return this[EVENT] !== END_DOCUMENT;
  }

  override [EVENT_POSITION](): LineSegment | Location {
    return this[VIEW] === undefined ? super[EVENT_POSITION]() : this[VIEW][EVENT_POSITION]();
  }

  override get [EVENT_OFFSET](): number {
    return this[VIEW] === undefined ? super[EVENT_OFFSET] : this[VIEW][EVENT_OFFSET];
  }

  override name(): string {
    if (this[INSERTED_TEXT] !== undefined) return '';
    return this[VIEW] === undefined ? super.name() : this[VIEW].name();
  }

  override localName(): string {
    if (this[INSERTED_TEXT] !== undefined) return '';
    return this[VIEW] === undefined ? super.localName() : this[VIEW].localName();
  }

  override prefix(): string {
    if (this[INSERTED_TEXT] !== undefined) return '';
    return this[VIEW] === undefined ? super.prefix() : this[VIEW].prefix();
  }

  override namespaceURI(index?: number): string {
    if (index === undefined) {
      if (this[INSERTED_TEXT] !== undefined) return '';
      return this[VIEW] === undefined ? super.namespaceURI() : this[VIEW].namespaceURI();
    }
    const mapped = this.#mapDeclarationIndex(index);
    if (typeof mapped !== 'number') return mapped[1];
    return this[VIEW] === undefined ? super.namespaceURI(mapped) : this[VIEW].namespaceURI(mapped);
  }

  /** How many declarations the start or end tag read has, before the overlay's. */
  #baseNamespaceCount(): number {
    return this[VIEW] === undefined ? super.namespaceCount() : this[VIEW].namespaceCount();
  }

  override namespaceCount(): number {
    const event = this[EVENT];
    if (event !== START_ELEMENT && event !== END_ELEMENT) return 0;
    return this.#baseNamespaceCount() + (this[OVERLAY]?.declarations.length ?? 0);
  }

  override namespacePrefix(index: number): string {
    const mapped = this.#mapDeclarationIndex(index);
    if (typeof mapped !== 'number') return mapped[0];
    return this[VIEW] === undefined ? super.namespacePrefix(mapped) : this[VIEW].namespacePrefix(mapped);
  }

  /** Maps a declaration index through the overlay: the index read, or the declaration added; a RangeError past the count. */
  #mapDeclarationIndex(index: number): number | NamespaceDeclaration {
    if (!isIndex(index) || index >= this.namespaceCount()) return outOfRange('Namespace', index);
    const base = this.#baseNamespaceCount();
    return index < base ? index : (this[OVERLAY]?.declarations[index - base] as NamespaceDeclaration);
  }

  override attributeCount(): number {
    if (this[EVENT] !== START_ELEMENT) return 0;
    const overlay = this[OVERLAY];
    if (overlay !== undefined) return overlay.kept.length + overlay.added.length;
    return this[VIEW] === undefined ? super.attributeCount() : this[VIEW].attributeCount();
  }

  /** Maps an attribute index through the overlay: the index read, which the reader read checks, or the attribute added. */
  #mapAttributeIndex(index: number): number | AddedAttribute {
    if (this[EVENT] !== START_ELEMENT) return outOfRange('Attribute', index);
    const overlay = this[OVERLAY];
    if (overlay === undefined) return index;
    if (!isIndex(index)) return outOfRange('Attribute', index);
    if (index < overlay.kept.length) return overlay.kept[index] as number;
    return overlay.added[index - overlay.kept.length] ?? outOfRange('Attribute', index);
  }

  override attributeName(index: number): string {
    const mapped = this.#mapAttributeIndex(index);
    if (typeof mapped !== 'number') return mapped.name;
    return this[VIEW] === undefined ? super.attributeName(mapped) : this[VIEW].attributeName(mapped);
  }

  override attributeLocalName(index: number): string {
    const mapped = this.#mapAttributeIndex(index);
    if (typeof mapped !== 'number') return mapped.localName;
    return this[VIEW] === undefined ? super.attributeLocalName(mapped) : this[VIEW].attributeLocalName(mapped);
  }

  override attributePrefix(index: number): string {
    const mapped = this.#mapAttributeIndex(index);
    if (typeof mapped !== 'number') return mapped.prefix;
    return this[VIEW] === undefined ? super.attributePrefix(mapped) : this[VIEW].attributePrefix(mapped);
  }

  override attributeNamespace(index: number): string {
    const mapped = this.#mapAttributeIndex(index);
    if (typeof mapped !== 'number') return mapped.namespaceURI;
    return this[VIEW] === undefined ? super.attributeNamespace(mapped) : this[VIEW].attributeNamespace(mapped);
  }

  override attributeType(index: number): string {
    const mapped = this.#mapAttributeIndex(index);
    if (typeof mapped !== 'number') return 'CDATA';
    return this[VIEW] === undefined ? super.attributeType(mapped) : this[VIEW].attributeType(mapped);
  }

  override isAttributeSpecified(index: number): boolean {
    const mapped = this.#mapAttributeIndex(index);
    if (typeof mapped !== 'number') return true;
    return this[VIEW] === undefined ? super.isAttributeSpecified(mapped) : this[VIEW].isAttributeSpecified(mapped);
  }

  override attributeValue(index: number): string;
  override attributeValue(namespaceURI: string, localName: string): string | undefined;
  override attributeValue(indexOrNamespace: number | string, localName?: string): string | undefined {
    if (typeof indexOrNamespace === 'number') {
      const mapped = this.#mapAttributeIndex(indexOrNamespace);
      if (typeof mapped !== 'number') return mapped.value;
      return this[VIEW] === undefined ? super.attributeValue(mapped) : this[VIEW].attributeValue(mapped);
    }
    // The lookup by name goes through the accessors above, so it sees the overlay and the view.
    return super.attributeValue(indexOrNamespace, localName as string);
  }

  override text(): string {
    if (this[INSERTED_TEXT] !== undefined) return this[INSERTED_TEXT];
    return this[VIEW] === undefined ? super.text() : this[VIEW].text();
  }

  override isWhitespace(): boolean {
    if (this[INSERTED_TEXT] !== undefined) return isAllWhitespace(this[INSERTED_TEXT]);
    if (this[EVENT] === SPACE) return true;
    return this[VIEW] === undefined ? super.isWhitespace() : this[VIEW].isWhitespace();
  }

  override piTarget(): string {
    if (this[INSERTED_TEXT] !== undefined) return '';
    return this[VIEW] === undefined ? super.piTarget() : this[VIEW].piTarget();
  }

  override piData(): string {
    if (this[INSERTED_TEXT] !== undefined) return '';
    return this[VIEW] === undefined ? super.piData() : this[VIEW].piData();
  }

  override location(): Location {
    return this[VIEW] === undefined ? super.location() : this[VIEW].location();
  }
}
