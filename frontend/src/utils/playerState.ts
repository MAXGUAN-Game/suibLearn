export type SubtitleMode = 'original' | 'bilingual' | 'off';
export interface PlayerSettings {
  speed: number;
  subtitle_mode: SubtitleMode;
  sentence_mode: boolean;
  updated_at: number;
}
export interface WatchProgress {
  video_id: string;
  position: number;
  duration: number;
  updated_at: number;
}
export type PlayerSettingsPatch = Partial<Pick<PlayerSettings, 'speed' | 'subtitle_mode' | 'sentence_mode'>>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const SETTINGS_KEY = 'sublearn_player_settings_v1';
const PROGRESS_KEY = 'sublearn_watch_progress_v1';
export const PLAYER_SPEEDS = [.25, .5, .75, 1, 1.25, 1.5, 2, 3];
export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = { speed: 1, subtitle_mode: 'bilingual', sentence_mode: false, updated_at: 0 };

function storage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function parse(key: string, target: StorageLike | null): unknown {
  try { return JSON.parse(target?.getItem(key) || 'null'); } catch { return null; }
}
export function normalizePlayerSettings(value: unknown): PlayerSettings {
  const r = record(value);
  return {
    speed: typeof r.speed === 'number' && PLAYER_SPEEDS.includes(r.speed) ? r.speed : 1,
    subtitle_mode: r.subtitle_mode === 'original' || r.subtitle_mode === 'off' ? r.subtitle_mode : 'bilingual',
    sentence_mode: r.sentence_mode === true,
    updated_at: finite(r.updated_at) ? r.updated_at : 0,
  };
}
export function normalizeProgress(value: unknown, videoId: string): WatchProgress {
  const r = record(value);
  if (r.video_id !== videoId || !finite(r.position) || !finite(r.duration) || r.position > r.duration) {
    return { video_id: videoId, position: 0, duration: 0, updated_at: 0 };
  }
  return { video_id: videoId, position: r.position, duration: r.duration, updated_at: finite(r.updated_at) ? r.updated_at : 0 };
}
export function readPlayerSettings(target: StorageLike | null = storage()): PlayerSettings {
  return normalizePlayerSettings(parse(SETTINGS_KEY, target));
}
export function writePlayerSettings(settings: PlayerSettings, target: StorageLike | null = storage()): void {
  try { target?.setItem(SETTINGS_KEY, JSON.stringify(normalizePlayerSettings(settings))); } catch { /* Playback works without browser storage. */ }
}
export function readWatchProgress(videoId: string, target: StorageLike | null = storage()): WatchProgress {
  return normalizeProgress(record(parse(PROGRESS_KEY, target))[videoId], videoId);
}
export function writeWatchProgress(progress: WatchProgress, target: StorageLike | null = storage()): void {
  const normalized = normalizeProgress(progress, progress.video_id);
  if (normalized.duration <= 0) return;
  try {
    const rows = Object.entries(record(parse(PROGRESS_KEY, target)))
      .filter(([id]) => id !== progress.video_id)
      .map(([id, value]) => [id, normalizeProgress(value, id)] as const)
      .filter(([, row]) => row.duration > 0);
    rows.push([progress.video_id, normalized]);
    rows.sort((a, b) => b[1].updated_at - a[1].updated_at);
    target?.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(rows.slice(0, 200))));
  } catch { /* A full or disabled storage must not interrupt playback. */ }
}
export function newest<T extends { updated_at: number }>(local: T, server: T): T {
  return local.updated_at > server.updated_at ? local : server;
}
export function restorePosition(position: number, duration: number): number {
  if (!finite(position) || !finite(duration) || duration === 0) return 0;
  return Math.min(position, Math.max(0, duration - .05));
}
