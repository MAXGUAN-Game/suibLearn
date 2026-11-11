import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlayerSettings, getWatchProgress } from '../services/api';
import { retryPlaybackSync, syncPlayerSettings, syncWatchProgress } from '../services/playbackPersistence';
import { newest, normalizePlayerSettings, normalizeProgress, readPlayerSettings, readWatchProgress, writePlayerSettings, writeWatchProgress } from '../utils/playerState';
import type { PlayerSettingsPatch, WatchProgress } from '../utils/playerState';

export function usePlaybackState(videoId: string) {
  const [settings, setSettings] = useState(readPlayerSettings);
  const [initialPosition, setInitialPosition] = useState(() => readWatchProgress(videoId).position);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);
  const settingsRef = useRef(settings);
  const latestProgress = useRef<WatchProgress | null>(null);
  const lastLocalSave = useRef(0);
  const lastRemoteSave = useRef(0);
  const progressClock = useRef(0);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getPlayerSettings(), getWatchProgress(videoId)]).then(([prefsResult, progressResult]) => {
      if (!active) return;
      const localPrefs = readPlayerSettings();
      const serverPrefs = prefsResult.status === 'fulfilled' ? normalizePlayerSettings(prefsResult.value) : null;
      const prefs = serverPrefs ? newest(localPrefs, serverPrefs) : localPrefs;
      settingsRef.current = prefs;
      setSettings(prefs);
      writePlayerSettings(prefs);
      if (prefs.updated_at > (serverPrefs?.updated_at ?? 0)) syncPlayerSettings(prefs, { speed: prefs.speed, subtitle_mode: prefs.subtitle_mode, sentence_mode: prefs.sentence_mode });

      const localProgress = readWatchProgress(videoId);
      const serverProgress = progressResult.status === 'fulfilled' ? normalizeProgress(progressResult.value, videoId) : null;
      const progress = serverProgress ? newest(localProgress, serverProgress) : localProgress;
      progressClock.current = progress.updated_at;
      writeWatchProgress(progress);
      setInitialPosition(progress.position);
      if (progress.duration > 0 && progress.updated_at > (serverProgress?.updated_at ?? 0)) syncWatchProgress(progress);
      hydrated.current = true;
      setReady(true);
    });
    return () => { active = false; };
  }, [videoId]);

  const changeSettings = useCallback((patch: PlayerSettingsPatch) => {
    const updated = normalizePlayerSettings({ ...settingsRef.current, ...patch, updated_at: Math.max(Date.now(), settingsRef.current.updated_at + 1, readPlayerSettings().updated_at + 1) });
    settingsRef.current = updated;
    setSettings(updated);
    writePlayerSettings(updated);
    syncPlayerSettings(updated, patch);
  }, []);

  const saveProgress = useCallback((position: number, duration: number, flush = false) => {
    if (!hydrated.current || !Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    const value = { video_id: videoId, position: Math.max(0, Math.min(position, duration)), duration, updated_at: Math.max(now, progressClock.current + 1) };
    if (flush || now - lastLocalSave.current >= 1000) {
      value.updated_at = Math.max(value.updated_at, readWatchProgress(videoId).updated_at + 1);
      writeWatchProgress(value);
      lastLocalSave.current = now;
    }
    progressClock.current = value.updated_at;
    latestProgress.current = value;
    if (flush || now - lastRemoteSave.current >= 5000) {
      syncWatchProgress(value);
      lastRemoteSave.current = now;
    }
  }, [videoId]);

  useEffect(() => {
    const flush = () => {
      const progress = latestProgress.current;
      if (progress) saveProgress(progress.position, progress.duration, true);
    };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', retryPlaybackSync);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', retryPlaybackSync);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [saveProgress]);

  return { ready, settings, initialPosition, changeSettings, saveProgress };
}
