import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCollections,
  createCollection,
  deleteCollection,
  getStorageInfo,
  getCoverUrl,
} from '../../services/api';
import type { CollectionItem, StorageInfo } from '../../services/api';
import AISettingsButton from '../AISettings/AISettingsButton';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANG_FLAGS: Record<string, string> = {
  ja: '🇯🇵',
  en: '🇺🇸',
  zh: '🇨🇳',
  ko: '🇰🇷',
};

const LANG_LABELS: Record<string, string> = {
  ja: '日语',
  en: '英语',
  zh: '中文',
  ko: '韩语',
};

const LANGUAGES = [
  { value: 'ja', label: '🇯🇵 日语' },
  { value: 'en', label: '🇺🇸 英语' },
  { value: 'zh', label: '🇨🇳 中文' },
  { value: 'ko', label: '🇰🇷 韩语' },
];

const GRADIENTS = [
  'from-rose-600 to-orange-500',
  'from-violet-600 to-indigo-500',
  'from-cyan-600 to-blue-500',
  'from-emerald-600 to-teal-500',
  'from-amber-600 to-yellow-500',
  'from-pink-600 to-fuchsia-500',
  'from-sky-600 to-cyan-500',
  'from-red-600 to-pink-500',
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

// ---------------------------------------------------------------------------
// Create Collection Modal
// ---------------------------------------------------------------------------

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (c: CollectionItem) => void;
}

