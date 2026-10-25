import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErrorCode, ResolutionError, XMLError, XMLInputFactory } from '@/index.ts';
import { accessRefusedError } from '@/internal.ts';
import { ErrorFactory } from '@/util/errors.ts';

/** Whether a stack lists any frames, in V8's or WebKit's format. */
const hasFrames = (error: unknown): boolean => /\n\s+at |@/.test((error as Error).stack ?? '');

/** The error a call throws. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('Nothing was thrown');
}

/** Every source file of every package, by its path from `packages`. */
function sources(): Map<string, string> {
  const packages = fileURLToPath(new URL('../../../', import.meta.url));
  const found = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.ts')) found.set(path.relative(packages, file), readFileSync(file, 'utf8'));
    }
  };
  for (const name of readdirSync(packages)) {
    const src = path.join(packages, name, 'src');
    if (readdirSync(path.join(packages, name)).includes('src')) walk(src);
  }
  return found;
}

describe('ErrorFactory.create', () => {
  it('builds an error of the class given, with the arguments its constructor takes', () => {
    const error = ErrorFactory.create(ResolutionError, ErrorCode.ACCESS_REFUSED, 'refused');
    expect(error).toBeInstanceOf(ResolutionError);
    expect([error.code, error.message]).toEqual(['ACCESS_REFUSED', 'refused']);
    const misuse = ErrorFactory.create(TypeError, 'wrong');
    expect([misuse instanceof TypeError, misuse.name, misuse.message]).toEqual([true, 'TypeError', 'wrong']);
  });

  // Engines without `Error.stackTraceLimit`, such as Firefox's, keep their stacks.
  it.runIf(Error.stackTraceLimit !== undefined)('builds it without stack frames, and puts the limit back', () => {
    const limit = Error.stackTraceLimit;
    expect(hasFrames(ErrorFactory.create(RangeError, 'no frames'))).toBe(false);
    expect(Error.stackTraceLimit).toBe(limit);
    // Errors exemplar does not build keep theirs.
    expect(hasFrames(new Error('with frames'))).toBe(true);
  });

  it('leaves an engine without the limit as it is, adding none', () => {
    const limit = Error.stackTraceLimit;
    Reflect.deleteProperty(Error, 'stackTraceLimit');
    try {
      expect(ErrorFactory.create(TypeError, 'built').message).toBe('built');
      expect(Object.hasOwn(Error, 'stackTraceLimit')).toBe(false);
    } finally {
      Error.stackTraceLimit = limit;
    }
  });

  it('puts the limit back when the constructor throws', () => {
    const limit = Error.stackTraceLimit;
    /** An error class whose constructor fails. */
    class FailingError extends Error {
      override name = 'FailingError';

      constructor() {
        super('never');
        throw new Error('constructor failed');
      }
    }
    expect(() => ErrorFactory.create(FailingError)).toThrow('constructor failed');
    expect(Error.stackTraceLimit).toBe(limit);
  });
});

describe('ErrorFactory.expect', () => {
  it('returns a caught error of an expected class, and throws anything else on unchanged', () => {
    const refusal = ErrorFactory.create(ResolutionError, ErrorCode.ACCESS_REFUSED, 'refused');
    expect(ErrorFactory.expect(refusal, ResolutionError)).toBe(refusal);
    expect(ErrorFactory.expect(refusal, XMLError, ResolutionError)).toBe(refusal);
    const other = new RangeError('unexpected');
    expect(thrown(() => ErrorFactory.expect(other, ResolutionError, XMLError))).toBe(other);
    expect(thrown(() => ErrorFactory.expect('not an error', ResolutionError))).toBe('not an error');
  });
});

// Engines without `Error.stackTraceLimit`, such as Firefox's, keep their stacks.
describe.runIf(Error.stackTraceLimit !== undefined)('the errors the reader raises', () => {
  it('carry no stack frames: fatal, recoverable, refused reads and misuse alike', () => {
    const fatal = thrown(() => {
      const malformed = new XMLInputFactory().createStreamReader('<a></b>');
      while (malformed.hasNext()) malformed.next();
    });
    const recoverable: unknown[] = [];
    const lenient = new XMLInputFactory({ errorHandler: { error: (e) => recoverable.push(e) } });
    // An entity an unread external DTD may declare, as in the FreeBSD documents: a recoverable error.
    const reader = lenient.createStreamReader('<!DOCTYPE a SYSTEM "a.dtd"><a x="&unread;"/>');
    while (reader.hasNext()) reader.next();
    const misuse = thrown(() => new XMLInputFactory().createStreamReader('<a/>').elementText());
    expect(fatal).toBeInstanceOf(XMLError);
    expect(recoverable.length).toBeGreaterThan(0);
    for (const error of [fatal, ...recoverable, accessRefusedError('http://x/a.dtd'), misuse]) {
      expect(hasFrames(error)).toBe(false);
    }
  });
});

describe('every package', () => {
  it('builds its errors only through ErrorFactory.create', () => {
    // The DOM's DOMError is DOM Level 3's report object, not an exception.
    const built = /new (?!DOMError\()((?:[A-Z][A-Za-z]*)?Error|TypeError|RangeError|DOMException)\(/;
    const offenders = [...sources()]
      .filter(([file, text]) => file !== path.join('xml', 'src', 'util', 'errors.ts') && built.test(text))
      .map(([file, text]) => `${file}: ${built.exec(text)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it('throws caught errors of unexpected classes on through ErrorFactory.expect', () => {
    const rethrow = /if \(!\(error instanceof [^)]*\)\) throw error;/;
    const offenders = [...sources()].filter(([, text]) => rethrow.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
