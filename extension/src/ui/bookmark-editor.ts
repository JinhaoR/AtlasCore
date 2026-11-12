import { BookmarkSession, defaultBookmarkPages, type BookmarkPage } from './home-bookmarks.js';
import { destinationId } from './home-model.js';
import type { DestinationEntry } from './destinations.js';
import { reconcileChildren, setAttribute, setProperty } from './dom.js';
import { presentationCommand, presentationView } from './presentation-client.js';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Native dialog over one bookmark draft. It never writes pins as part of Save. */
export function initializeBookmarkEditor(session: BookmarkSession, togglePin: (id: string) => void, open: (url: string) => void) {
  const dialog = el<HTMLDialogElement>('bookmark-editor'), parent = el<HTMLSelectElement>('bookmark-parent');
  const rows = new Map<string, HTMLElement>();
  let entries: readonly DestinationEntry[] = [], pins: readonly string[] = [], pinEnabled = false;
  let optionsKey = '', trigger: HTMLElement | null = null;
  let labelParent:string|null=null,labelBefore:string|null=null,labelBusy=false,labelDirty=false;
  const entry = () => entries.find(e => destinationId(e) === session.parentId);
  const change = (pages: readonly BookmarkPage[]) => session.update(pages);
  function close(discard: boolean): void {
    if (session.busy || labelBusy || !discard&&labelDirty) return;
    if (discard) { session.discard(); labelDirty=false; labelParent=null; }
    dialog.close(); setProperty(dialog, 'hidden', true);
    if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus({ preventScroll: true });
  }
  function cancel(): void {
    if (!session.dirty && !labelDirty || window.confirm('Discard your unsaved edits? Saved bookmarks and access rules stay unchanged.')) close(true);
  }
  async function select(id: string): Promise<void> {
    if (labelBusy || session.busy) return;
    if ((session.dirty || labelDirty) && !window.confirm('Discard these unsaved edits and switch sites?')) { parent.value = session.parentId ?? ''; return; }
    session.discard(); labelDirty=false; labelParent=null;
    const e = entries.find(e => destinationId(e) === id);
    await session.edit(id, e ? defaultBookmarkPages(e) : []); render();
  }
  function render(): void {
    if (!dialog.open) return;
    const savedLabel=session.parentId?presentationView()?.sync.labels[session.parentId]??null:null;
    if(labelParent!==session.parentId || !labelBusy&&!labelDirty&&labelBefore!==savedLabel){labelDirty=false;labelParent=session.parentId;labelBefore=savedLabel;
      el<HTMLInputElement>('bookmark-label').value=labelBefore??entry()?.label??'';el('bookmark-label-status').textContent='';}
    setProperty(el<HTMLButtonElement>('save-bookmark-label'),'disabled',labelBusy||!entry());
    for(const direction of ['up','down'])setProperty(el<HTMLButtonElement>(`pin-${direction}`),'disabled',labelBusy||!pins.includes(session.parentId??'')||pins.indexOf(session.parentId!)===(direction==='up'?0:pins.length-1));
    const choices = [...entries.map(e => ({ id: destinationId(e), label: e.label })),
      ...(session.saved?.value?.groups ?? []).filter(g => !entries.some(e => destinationId(e) === g.parentId))
        .map(g => ({ id: g.parentId, label: `${g.parentId.replace(/^(host|service):/, '')} · unavailable` }))];
    const key = JSON.stringify(choices);
    if (key !== optionsKey) {
      optionsKey = key; reconcileChildren(parent, choices.map(c => new Option(c.label, c.id)));
    }
    setProperty(parent, 'value', session.parentId ?? ''); setProperty(parent, 'disabled', session.busy || labelBusy);
    const nodes = session.draft.map((page, index) => {
      let row = rows.get(page.id);
      if (!row) {
        row = document.createElement('li'); row.className = 'bookmark-edit-row'; row.dataset.pageId = page.id;
        const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name';
        const name = document.createElement('input'); name.maxLength = 100; name.autocomplete = 'off'; name.dataset.field = 'label'; nameLabel.append(name);
        const urlLabel = document.createElement('label'); urlLabel.textContent = 'Page URL';
        const url = document.createElement('input'); url.type = 'url'; url.maxLength = 4096; url.autocomplete = 'off'; url.spellcheck = false; url.dataset.field = 'url'; urlLabel.append(url);
        for (const [field, input] of [['label', name], ['url', url]] as const) input.addEventListener('input', () => {
          change(session.draft.map(p => p.id === page.id ? { ...p, [field]: input.value } : p));
        });
        const actions = document.createElement('div'); actions.className = 'bookmark-row-actions';
        for (const [action, label] of [['up', 'Move up'], ['down', 'Move down'], ['remove', 'Remove']] as const) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.dataset.action = action; button.textContent = label;
          button.addEventListener('click', () => {
            const list = [...session.draft], i = list.findIndex(p => p.id === page.id);
            if (i < 0) return;
            if (action === 'remove') list.splice(i, 1);
            else { const other = i + (action === 'up' ? -1 : 1); if (other < 0 || other >= list.length) return; [list[i], list[other]] = [list[other]!, list[i]!]; }
            change(list);
            if (action === 'remove') (el('bookmark-pages').querySelector<HTMLElement>('input') ?? el('add-bookmark-page')).focus();
            else button.focus({ preventScroll: true });
          }); actions.append(button);
        }
        row.append(nameLabel, urlLabel, actions); rows.set(page.id, row);
      }
      setProperty(row.querySelector<HTMLInputElement>('[data-field="label"]')!, 'value', page.label);
      setProperty(row.querySelector<HTMLInputElement>('[data-field="url"]')!, 'value', page.url);
      for (const input of row.querySelectorAll<HTMLInputElement>('input')) setProperty(input, 'disabled', session.busy);
      for (const button of row.querySelectorAll<HTMLButtonElement>('button')) {
        setProperty(button, 'disabled', session.busy || button.dataset.action === 'up' && index === 0 || button.dataset.action === 'down' && index === session.draft.length - 1);
        setAttribute(button, 'aria-label', `${button.textContent} ${page.label || 'page'}`);
      }
      return row;
    });
    const focused = document.activeElement as HTMLElement | null;
    reconcileChildren(el('bookmark-pages'), nodes);
    if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
    for (const [id] of rows) if (!session.draft.some(p => p.id === id)) rows.delete(id);
    setProperty(el('bookmark-parent-note'), 'textContent', !entry()
      ? 'This site is unavailable. Its saved pages are retained, but no active pin is shown. Remove all pages and save to clear them.'
      : 'Pages belong to this site only. Saving pages does not change access rules or pin order.');
    setProperty(el('bookmark-empty'), 'hidden', session.draft.length > 0);
    const message = session.busy ? 'Saving pages…' : session.conflict ? 'Another Atlas page saved newer bookmarks. Your edits are retained. Review the saved version before overwriting it.'
      : session.failure === 'INVALID' ? 'Give every page a name and a supported full HTTP(S) URL without embedded credentials. Maximum 100 pages per site.'
        : session.failure ? 'Pages are not verified as saved. Your edits remain here; retry before closing this page.'
          : session.dirty ? 'Unsaved page edits. Home still uses saved bookmarks.' : 'Saved pages. Browsing permission is unchanged.';
    setProperty(el('bookmark-status'), 'textContent', message);
    setProperty(el<HTMLButtonElement>('save-bookmarks'), 'disabled', session.busy || !session.dirty || session.conflict || !session.saved);
    setProperty(el<HTMLButtonElement>('save-bookmarks'), 'textContent', session.failure && session.failure !== 'INVALID' ? 'Retry save' : 'Save pages');
    setProperty(el<HTMLButtonElement>('add-bookmark-page'), 'disabled', session.busy || !entry() || session.draft.length >= 100);
    setProperty(el<HTMLButtonElement>('cancel-bookmarks'), 'disabled', session.busy);
    setProperty(el('review-bookmark-conflict'), 'hidden', !session.conflict);
    setProperty(el<HTMLButtonElement>('review-bookmark-conflict'), 'disabled', session.busy);
    const review = session.reviewed?.value?.groups.find(g => g.parentId === session.parentId)?.pages ?? [];
    const reviewText = session.reviewed ? review.length ? review.map(p => `${p.label}\n${p.url}`).join('\n\n') : 'No page override is saved for this site.' : '';
    setProperty(el('bookmark-latest'), 'textContent', reviewText);
    setProperty(el('bookmark-conflict-review'), 'hidden', !session.reviewed);
    setProperty(el<HTMLButtonElement>('save-reviewed-bookmarks'), 'disabled', session.busy || !session.reviewed);
    setProperty(el<HTMLButtonElement>('pin-bookmark-parent'), 'disabled', !entry() || !pinEnabled || session.busy);
    setProperty(el('pin-bookmark-parent'), 'textContent', pins.includes(session.parentId ?? '') ? 'Unpin site' : 'Pin site');
    const service = el('bookmark-service-pages'), defaults = entry() ? defaultBookmarkPages(entry()!) : [];
    const serviceKey = JSON.stringify(defaults);
    if (service.dataset.key !== serviceKey) {
      service.dataset.key = serviceKey;
      reconcileChildren(service, defaults.map(p => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
        button.textContent = p.label; button.addEventListener('click', () => open(p.url)); return button;
      }));
    }
    setProperty(el('bookmark-service-entry-points'), 'hidden', !entry());
    for (const button of service.querySelectorAll('button')) setProperty(button, 'disabled', !pinEnabled || session.failure === 'UNAVAILABLE');
  }
  el('bookmark-label').addEventListener('input',()=>{labelDirty=true;});
  el('save-bookmark-label').addEventListener('click',()=>{if(labelBusy||!session.parentId)return;labelBusy=true;render();
    void presentationCommand({kind:'PIN_LABEL',id:session.parentId,label:el<HTMLInputElement>('bookmark-label').value,before:labelBefore}).then(()=>{
      labelDirty=false;labelBefore=presentationView()?.sync.labels[session.parentId!]??null;el('bookmark-label-status').textContent='Shortcut name saved. Site access is unchanged.';
    }).catch(()=>{el('bookmark-label-status').textContent='Name not saved. Your text is retained. If another window changed this shortcut, close and reopen this editor to compare before retrying.';}).finally(()=>{labelBusy=false;render();});});
  for(const direction of ['up','down'])el(`pin-${direction}`).addEventListener('click',()=>{if(labelBusy)return;
    const before=[...pins],next=[...pins],i=next.indexOf(session.parentId!),j=i+(direction==='up'?-1:1);if(i<0||j<0||j>=next.length)return;
    [next[i],next[j]]=[next[j]!,next[i]!];labelBusy=true;render();
    void presentationCommand({kind:'PIN_ORDER',before,pins:next}).then(()=>{pins=next;el('bookmark-label-status').textContent='Pin order saved.';})
      .catch(()=>{el('bookmark-label-status').textContent='Pin order not saved. Another window may have changed it. Review the current order and retry.';}).finally(()=>{labelBusy=false;render();});});
  parent.addEventListener('change', () => void select(parent.value));
  el('add-bookmark-page').addEventListener('click', () => {
    change([...session.draft, { id: crypto.randomUUID(), label: '', url: '' }]);
    el('bookmark-pages').lastElementChild?.querySelector('input')?.focus();
  });
  el('cancel-bookmarks').addEventListener('click', cancel);
  dialog.addEventListener('cancel', e => { e.preventDefault(); cancel(); });
  el('save-bookmarks').addEventListener('click', () => void session.save().then(ok => { if (ok) close(false); }));
  el('review-bookmark-conflict').addEventListener('click', () => void session.reviewLatest());
  el('save-reviewed-bookmarks').addEventListener('click', () => void session.save(true).then(ok => { if (ok) close(false); }));
  el('pin-bookmark-parent').addEventListener('click', () => { if (session.parentId) togglePin(session.parentId); });
  return {
    render(next: readonly DestinationEntry[], order: readonly string[], enabled: boolean) { entries = next; pins = order; pinEnabled = enabled; render(); },
    async open(id?: string, from?: HTMLElement) {
      trigger = from ?? document.activeElement as HTMLElement;
      if (!session.saved) await session.refresh();
      const retained = session.parentId && (entries.some(e => destinationId(e) === session.parentId)
        || session.saved?.value?.groups.some(g => g.parentId === session.parentId)) ? session.parentId : undefined;
      const target = id ?? retained ?? pins.find(p => entries.some(e => destinationId(e) === p))
        ?? (entries[0] ? destinationId(entries[0]) : session.saved?.value?.groups[0]?.parentId);
      if (!target || !session.saved) return;
      if (!session.dirty) { const e = entries.find(e => destinationId(e) === target); await session.edit(target, e ? defaultBookmarkPages(e) : []); }
      setProperty(dialog, 'hidden', false); dialog.showModal(); render(); el('bookmark-editor-title').focus();
    },
  };
}
