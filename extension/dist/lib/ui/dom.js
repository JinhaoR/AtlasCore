/** Native DOM setters can mutate or blur controls even when the value is unchanged. */
export function setProperty(node, key, value) {
    if (node[key] !== value)
        node[key] = value;
}
export function setAttribute(node, name, value) {
    if (node.getAttribute(name) === value)
        return;
    if (value === null)
        node.removeAttribute(name);
    else
        node.setAttribute(name, value);
}
/** Retain native controls/listeners while an existing list changes order or membership. */
export function reconcileChildren(parent, children) {
    const keep = new Set(children);
    for (const child of [...parent.children])
        if (!keep.has(child))
            child.remove();
    children.forEach((child, index) => {
        if (parent.children[index] !== child)
            parent.insertBefore(child, parent.children[index] ?? null);
    });
}