function CreateCollectionModal({ open, onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('ja');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form when opening
  useEffect(() => {
    if (open) {
      setName('');
      setLanguage('ja');
      setCoverFile(null);
      setCoverPreview(null);
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  // Generate preview URL
  useEffect(() => {
    if (!coverFile) {
      setCoverPreview(null);
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const handleCoverChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!validTypes.includes(file.type)) {
        setError('封面仅支持 jpg, png, webp, gif 格式');
        return;
      }
    }
    setCoverFile(file);
    setError('');
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入合集名称');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('source_language', language);
      if (coverFile) {
        formData.append('cover', coverFile);
      }
      const collection = await createCollection(formData);
      onCreated(collection);
    } catch (err: any) {
      setError(err.message || '创建失败，请重试');
      setSubmitting(false);
    }
  }, [name, language, coverFile, onCreated]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold">
            <span className="text-[#e74c3c]">新建</span>合集
          </h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-2 rounded-lg hover:bg-[#2a2a2a] transition min-w-[44px] min-h-[44px] flex items-center justify-center text-[#888] hover:text-[#e0e0e0] disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm text-[#888] mb-1.5">合集名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：日剧精选、英语纪录片…"
              disabled={submitting}
              autoFocus
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-[#e0e0e0] placeholder-[#555] focus:border-[#e74c3c] outline-none transition disabled:opacity-50 min-h-[44px]"
            />
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm text-[#888] mb-1.5">源语言</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={submitting}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-[#e0e0e0] focus:border-[#e74c3c] outline-none transition disabled:opacity-50 min-h-[44px] cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Cover Image */}
          <div>
            <label className="block text-sm text-[#888] mb-1.5">封面图片（可选）</label>
            <div
              className={`relative flex flex-col items-center justify-center w-full min-h-[120px] border-2 border-dashed rounded-xl cursor-pointer transition-colors overflow-hidden ${
                coverPreview
                  ? 'border-[#e74c3c] bg-[#1a1010]'
                  : 'border-[#333] hover:border-[#e74c3c]/60 hover:bg-[#1a1a1a]'
              }`}
              onClick={() => !submitting && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleCoverChange}
                disabled={submitting}
                className="hidden"
              />
              {coverPreview ? (
                <div className="relative w-full h-32">
                  <img
                    src={coverPreview}
                    alt="封面预览"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition">
                    <span className="text-sm text-white">点击更换</span>
                  </div>
                </div>
              ) : (
                <div className="text-center p-6">
                  <div className="text-3xl mb-2 opacity-40">🖼️</div>
                  <p className="text-sm text-[#666]">点击选择封面图片</p>
                  <p className="text-xs text-[#555] mt-1">jpg, png, webp, gif</p>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-[#2a1515] border border-[#e74c3c]/30 rounded-lg">
              <span className="text-[#e74c3c] shrink-0">⚠</span>
              <p className="text-sm text-[#e74c3c]">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-xl border border-[#333] text-[#888] hover:bg-[#2a2a2a] hover:text-[#e0e0e0] transition min-h-[44px] disabled:opacity-40 font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-xl bg-[#e74c3c] text-white font-medium hover:bg-[#c0392b] transition min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? '创建中...' : '创建合集'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface CollectionListProps {
  onLogout?: () => void;
}

export default function CollectionList({ onLogout }: CollectionListProps) {
  const navigate = useNavigate();

  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---- data fetching ----

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [collectionsRes, storageRes] = await Promise.all([
        getCollections(),
        getStorageInfo(),
      ]);
      setCollections(collectionsRes.collections);
      setStorage(storageRes);
    } catch (err: any) {
      setError(err.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---- search filter ----

  const filteredCollections = collections.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  // ---- create ----

  const handleCreated = useCallback((collection: CollectionItem) => {
    setCollections((prev) => [collection, ...prev]);
    setShowCreateModal(false);
  }, []);

  // ---- delete ----

  const handleDeleteClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    setDeletingId(confirmDeleteId);
    setConfirmDeleteId(null);
    try {
      await deleteCollection(confirmDeleteId);
      setCollections((prev) => prev.filter((c) => c.id !== confirmDeleteId));
      const storageRes = await getStorageInfo();
      setStorage(storageRes);
    } catch (err: any) {
      setError(err.message || '删除失败');
    } finally {
      setDeletingId(null);
    }
  }, [confirmDeleteId]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  // ---- render ----

  const storagePercent = storage ? storage.usage_percent : 0;
  const storageBarColor =
    storagePercent > 90 ? 'bg-red-500' : storagePercent > 70 ? 'bg-yellow-500' : 'bg-[#e74c3c]';

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#e0e0e0]">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-[#0f0f0f]/95 backdrop-blur border-b border-[#2a2a2a]">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 py-3">
          <h1 className="text-xl font-bold">
            <span className="text-[#e74c3c]">Sub</span>Learn
            <span className="text-sm text-[#666] ml-2 font-normal hidden sm:inline">合集</span>
          </h1>
          <div className="flex items-center gap-2">
            <AISettingsButton />
            <button
              onClick={() => navigate('/videos')}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#333] text-[#a0a0a0] hover:text-[#e0e0e0] hover:border-[#555] transition min-h-[44px] text-sm font-medium"
            >
              <span className="text-base leading-none">📋</span>
              <span className="hidden sm:inline">全部视频</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#e74c3c] text-white font-medium hover:bg-[#c0392b] transition min-h-[44px] min-w-[44px] text-sm"
            >
              <span className="text-lg leading-none">＋</span>
              <span className="hidden sm:inline">新建合集</span>
            </button>
            {onLogout && (
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#333] text-[#666] hover:text-[#e74c3c] hover:border-[#e74c3c]/40 transition min-h-[44px] text-sm"
                title="退出登录"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span className="hidden sm:inline">退出</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── Storage Bar ──────────────────────────────────── */}
        {storage && (
          <div className="bg-[#181818] border border-[#2a2a2a] rounded-xl p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[#a0a0a0]">存储空间</span>
              <span className="text-[#e0e0e0] font-medium">
                {storage.used_gb.toFixed(1)} GB / {storage.total_gb} GB 已使用
              </span>
            </div>
            <div className="w-full h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${storageBarColor}`}
                style={{ width: `${Math.min(storagePercent, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Search Bar ──────────────────────────────────── */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-lg pointer-events-none">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索合集..."
            className="w-full bg-[#181818] border border-[#2a2a2a] rounded-xl pl-10 pr-4 py-3 text-[#e0e0e0] placeholder-[#555] focus:border-[#e74c3c] outline-none transition min-h-[44px]"
          />
        </div>

        {/* ── Error ────────────────────────────────────────── */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-[#2a1515] border border-[#e74c3c]/30 rounded-lg">
            <span className="text-[#e74c3c] shrink-0">⚠</span>
            <p className="text-sm text-[#e74c3c]">{error}</p>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[#e74c3c] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[#888]">加载中...</span>
            </div>
          </div>
        )}

        {/* ── Empty State ──────────────────────────────────── */}
        {!loading && collections.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-6xl mb-4 opacity-30">📚</div>
            <h3 className="text-lg font-medium text-[#a0a0a0] mb-2">还没有合集</h3>
            <p className="text-sm text-[#666] mb-6 max-w-xs">
              创建你的第一个合集，把相关视频归类在一起，方便系统学习
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#e74c3c] text-white font-medium hover:bg-[#c0392b] transition min-h-[44px]"
            >
              创建第一个合集
            </button>
          </div>
        )}

        {/* ── No search results ─────────────────────────────── */}
        {!loading && collections.length > 0 && filteredCollections.length === 0 && search && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3 opacity-30">🔍</div>
            <p className="text-sm text-[#888]">没有找到匹配"{search}"的合集</p>
          </div>
        )}

        {/* ── Collection Grid ───────────────────────────────── */}
        {!loading && filteredCollections.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredCollections.map((collection) => {
              const flag = LANG_FLAGS[collection.source_language] ?? '🌐';
              const langLabel = LANG_LABELS[collection.source_language] ?? collection.source_language;
              const isDeleting = deletingId === collection.id;
              const gradient = getGradient(collection.name);
              const firstChar = collection.name.charAt(0).toUpperCase();

              return (
                <div
                  key={collection.id}
                  onClick={() => navigate(`/collection/${collection.id}`)}
                  className={`group relative bg-[#181818] border border-[#2a2a2a] rounded-xl overflow-hidden transition-all duration-200 cursor-pointer hover:border-[#e74c3c]/50 hover:shadow-lg hover:shadow-[#e74c3c]/5 hover:-translate-y-0.5 ${
                    isDeleting ? 'opacity-40 pointer-events-none' : ''
                  }`}
                >
                  {/* Cover Image / Placeholder */}
                  <div className="relative w-full aspect-[16/10] overflow-hidden">
                    {collection.cover_path ? (
                      <img
                        src={getCoverUrl(collection.cover_path)}
                        alt={collection.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center transition-transform duration-300 group-hover:scale-105`}>
                        <span className="text-4xl font-bold text-white/80 select-none">
                          {firstChar}
                        </span>
                      </div>
                    )}
                    {/* Overlay gradient for readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

                    {/* Video count badge */}
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-xs font-medium bg-black/60 text-white backdrop-blur-sm">
                      {collection.video_count} 个视频
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDeleteClick(e, collection.id)}
                      disabled={isDeleting}
                      className="absolute top-2 left-2 p-2 rounded-lg text-white/70 hover:text-[#e74c3c] hover:bg-black/40 transition opacity-0 group-hover:opacity-100 focus:opacity-100 min-w-[44px] min-h-[44px] flex items-center justify-center backdrop-blur-sm"
                      title="删除合集"
                    >
                      🗑️
                    </button>
                  </div>

                  {/* Card body */}
                  <div className="p-4 space-y-2">
                    {/* Collection name */}
                    <h3 className="text-sm font-semibold leading-snug line-clamp-2">
                      {collection.name}
                    </h3>

                    {/* Language badge */}
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-[#222] border border-[#333] text-[#ccc]">
                        {flag} {langLabel}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Create Collection Modal ─────────────────────────── */}
      <CreateCollectionModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleCreated}
      />

      {/* ── Confirm Delete Dialog ───────────────────────────── */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={handleCancelDelete}
        >
          <div
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2">确认删除</h3>
            <p className="text-sm text-[#a0a0a0] mb-6">
              此操作不可撤销，合集及其中所有视频数据将被永久删除。
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCancelDelete}
                className="flex-1 px-4 py-3 rounded-xl border border-[#333] text-[#888] hover:bg-[#2a2a2a] hover:text-[#e0e0e0] transition min-h-[44px] font-medium"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-3 rounded-xl bg-[#e74c3c] text-white font-medium hover:bg-[#c0392b] transition min-h-[44px]"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
