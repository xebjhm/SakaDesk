/** True when both records have the same keys with `===` values (one level deep). */
export function shallowEqualRecord<V>(a: Record<string, V>, b: Record<string, V>): boolean {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}
