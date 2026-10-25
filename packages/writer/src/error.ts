import type { ErrorCode } from '@exemplarjs/xml';

/** Thrown when a write would not give well-formed XML, or cannot be encoded. */
export class WriterError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'WriterError';
    this.code = code;
  }
}
