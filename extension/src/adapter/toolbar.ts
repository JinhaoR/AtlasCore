import type { AtlasNavigationDecision } from '@atlas/core';
export const controlPages = ['home', 'sites', 'access', 'vault', 'settings'] as const;
export type ControlPage = typeof controlPages[number];
export interface ToolbarStatus {
  ready: boolean; tabId: number; contextId: string | null; hostname: string | null;
  decision: AtlasNavigationDecision | null;
  journey: { hostname: string; expiresAt: number } | null;
}
export function toolbarRequest(input: unknown): input is
  { kind: 'GET_TOOLBAR_STATUS'; tabId: number } |
  { kind: 'OPEN_CONTROL_PAGE'; page: ControlPage; tabId: number; contextId: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const v = input as Record<string, unknown>;
  if (!Number.isSafeInteger(v.tabId) || (v.tabId as number) < 0) return false;
  if (v.kind === 'GET_TOOLBAR_STATUS') return Object.keys(v).sort().join(',') === 'kind,tabId';
  return v.kind === 'OPEN_CONTROL_PAGE' && Object.keys(v).sort().join(',') === 'contextId,kind,page,tabId'
    && controlPages.includes(v.page as ControlPage)
    && (v.contextId === null || typeof v.contextId === 'string' && v.contextId.length <= 200);
}
