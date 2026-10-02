import { readConfiguration, type AtlasConfiguration } from '@atlas/core';

function seconds(milliseconds: number): string {
  const digits = String(milliseconds);
  const whole = digits.length > 3 ? digits.slice(0, -3) : '0';
  const fraction = digits.slice(-3).padStart(3, '0').replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

export const timingFields = [
  { id: 'access-wait', label: 'Greylist wait', unit: 'seconds', value: (config: AtlasConfiguration) => seconds(config.accessTiming.waitMs) },
  { id: 'access-window', label: 'Greylist confirmation', unit: 'seconds', value: (config: AtlasConfiguration) => seconds(config.accessTiming.confirmationWindowMs) },
  { id: 'grant-duration', label: 'Temporary access', unit: 'seconds', value: (config: AtlasConfiguration) => seconds(config.accessTiming.grantDurationMs) },
  { id: 'vault-wait', label: 'Vault wait', unit: 'seconds', value: (config: AtlasConfiguration) => seconds(config.vaultTiming.waitMs) },
  { id: 'vault-window', label: 'Vault confirmation', unit: 'seconds', value: (config: AtlasConfiguration) => seconds(config.vaultTiming.confirmationWindowMs) },
  { id: 'journey-lifetime', label: 'Journey lifetime', unit: 'seconds', value: (config: AtlasConfiguration) => seconds(config.journeyLimits.lifetimeMs) },
  { id: 'journey-hops', label: 'Journey limit', unit: 'hops', value: (config: AtlasConfiguration) => String(config.journeyLimits.maxHops) },
] as const;

export type TimingFieldId = typeof timingFields[number]['id'];
export type TimingDraft = Readonly<Record<TimingFieldId, string>>;

export function settingsCopy(config: AtlasConfiguration): string {
  return timingFields.map((field) => `${field.label}: ${field.value(config)} ${field.unit}`).join(' · ');
}

/** Move the decimal point exactly, including scientific notation, before using a number. */
function decimalInteger(value: string, decimalShift: number): number {
  const parts = value.trim().match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (parts === null) return NaN;
  const whole = parts[1] ?? '';
  const fraction = parts[2] ?? '';
  if (whole === '' && fraction === '') return NaN;
  const digits = `${whole}${fraction}`.replace(/^0+/, '');
  if (digits === '') return 0;
  const shift = Number(parts[3] ?? '0') + decimalShift - fraction.length;
  if (!Number.isSafeInteger(shift)) return NaN;
  if (shift >= 0) return digits.length + shift > 16 ? NaN : Number(digits) * 10 ** shift;
  const kept = digits.length + shift;
  return kept > 0 && !/[1-9]/.test(digits.slice(kept)) ? Number(digits.slice(0, kept)) : NaN;
}

/** Translate display units without silently changing the user's proposed duration. */
export function configurationFromDraft(draft: TimingDraft): AtlasConfiguration | null {
  const milliseconds = (id: TimingFieldId): number => decimalInteger(draft[id], 3);
  return readConfiguration({
    accessTiming: { waitMs: milliseconds('access-wait'), confirmationWindowMs: milliseconds('access-window'), grantDurationMs: milliseconds('grant-duration') },
    vaultTiming: { waitMs: milliseconds('vault-wait'), confirmationWindowMs: milliseconds('vault-window') },
    journeyLimits: { lifetimeMs: milliseconds('journey-lifetime'), maxHops: decimalInteger(draft['journey-hops'], 0) },
  });
}
