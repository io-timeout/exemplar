/** Base64 of 16-bit units, little-endian, as the generated tables store them. */
export function unitsBase64(values: readonly number[]): string {
  return btoa(values.map((v) => String.fromCodePoint(v & 0xff, v >> 8)).join(''));
}

/** A 256-bit lead-byte mask in hex, as the generated tables store it. */
export function leadMask(leads: readonly number[]): string {
  const digits = new Uint8Array(64);
  for (const b of leads) digits[b >> 2] = (digits[b >> 2] as number) | (1 << (b & 3));
  return Array.from(digits, (d) => d.toString(16)).join('');
}

/** Packed overrides, consecutive keys in one run; each key maps to a code point, or to `null` for an error. */
export function packOverrides(entries: readonly (readonly [number, number | null])[]): string {
  const out: number[] = [];
  for (let i = 0; i < entries.length;) {
    const first = (entries[i] as readonly [number, number | null])[0];
    let n = 1;
    while (entries[i + n]?.[0] === first + n) n++;
    out.push(first >> 8, first & 0xff, n);
    for (const [, point] of entries.slice(i, i + n)) {
      const c = point ?? 0xff_ff_ff;
      out.push(c >> 16, (c >> 8) & 0xff, c & 0xff);
    }
    i += n;
  }
  return btoa(String.fromCodePoint(...out));
}
