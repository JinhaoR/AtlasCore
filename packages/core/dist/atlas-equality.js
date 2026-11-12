/** Equality for validated, owned JSON domain data only. Preserve array order and
 * every field; identity can skip an immutable shared subtree, never a decision. */
export function sameAtlasData(left, right) {
    if (left === right)
        return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
        return false;
    if (Array.isArray(left)) {
        if (!Array.isArray(right) || left.length !== right.length)
            return false;
        for (let i = 0; i < left.length; i++)
            if (!sameAtlasData(left[i], right[i]))
                return false;
        return true;
    }
    if (Array.isArray(right))
        return false;
    const a = left, b = right;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length)
        return false;
    for (const key of keys)
        if (!Object.hasOwn(b, key) || !sameAtlasData(a[key], b[key]))
            return false;
    return true;
}
