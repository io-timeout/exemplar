import type { EventType } from '../cursor/event-type.ts';
import type { AsyncStreamReader, StreamReader } from '../cursor/readers.ts';
import type { Doctype } from '../cursor/stream-reader.ts';
import type { Location } from '../errors/xml-error.ts';

/**
 * Forwards every call to a parent reader, as StAX's `StreamReaderDelegate` does. Each method calls
 * the parent's method of the same name, so `StreamReader` documents what each does; a subclass
 * overrides the ones it wants to change. To skip events, a filter (`createFilteredReader`) is faster.
 */
export class StreamReaderDelegate {
  /** The reader calls are forwarded to. */
  parent: StreamReader | AsyncStreamReader;

  constructor(parent: StreamReader | AsyncStreamReader) {
    this.parent = parent;
  }

  fill(): Promise<void> {
    return (this.parent as AsyncStreamReader).fill();
  }

  feed(chunk: Uint8Array): void {
    return (this.parent as AsyncStreamReader).feed(chunk);
  }

  endOfInput(): void {
    return (this.parent as AsyncStreamReader).endOfInput();
  }

  next(): EventType {
    return this.parent.next();
  }

  hasNext(): boolean {
    return this.parent.hasNext();
  }

  eventType(): EventType {
    return this.parent.eventType();
  }

  close(): void {
    return this.parent.close();
  }

  name(): string {
    return this.parent.name();
  }

  localName(): string {
    return this.parent.localName();
  }

  prefix(): string {
    return this.parent.prefix();
  }

  namespaceURI(index?: number): string {
    return this.parent.namespaceURI(index);
  }

  namespaceCount(): number {
    return this.parent.namespaceCount();
  }

  namespacePrefix(index: number): string {
    return this.parent.namespacePrefix(index);
  }

  attributeCount(): number {
    return this.parent.attributeCount();
  }

  attributeName(index: number): string {
    return this.parent.attributeName(index);
  }

  attributeLocalName(index: number): string {
    return this.parent.attributeLocalName(index);
  }

  attributePrefix(index: number): string {
    return this.parent.attributePrefix(index);
  }

  attributeNamespace(index: number): string {
    return this.parent.attributeNamespace(index);
  }

  attributeType(index: number): string {
    return this.parent.attributeType(index);
  }

  isAttributeSpecified(index: number): boolean {
    return this.parent.isAttributeSpecified(index);
  }

  attributeValue(index: number): string;
  attributeValue(namespaceURI: string, localName: string): string | undefined;
  attributeValue(indexOrNamespace: number | string, localName?: string): string | undefined {
    return typeof indexOrNamespace === 'number'
      ? this.parent.attributeValue(indexOrNamespace)
      : this.parent.attributeValue(indexOrNamespace, localName as string);
  }

  text(): string {
    return this.parent.text();
  }

  isWhitespace(): boolean {
    return this.parent.isWhitespace();
  }

  piTarget(): string {
    return this.parent.piTarget();
  }

  piData(): string {
    return this.parent.piData();
  }

  doctype(): Doctype {
    return this.parent.doctype();
  }

  version(): string | undefined {
    return this.parent.version();
  }

  encoding(): string | undefined {
    return this.parent.encoding();
  }

  standalone(): boolean | undefined {
    return this.parent.standalone();
  }

  location(): Location {
    return this.parent.location();
  }

  nextTag(): EventType {
    return this.parent.nextTag();
  }

  elementText(): string {
    return this.parent.elementText();
  }

  nextTagAsync(): Promise<EventType> {
    return (this.parent as AsyncStreamReader).nextTagAsync();
  }

  elementTextAsync(): Promise<string> {
    return (this.parent as AsyncStreamReader).elementTextAsync();
  }

  forEachEvent(handle: Parameters<AsyncStreamReader['forEachEvent']>[0]): Promise<void> {
    return (this.parent as AsyncStreamReader).forEachEvent(handle);
  }
}
