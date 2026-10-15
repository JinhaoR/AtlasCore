import { categoryKey, categoryLabel } from './categories.js';
import { destinationId } from './home-model.js';
import { validDestinationId } from './destination-metadata.js';
import type { DestinationEntry } from './destinations.js';

export interface HomeCategory {
  readonly key: string; readonly label: string; readonly count: number; readonly members: readonly string[];
}
export interface CategoryLayout {
  readonly key: string; readonly label: string; readonly visible: boolean; readonly collapsed: boolean;
  readonly members: readonly string[];
}
export interface HomeLayout { readonly version: 1; readonly categories: readonly CategoryLayout[] }
const legacyOrder = ['University', 'Scholar / Research', 'Writing', 'Development', 'Mail', 'AI', 'Video'].map(categoryKey);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Complete category membership, independent of ranking, search, pins or visibility. */
export function homeCategories(allowed: readonly DestinationEntry[], all: readonly DestinationEntry[] = allowed,
  definitions: readonly string[] = []): readonly HomeCategory[] {
  const groups = new Map<string, { label: string; members: Set<string>; count: number }>();
  for (const label of [...allowed.map(e => e.category), ...all.map(e => e.category), ...definitions]) {
    const key = categoryKey(label);
    if (key && !groups.has(key)) groups.set(key, { label: categoryLabel(label), members: new Set(), count: 0 });
  }
  for (const entry of all) groups.get(categoryKey(entry.category))?.members.add(destinationId(entry));
  for (const entry of allowed) { const group = groups.get(categoryKey(entry.category)); if (group) group.count++; }
  const rank = (key: string) => { const index = legacyOrder.indexOf(key); return index < 0 ? legacyOrder.length : index; };
  // Stable sort preserves the previous custom-category ordering for initial migration.
  return [...groups].map(([key, group]) => ({ key, label: group.label, count: group.count, members: [...group.members].sort() }))
    .sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || rank(a.key) - rank(b.key));
}

export function readHomeLayout(input: unknown): HomeLayout | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as HomeLayout;
  if (Object.keys(value).sort().join(',') !== 'categories,version' || value.version !== 1
    || !Array.isArray(value.categories) || value.categories.length > 4096) return null;
  const keys = new Set<string>();
  for (const c of value.categories) {
    if (!c || typeof c !== 'object' || Object.keys(c).sort().join(',') !== 'collapsed,key,label,members,visible'
      || typeof c.label !== 'string' || !c.label || c.label.length > 64 || categoryLabel(c.label) !== c.label
      || c.key !== categoryKey(c.label) || keys.has(c.key) || typeof c.visible !== 'boolean' || typeof c.collapsed !== 'boolean'
      || !Array.isArray(c.members) || c.members.length > 10000 || new Set(c.members).size !== c.members.length
      || c.members.some((id: unknown) => !validDestinationId(id))) return null;
    keys.add(c.key);
  }
  return structuredClone(value);
}

/** Retain unused preferences; only exact, unambiguous membership can migrate a renamed key. */
export function reconcileHomeLayout(saved: HomeLayout | null, catalog: readonly HomeCategory[]): HomeLayout {
  if (saved === null) return { version: 1, categories: catalog.map(c => ({ key: c.key, label: c.label,
    visible: true, collapsed: false, members: [...c.members] })) };
  const current = new Map(catalog.map(c => [c.key, c])), known = new Set(saved.categories.map(c => c.key));
  const renamed = new Map<string, HomeCategory>();
  for (const old of saved.categories) if (!current.has(old.key) && old.members.length) {
    const candidates = catalog.filter(c => !known.has(c.key) && same(c.members, old.members));
    const competing = saved.categories.filter(c => !current.has(c.key) && same(c.members, old.members));
    if (candidates.length === 1 && competing.length === 1) renamed.set(old.key, candidates[0]!);
  }
  const categories = saved.categories.map(old => {
    const c = current.get(old.key) ?? renamed.get(old.key);
    return c ? { ...old, key: c.key, label: c.label, members: [...c.members] } : { ...old, members: [...old.members] };
  });
  const retained = new Set(categories.map(c => c.key));
  const added = catalog.filter(c => !retained.has(c.key)).sort((a, b) => a.key.localeCompare(b.key, 'en'));
  categories.push(...added.map(c => ({ key: c.key, label: c.label, visible: true, collapsed: false, members: [...c.members] })));
  return { version: 1, categories };
}

export type HomeLayoutAction = 'UP' | 'DOWN' | 'VISIBILITY' | 'COLLAPSE';
export function changeHomeLayout(layout: HomeLayout, key: string, action: HomeLayoutAction,
  available: readonly string[] = layout.categories.map(c => c.key)): HomeLayout {
  const categories = layout.categories.map(c => ({ ...c, members: [...c.members] }));
  const index = categories.findIndex(c => c.key === key);
  if (index < 0) return { version: 1, categories };
  if (action === 'VISIBILITY') categories[index]!.visible = !categories[index]!.visible;
  else if (action === 'COLLAPSE') categories[index]!.collapsed = !categories[index]!.collapsed;
  else {
    const order = categories.filter(c => available.includes(c.key));
    const position = order.findIndex(c => c.key === key), neighbor = order[position + (action === 'UP' ? -1 : 1)];
    if (neighbor) { const other = categories.findIndex(c => c.key === neighbor.key); [categories[index], categories[other]] = [categories[other]!, categories[index]!]; }
  }
  return { version: 1, categories };
}

export function displayedHomeCategories(layout: HomeLayout, catalog: readonly HomeCategory[]): readonly (CategoryLayout & { count: number })[] {
  const current = new Map(catalog.map(c => [c.key, c]));
  return layout.categories.flatMap(c => c.visible && (current.get(c.key)?.count ?? 0) > 0
    ? [{ ...c, count: current.get(c.key)!.count }] : []);
}
