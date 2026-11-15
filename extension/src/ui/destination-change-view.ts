import { evaluate, type Policy } from '@atlas/core';
import { destinationChangeSummary, type DraftChange, type DraftDestination } from './destination-draft.js';

/** Read-only consequences of the existing candidate, never a policy constructor. */
export function destinationChangeView(change: DraftChange, beforePolicy: Policy, afterPolicy: Policy) {
  const { before, after } = change;
  const classification = (item: DraftDestination | null, policy: Policy) => item ? [...new Set(item.metadata.hostnames.map(host => {
    const decision = evaluate({ hostname: host }, policy);
    return decision.outcome === 'ALLOW' ? 'Allowed' : decision.outcome === 'DENY' ? 'Blocked' : 'Requires access request';
  }))].join(' / ') : 'No explicit rule';
  const scope = (item: DraftDestination | null, policy: Policy) => (policy.whitelistSubdomains ?? []).filter(h => item?.metadata.hostnames.includes(h)).join(', ') || 'Not included';
  const rows = [
    ['Access', classification(before, beforePolicy), classification(after, afterPolicy)],
    ['Exact hosts', before?.metadata.hostnames.join(', ') ?? '(none)', after?.metadata.hostnames.join(', ') ?? '(none)'],
    ['Subdomain bases', scope(before, beforePolicy), scope(after, afterPolicy)],
    ['Name', before?.metadata.label ?? '(none)', after?.metadata.label ?? '(none)'],
    ['Category', before?.metadata.category ?? '(none)', after?.metadata.category ?? '(none)'],
    ['Home pin', before?.pinned ? 'Pinned' : 'Not pinned', after?.pinned ? 'Pinned' : 'Not pinned'],
  ].filter((row, i) => i < 2 || row[1] !== row[2]);
  const full = destinationChangeSummary(change, beforePolicy, afterPolicy);
  return { name: full[0]!, kind: !before ? 'New site' : !after ? 'Removal' : 'Prepared change', rows,
    warnings: full.filter(line => line.startsWith('Still allowed by another saved scope:') || line.startsWith('Domain + all subdomains:')),
    full };
}

export function renderDestinationChange(container: HTMLElement, change: DraftChange, before: Policy, after: Policy): void {
  const view = destinationChangeView(change, before, after);
  const heading = document.createElement('h3'); heading.textContent = view.name;
  const kind = document.createElement('p'); kind.className = 'change-kind'; kind.textContent = view.kind;
  const access = document.createElement('p'); access.className = 'change-access';
  const accessRow = view.rows[0]!;
  access.textContent = !change.after ? 'Remove this saved site rule.' : !change.before ? `Planned access: ${accessRow[2]}`
    : accessRow[1] === accessRow[2] ? `Access stays ${accessRow[2]!.toLowerCase()}.` : `${accessRow[1]} → ${accessRow[2]}`;
  const hosts = document.createElement('p'); hosts.className = 'change-hosts';
  const addresses = view.rows[1]!;
  hosts.textContent = change.before && change.after && addresses[1] !== addresses[2]
    ? `${addresses[1]} → ${addresses[2]}` : (change.after ?? change.before)?.metadata.hostnames.join(', ') ?? '';
  const display = document.createElement('p'); display.className = 'change-display';
  const item = change.after ?? change.before;
  display.textContent = item ? `${item.metadata.category}${item.pinned ? ' · Pinned to Home' : ''}` : '';
  const table = document.createElement('table'); table.className = 'change-comparison';
  const head = document.createElement('thead'), row = document.createElement('tr');
  for (const value of ['Change', 'Current', 'Proposed']) { const cell = document.createElement('th'); cell.textContent = value; row.append(cell); }
  head.append(row); table.append(head);
  const body = document.createElement('tbody');
  for (const values of view.rows) { const tr = document.createElement('tr'); for (const value of values) { const td = document.createElement('td'); td.textContent = value!; tr.append(td); } body.append(tr); }
  table.append(body);
  const warnings = view.warnings.map(message => { const p = document.createElement('p'); p.className = 'scope-note'; p.textContent = message; return p; });
  const details = document.createElement('details'), summary = document.createElement('summary');
  details.className = 'technical-review'; summary.textContent = 'Change details'; details.append(summary, table);
  container.replaceChildren(heading, kind, access, hosts, display, ...warnings, details);
}
