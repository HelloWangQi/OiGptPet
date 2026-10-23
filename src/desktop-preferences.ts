export interface DesktopPreferences {
  version: 1;
  scale: 0.8 | 1 | 1.2;
  performance: 'quality' | 'balanced' | 'battery';
}
export type PreferencesPatch = Partial<Pick<DesktopPreferences, 'scale' | 'performance'>>;
export const DEFAULT_PREFERENCES: DesktopPreferences = { version: 1, scale: 1, performance: 'balanced' };
const storageKey = 'oigptpet.preferences.v1';

export const PERFORMANCE_POLICIES = {
  quality: { activeFps: 60, idleFps: 30, maxPixelRatio: 2 },
  balanced: { activeFps: 30, idleFps: 12, maxPixelRatio: 1.5 },
  battery: { activeFps: 15, idleFps: 5, maxPixelRatio: 1 },
} as const;
export const IDLE_AFTER_MS = 10_000;

export function normalizePreferences(value: unknown): DesktopPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<DesktopPreferences> : {};
  if (input.version !== 1) return { ...DEFAULT_PREFERENCES };
  return {
    version: 1,
    scale: input.scale === 0.8 || input.scale === 1.2 ? input.scale : 1,
    performance: input.performance === 'quality' || input.performance === 'battery' ? input.performance : 'balanced',
  };
}

export async function readPreferences(): Promise<DesktopPreferences> {
  if (window.petDesktop) return normalizePreferences(await window.petDesktop.getPreferences());
  try { return normalizePreferences(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}

export async function savePreferences(patch: PreferencesPatch): Promise<DesktopPreferences> {
  if (window.petDesktop) return normalizePreferences(await window.petDesktop.setPreferences(patch));
  const next = normalizePreferences({ ...await readPreferences(), ...patch });
  localStorage.setItem(storageKey, JSON.stringify(next));
  return next;
}
