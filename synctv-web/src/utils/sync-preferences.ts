export interface SyncPreferences { mode: "bidirectional" | "forward" | "off"; tolerance: number; interval: number; }
export const syncPreferencesKey = "synctv:sync-preferences";
export const syncTolerances = [10, 15, 20, 30];
export const syncIntervals = [10, 20, 30, 60];
export const syncModes = [{ value: "bidirectional", html: "双向校准（默认）" }, { value: "forward", html: "仅向前追赶" }, { value: "off", html: "关闭定时校准" }] as const;

export function normalizeSyncPreferences(value: Partial<SyncPreferences> = {}): SyncPreferences {
  return { mode: syncModes.some(mode => mode.value === value.mode) ? value.mode! : "bidirectional",
    tolerance: syncTolerances.includes(value.tolerance!) ? value.tolerance! : 10,
    interval: syncIntervals.includes(value.interval!) ? value.interval! : 10 };
}
export function loadSyncPreferences() {
  try { return normalizeSyncPreferences(JSON.parse(localStorage.getItem(syncPreferencesKey) || "{}") || {}); }
  catch { return normalizeSyncPreferences(); }
}
export function shouldCorrectTime(current: number, target: number, preferences: SyncPreferences) {
  if (!Number.isFinite(current) || !Number.isFinite(target) || preferences.mode === "off") return false;
  const drift = target - current;
  return Math.abs(drift) >= preferences.tolerance && (preferences.mode !== "forward" || drift > 0);
}
