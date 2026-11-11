import { savePlayerSettings, saveWatchProgress } from './api';
import { normalizePlayerSettings, normalizeProgress, readPlayerSettings, readWatchProgress, writePlayerSettings, writeWatchProgress } from '../utils/playerState';
import type { PlayerSettings, PlayerSettingsPatch, WatchProgress } from '../utils/playerState';

// Coalesce changes while a request is running. Queues outlive route components,
// so a late response from the previous episode cannot overwrite a newer local edit.
let settingsPending: { value: PlayerSettings; patch: PlayerSettingsPatch } | null = null;
let settingsRunning = false;
const progressPending = new Map<string, WatchProgress>();
let progressRunning = false;

async function drainSettings() {
  if (settingsRunning) return;
  settingsRunning = true;
  try {
    while (settingsPending) {
      const current = settingsPending;
      settingsPending = null;
      try {
        const response = await savePlayerSettings(current.patch);
        if (readPlayerSettings().updated_at === current.value.updated_at) writePlayerSettings(normalizePlayerSettings(response));
      } catch {
        const newer = settingsPending as typeof current | null;
        settingsPending = newer ? { value: newer.value, patch: { ...current.patch, ...newer.patch } } : current;
        break;
      }
    }
  } finally { settingsRunning = false; }
}
async function drainProgress() {
  if (progressRunning) return;
  progressRunning = true;
  try {
    while (progressPending.size) {
      const current = progressPending.values().next().value!;
      progressPending.delete(current.video_id);
      try {
        const response = await saveWatchProgress(current);
        if (readWatchProgress(current.video_id).updated_at === current.updated_at) writeWatchProgress(normalizeProgress(response, current.video_id));
      } catch {
        if (!progressPending.has(current.video_id)) progressPending.set(current.video_id, current);
        break;
      }
    }
  } finally { progressRunning = false; }
}
export function syncPlayerSettings(value: PlayerSettings, patch: PlayerSettingsPatch) {
  settingsPending = { value, patch: { ...settingsPending?.patch, ...patch } };
  void drainSettings();
}
export function syncWatchProgress(value: WatchProgress) {
  progressPending.set(value.video_id, value);
  void drainProgress();
}
export function retryPlaybackSync() { void drainSettings(); void drainProgress(); }
