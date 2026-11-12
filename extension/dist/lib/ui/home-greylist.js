import { homeAccessSummary } from './home-access.js';
import { canQueueOperation, countdown, accessContextCopy } from './presentation.js';
import { reconcileChildren, setProperty } from './dom.js';
const el = (id) => document.getElementById(id);
/** Compact UI only: commands are explicit; Core checks time, scope and persistence. */
export function initializeHomeGreylist(options) {
    const rows = new Map();
    let current = null;
    let selectedTab = '';
    async function cancelAccess(kind, requestId, hosts) {
        const origin = current?.contexts.find(c => String(c.tabId) === selectedTab && c.hostname && hosts.includes(c.hostname));
        const response = await options.send({ kind, requestId });
        // Failed/uncertain saves retain the row and its original request. Never hide
        // a pending command as though it had committed, or dismiss a newer context.
        if (response?.result?.type === 'COMMITTED' && origin)
            options.dismiss(origin.contextId, origin.navigationId);
    }
    const contextAction = (tabId, contextId, command) => {
        if (current?.contexts.some(c => c.tabId === tabId && c.contextId === contextId))
            void options.send(command);
    };
    function row(item, disabled) {
        let record = rows.get(item.id);
        if (!record) {
            const node = document.createElement('li');
            node.className = 'temporary-row';
            const copy = document.createElement('span');
            copy.className = 'temporary-copy';
            const name = document.createElement('strong');
            name.className = 'temporary-name';
            const scope = document.createElement('span');
            scope.className = 'temporary-scope';
            copy.append(name, scope);
            const actions = document.createElement('span');
            actions.className = 'temporary-actions';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'access-cancel';
            cancel.textContent = 'Cancel';
            const status = document.createElement('button');
            status.type = 'button';
            status.className = 'access-signal';
            record = { node, item };
            const saved = record;
            status.addEventListener('click', () => saved.item.run?.());
            cancel.addEventListener('click', () => saved.item.cancel?.());
            actions.append(cancel, status);
            node.append(copy, actions);
            rows.set(item.id, record);
        }
        record.item = item;
        setProperty(record.node.querySelector('.temporary-name'), 'textContent', item.name);
        const scope = record.node.querySelector('.temporary-scope');
        setProperty(scope, 'textContent', item.scope);
        setProperty(scope, 'title', item.scope);
        const status = record.node.querySelector('.access-signal');
        setProperty(status, 'textContent', item.status);
        setProperty(status.dataset, 'tone', item.tone);
        setProperty(status, 'disabled', disabled || !item.run);
        const cancel = record.node.querySelector('.access-cancel');
        setProperty(cancel, 'hidden', !item.cancel);
        setProperty(cancel, 'disabled', disabled);
        return record.node;
    }
    return { render(view, now, busy, selected) {
            current = view;
            selectedTab = selected;
            const summary = homeAccessSummary(view, now), items = [], journeys = [];
            const disabled = busy || !summary.available || !canQueueOperation(view?.controller);
            for (const p of summary.pending) {
                const waiting = p.outcome === 'WAIT';
                items.push({ id: `request:${p.requestId}`, name: options.label(p.hostnames[0]), scope: p.hostnames.join(', '), tone: waiting ? 'waiting' : 'ready',
                    status: waiting ? `Waiting ${countdown(p.readyAt, now)}` : `Allow · ${countdown(p.confirmBy, now)}`,
                    cancel: () => void cancelAccess('CANCEL_ACCESS', p.requestId, p.hostnames),
                    ...(!waiting ? { run: () => void options.send({ kind: 'CONFIRM_ACCESS', requestId: p.requestId }) } : {}) });
            }
            for (const g of summary.grants)
                items.push({ id: `grant:${g.requestId}`, name: options.label(g.hostnames[0]), scope: g.hostnames.join(', '), tone: 'active',
                    status: `Active ${countdown(g.expiresAt, now)} · Open`, cancel: () => void cancelAccess('END_ACCESS', g.requestId, g.hostnames),
                    run: () => void options.send({ kind: 'OPEN_DESTINATION', url: `https://${g.hostnames[0]}/` }) });
            // A blocked tab's original route resolves here. No fallback to a different tab.
            const context = view?.contexts.find(c => String(c.tabId) === selected);
            if (context?.hostname && !summary.pending.some(p => p.hostnames.includes(context.hostname)) && !summary.grants.some(g => g.hostnames.includes(context.hostname))) {
                const decision = context.latest?.type === 'ASSESSMENT' ? context.latest.decision : null, scope = context.accessScope;
                const item = { id: `context:${context.contextId}`, name: options.label(context.hostname), scope: context.hostname, status: 'Unavailable', tone: 'neutral' };
                if (decision?.outcome === 'GREYLIST') {
                    item.cancel = () => options.dismiss(context.contextId, context.navigationId);
                    if (scope?.status === 'READY') {
                        item.scope = scope.hostnames.join(', ');
                        item.status = 'Request access';
                        item.run = () => contextAction(context.tabId, context.contextId, { kind: 'START_ACCESS', tabId: context.tabId, scopeId: scope.id });
                    }
                    else {
                        item.status = 'Checking address…';
                        if (!disabled)
                            options.prepare(context);
                    }
                }
                else if (decision?.outcome === 'ALLOW') {
                    // Normal allowed sites do not occupy the Greylist strip.
                    item.status = 'Allowed';
                }
                else {
                    const copy = accessContextCopy(context);
                    item.status = copy.label;
                    item.scope = copy.description;
                    if (copy.retryHome) {
                        item.status = 'Retry site';
                        item.run = () => contextAction(context.tabId, context.contextId, { kind: 'OPEN_HOME', tabId: context.tabId });
                    }
                }
                if (context.effect === 'FAILED')
                    item.scope = 'Firefox could not remove this page. Close the affected tab.';
                if (decision?.outcome !== 'ALLOW')
                    items.unshift(item);
            }
            if (selected && !context)
                items.unshift({ id: 'missing-context', name: 'Tab unavailable', scope: 'The original tab has closed. Open the site again to request access.', status: 'Closed', tone: 'neutral' });
            for (const c of summary.journeys)
                journeys.push({ id: `journey:${c.contextId}:${c.journey.id}`, name: options.label(c.journey.rootHostname), scope: `Journey · Tab ${c.tabId}`, tone: 'active',
                    status: `${countdown(c.journey.expiresAt, now)} · End`, run: () => contextAction(c.tabId, c.contextId, { kind: 'CANCEL_JOURNEY', tabId: c.tabId }) });
            if (context?.retry && !summary.journeys.some(c => c.tabId === context.tabId)) {
                const retry = context.retry;
                journeys.push({ id: `retry:${context.contextId}`, name: retry.destinationLabel, scope: 'Journey ended', tone: 'neutral', status: 'Start again',
                    ...(context.effect !== 'REMOVING' ? { run: () => contextAction(context.tabId, context.contextId, { kind: 'RESTART_JOURNEY', tabId: context.tabId, journeyId: retry.journeyId }) } : {}) });
            }
            const focused = document.activeElement;
            reconcileChildren(el('pending-access-list'), items.map(i => row(i, disabled)));
            reconcileChildren(el('other-journeys'), journeys.map(i => row(i, disabled)));
            const retained = new Set([...items, ...journeys].map(i => i.id));
            for (const id of rows.keys())
                if (!retained.has(id))
                    rows.delete(id);
            if (focused && !focused.isConnected)
                el('temporary-title').focus({ preventScroll: true });
            setProperty(el('temporary-count'), 'textContent', items.length ? `(${items.length})` : '');
            setProperty(el('home-journeys-count'), 'textContent', journeys.length ? `(${journeys.length})` : '');
            setProperty(el('home-journeys-section'), 'hidden', !journeys.length);
            setProperty(el('temporary-empty'), 'hidden', !summary.available || !!items.length);
            setProperty(el('temporary-unavailable'), 'hidden', summary.available);
            setProperty(el('temporary-section'), 'hidden', summary.available && items.length === 0);
        } };
}
