import type { PlayerSettings, PlayerSettingsPatch, WatchProgress } from '../utils/playerState';

// --- Types :::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

export interface VideoItem {
  id: string;
  title: string;
  source_language: string;
  video_filename: string;
  subtitle_filename: string;
  video_path: string;
  subtitle_path: string;
  duration: number | null;
  file_size: number;
  thumbnail_path: string | null;
  status: 'processing' | 'ready' | 'error';
  collection_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtitleLine {
  id: number;
  video_id: string;
  index_num: number;
  start_time: number;
  end_time: number;
  original_text: string;
  translated_text: string | null;
  annotation: {
    romaji: string;
    segments: Array<{
      orig: string;
      hira: string;
      roma: string;
      type: string;
    }>;
  } | null;
  status: string;
}

export interface VideoDetail {
  video: VideoItem;
  subtitles: SubtitleLine[];
}

export interface StorageInfo {
  used_bytes: number;
  total_bytes: number;
  used_gb: number;
  total_gb: number;
  usage_percent: number;
}

export interface UploadResult {
  video_id: string;
  title: string;
  status: string;
  message: string;
}

export interface CollectionItem {
  id: string;
  name: string;
  cover_path: string | null;
  source_language: string;
  video_count: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionDetail {
  collection: CollectionItem;
  videos: VideoItem[];
}

export interface GrammarAnalysisResult {
  sentence: string;
  translation: string;
  summary: string;
  segments: Array<{
    text: string;
    structure: string;
    role: string;
    meaning: string;
    reading_tokens: Array<{ text: string; reading: string }>;
    explanation: string;
  }>;
}

export interface AISettings {
  provider: 'deepseek';
  base_url: string;
  model: string;
  api_key_configured: boolean;
  version: number;
}

export interface AISettingsInput {
  api_key?: string;
  base_url: string;
  model: string;
}

// --- Auth Token Management :::::::::::::::::::::::::::::::::::::::::::::::

const TOKEN_KEY = 'sublearn_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function logout(): void {
  clearToken();
}

// --- API Functions :::::::::::::::::::::::::::::::::::::::::::::::::::::::

const BASE_URL = '/api';

async function playbackRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try { return await request<T>(`/playback${path}`, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}
export function getPlayerSettings(): Promise<PlayerSettings> {
  return playbackRequest('/settings');
}
export function savePlayerSettings(patch: PlayerSettingsPatch): Promise<PlayerSettings> {
  return playbackRequest('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), keepalive: true });
}
export function getWatchProgress(videoId: string): Promise<WatchProgress> {
  return playbackRequest(`/progress/${encodeURIComponent(videoId)}`);
}
export function saveWatchProgress(progress: WatchProgress): Promise<WatchProgress> {
  return playbackRequest(`/progress/${encodeURIComponent(progress.video_id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position: progress.position, duration: progress.duration }), keepalive: true,
  });
}

/** Global callback invoked on 401 so the app can redirect to login */
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void): void {
  onUnauthorized = cb;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const resp = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (resp.status === 401) {
    clearToken();
    onUnauthorized?.();
    throw new Error('未授权，请重新登录');
  }

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ detail: resp.statusText }));
    const detail: unknown = data.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map(item => item && typeof item.msg === 'string' ? item.msg : '').filter(Boolean).join('；')
        : '';
    throw new Error(message || resp.statusText || `请求失败（${resp.status}）`);
  }

  return resp.json();
}

/** Login with password */
export async function login(password: string): Promise<{ token: string }> {
  const result = await request<{ token: string }>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  setToken(result.token);
  return result;
}

/** Verify current token is valid */
export async function verifyToken(): Promise<boolean> {
  try {
    await request<unknown>('/auth/verify');
    return true;
  } catch {
    return false;
  }
}

/** Upload video + subtitle files */
export async function uploadFiles(
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/upload`);

    const token = getToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        clearToken();
        onUnauthorized?.();
        reject(new Error('未授权，请重新登录'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.detail || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.send(formData);
  });
}

/** List all videos */
export async function getVideos(search = '', language = ''): Promise<{ videos: VideoItem[]; total: number }> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (language) params.set('language', language);
  const qs = params.toString();
  return request(`/videos${qs ? `?${qs}` : ''}`);
}

/** Get video detail with subtitles */
export async function getVideoDetail(videoId: string): Promise<VideoDetail> {
  return request(`/videos/${videoId}`);
}

/** Explain the grammar of one subtitle sentence. */
export async function analyzeGrammar(
  text: string,
  translation: string | undefined,
  signal: AbortSignal,
): Promise<GrammarAnalysisResult> {
  return request('/analysis/grammar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, translation }),
    signal,
  });
}

export async function getAISettings(signal?: AbortSignal): Promise<AISettings> {
  return request('/settings/ai', { signal });
}

export async function saveAISettings(settings: AISettingsInput, signal?: AbortSignal): Promise<AISettings> {
  return request('/settings/ai', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
    signal,
  });
}

export async function testAISettings(settings: AISettingsInput, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
  return request('/settings/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
    signal,
  });
}

/** Delete a video */
export async function deleteVideo(videoId: string): Promise<void> {
  await request(`/videos/${videoId}`, { method: 'DELETE' });
}

/** Batch move videos to a collection (null = remove from any collection) */
export async function moveVideosToCollection(
  videoIds: string[],
  collectionId: string | null,
): Promise<{ status: string; moved: number; collection_id: string | null }> {
  return request('/videos/batch/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_ids: videoIds, collection_id: collectionId }),
  });
}

/** Get storage usage info */
export async function getStorageInfo(): Promise<StorageInfo> {
  return request('/upload/storage');
}

/** Get video file URL (served by Nginx) */
export function getVideoFileUrl(videoId: string): string {
  return `/media/${videoId}/video.mp4`;
}

// --- Collection API Functions ::::::::::::::::::::::::::::::::::::::::::::

/** List all collections */
export async function getCollections(): Promise<{ collections: CollectionItem[]; total: number }> {
  return request('/collections');
}

/** Get collection detail with videos */
export async function getCollectionDetail(collectionId: string): Promise<CollectionDetail> {
  return request(`/collections/${collectionId}`);
}

/** Create a new collection */
export async function createCollection(formData: FormData): Promise<CollectionItem> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${BASE_URL}/collections`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (resp.status === 401) {
    clearToken();
    onUnauthorized?.();
    throw new Error('未授权，请重新登录');
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(data.detail || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

/** Update a collection */
export async function updateCollection(collectionId: string, formData: FormData): Promise<CollectionItem> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${BASE_URL}/collections/${collectionId}`, {
    method: 'PUT',
    headers,
    body: formData,
  });
  if (resp.status === 401) {
    clearToken();
    onUnauthorized?.();
    throw new Error('未授权，请重新登录');
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(data.detail || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

/** Delete a collection */
export async function deleteCollection(collectionId: string): Promise<void> {
  await request(`/collections/${collectionId}`, { method: 'DELETE' });
}

/** Get cover image URL */
export function getCoverUrl(coverPath: string): string {
  return `/media/${coverPath}`;
}
