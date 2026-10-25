/** The typed arrays the reader grows as it fills them. */
type GrowableArray = Uint8Array | Int32Array;

/**
 * A bigger copy of a typed array, of the same kind: at least `minLength` long and at least twice
 * the old length, so repeated growing stays cheap. Copies the first `usedLength` elements, by
 * default all of them.
 */
export function grown<A extends GrowableArray>(array: A, minLength: number, usedLength = array.length): A {
  const Kind = array.constructor as new (length: number) => A;
  const bigger = new Kind(Math.max(minLength, array.length * 2));
  bigger.set(array.subarray(0, usedLength));
  return bigger;
}

/** The index of the last value in an ascending list that is at or below `value`, or -1 if there is none. */
export function lastIndexAtOrBefore(ascending: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = ascending.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((ascending[middle] as number) <= value) low = middle + 1;
    else high = middle - 1;
  }
  return high;
}
