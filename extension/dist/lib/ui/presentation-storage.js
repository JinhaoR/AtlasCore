export function savePresentation(source, key, value) {
    let storage;
    try {
        storage = typeof source === 'function' ? source() : source;
    }
    catch {
        return 'UNCERTAIN';
    }
    let before;
    try {
        before = storage.getItem(key);
    }
    catch { /* A write may still succeed. */ }
    try {
        storage.setItem(key, value);
        return 'SAVED';
    }
    catch {
        try {
            const after = storage.getItem(key);
            if (after === value)
                return 'SAVED';
            return before !== undefined && after === before ? 'FAILED' : 'UNCERTAIN';
        }
        catch {
            return 'UNCERTAIN';
        }
    }
}
