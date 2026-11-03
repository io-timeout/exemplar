import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
