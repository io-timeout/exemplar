/** An empty byte array, shared so that nothing allocates one. */
export const NO_BYTES = new Uint8Array(0);

/** U+FEFF, the byte order mark, as UTF-8, UTF-16BE and UTF-16LE write it. */
export const BYTE_ORDER_MARK = {
  UTF8: [0xef, 0xbb, 0xbf],
  UTF16BE: [0xfe, 0xff],
  UTF16LE: [0xff, 0xfe],
} as const;

/** Joins two byte arrays into a new one. */
export function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

/** The high bit of each byte in a 32-bit word, which is set only in non-ASCII bytes. */
const HIGH_BITS = 0x80_80_80_80;
/** How many bytes a 32-bit word holds. */
const BYTES_PER_WORD = 4;

/**
 * Whether every byte is ASCII. It ORs all the bytes together and checks the high bit once, reading
 * four bytes at a time from the first position aligned for a 32-bit read.
 */
export function isAscii(bytes: Uint8Array): boolean {
  const unalignedHead = Math.min(-bytes.byteOffset & (BYTES_PER_WORD - 1), bytes.length);
  const wordCount = (bytes.length - unalignedHead) >>> 2;
  let allBits = 0;
  for (let i = 0; i < unalignedHead; i++) allBits |= bytes[i] as number;
  if (wordCount > 0) {
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset + unalignedHead, wordCount);
    for (let i = 0; i < wordCount; i++) allBits |= words[i] as number;
  }
  for (let i = unalignedHead + wordCount * BYTES_PER_WORD; i < bytes.length; i++) allBits |= bytes[i] as number;
  return (allBits & HIGH_BITS) === 0;
}

/** Whether bytes start with a prefix. */
export function startsWithBytes(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}
