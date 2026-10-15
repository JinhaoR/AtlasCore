import { normalizeTarget } from '@atlas/core';

/** Inspect only these public protocol fields; never retain headers or filenames. */
export function isAttachment(status: number, headers: browser.webRequest.HttpHeaders | undefined): boolean {
  const values = headers?.filter(header => header.name.toLowerCase() === 'content-disposition');
  return status >= 200 && status < 300 && values?.length === 1
    && typeof values[0]!.value === 'string' && !/[\r\n\0]/.test(values[0]!.value!)
    && /^attachment(?:\s*;|\s*$)/i.test(values[0]!.value!.trim());
}

export function hasUserActivation(headers: browser.webRequest.HttpHeaders | undefined): boolean {
  const values = headers?.filter(header => header.name.toLowerCase() === 'sec-fetch-user');
  return values?.length === 1 && values[0]!.value === '?1';
}

export const isHttpRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

/** A non-HTTP redirect could leave the next request gate entirely. */
export function downloadRedirectUrl(url: string, headers: browser.webRequest.HttpHeaders | undefined): string | null {
  const values = headers?.filter(header => header.name.toLowerCase() === 'location');
  if (values?.length !== 1 || typeof values[0]!.value !== 'string' || /[\r\n\0]/.test(values[0]!.value!)) return null;
  try {
    const target = new URL(values[0]!.value!, url);
    if (normalizeTarget(target.href) === null) return null;
    target.hash = '';
    return target.href;
  } catch { return null; }
}
