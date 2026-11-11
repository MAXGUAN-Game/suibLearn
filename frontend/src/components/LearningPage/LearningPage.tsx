import { useState, useCallback, useEffect, useRef, useId } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { SubtitleLine } from '../../types';
import {
  getVideoDetail,
  getVideoFileUrl,
  type SubtitleLine as ApiSubtitleLine,
  type VideoItem,
} from '../../services/api';
import VideoPlayer from '../VideoPlayer/VideoPlayer';
import SubtitlePanel from '../SubtitlePanel/SubtitlePanel';
import AISettingsButton from '../AISettings/AISettingsButton';
import { usePlaybackState } from '../../hooks/usePlaybackState';

/** Transform API subtitle format → component subtitle format */
function transformSubtitles(apiSubs: ApiSubtitleLine[]): SubtitleLine[] {
  return apiSubs.map((s) => ({
    start: s.start_time,
    end: s.end_time,
    text: s.original_text,
    translated_text: s.translated_text || '',
    romaji: s.annotation?.romaji || '',
    romaji_segments: (s.annotation?.segments || []) as SubtitleLine['romaji_segments'],
  }));
}

export default function LearningPage() {
  const { videoId } = useParams<{ videoId: string }>();
  return videoId ? <LearningSession key={videoId} videoId={videoId} /> : <p>视频不存在</p>;
}

function LearningSession({ videoId }: { videoId: string }) {
  const navigate = useNavigate();
  const playback = usePlaybackState(videoId);

  const [video, setVideo] = useState<VideoItem | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Player control state
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [abLoop, setAbLoop] = useState<{ a: number; b: number } | null>(null);
  const [subtitlesCollapsed, setSubtitlesCollapsed] = useState(() => {
    try { return localStorage.getItem('sublearn_subtitles_collapsed_v1') === 'true'; }
    catch { return false; }
  });
  const subtitlePanelId = useId();
  const subtitlePanelRef = useRef<HTMLElement>(null);
  const panelToggleUsedRef = useRef(false);
  const setPanelCollapsed = (collapsed: boolean) => {
    panelToggleUsedRef.current = true;
    setSubtitlesCollapsed(collapsed);
  };

  useEffect(() => {
    try { localStorage.setItem('sublearn_subtitles_collapsed_v1', String(subtitlesCollapsed)); }
    catch { /* The panel still works when browser storage is unavailable. */ }
    if (panelToggleUsedRef.current) {
      subtitlePanelRef.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
    }
  }, [subtitlesCollapsed]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch video detail
  const fetchDetail = useCallback(
    async (silent = false) => {
      if (!videoId) return;
      if (!silent) setLoading(true);

      try {
        const detail = await getVideoDetail(videoId);
        setVideo(detail.video);
        setSubtitles(transformSubtitles(detail.subtitles));
        setIsProcessing(detail.video.status === 'processing');
        setError('');
      } catch (err: unknown) {
        if (!silent) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [videoId],
  );

  // Initial fetch
  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Auto-poll while processing
  useEffect(() => {
    if (isProcessing) {
      pollRef.current = setInterval(() => fetchDetail(true), 5000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isProcessing, fetchDetail]);

  // Handlers
  const handleSeek = useCallback((time: number) => {
    setSeekTo(time);
  }, []);

  const handleSetAbLoop = useCallback((a: number, b: number) => {
    setAbLoop({ a, b });
  }, []);

  const handleClearAbLoop = useCallback(() => {
    setAbLoop(null);
  }, []);

  // --- Render ---

  if (loading || !playback.ready) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-[#e0e0e0] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#e74c3c] border-t-transparent mx-auto mb-4" />
          <p className="text-[#a0a0a0]">加载中…</p>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-[#e0e0e0] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error || '视频不存在'}</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-[#e74c3c] rounded-lg hover:bg-[#c0392b] transition"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#e0e0e0]">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-[#2a2a2a] transition min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            ←
          </button>
          <h1 className="text-xl font-bold">
            <span className="text-[#e74c3c]">Sub</span>Learn
          </h1>
        </div>
        <div className="flex items-center gap-3 min-w-0" style={{ marginLeft: 12 }}>
          <span className="text-sm text-[#a0a0a0] truncate max-w-[300px] min-w-0">{video.title}</span>
          <AISettingsButton />
        </div>
      </header>

      {/* Processing banner */}
      {isProcessing && (
        <div className="px-4 py-2 bg-[#2a2a1a] border-b border-[#3a3a2a] text-yellow-400 text-sm flex items-center gap-2">
          <span className="animate-pulse">⏳</span>
          字幕处理中，显示原文字幕...
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col lg:flex-row h-[calc(100vh-60px)]">
        {/* Video Player */}
        <div className="lg:flex-1 lg:min-w-0">
          <VideoPlayer
            src={getVideoFileUrl(videoId!)}
            sourceLanguage={video.source_language}
            subtitles={subtitles}
            onTimeUpdate={setCurrentTime}
            seekTo={seekTo}
            onSeeked={() => setSeekTo(null)}
            abLoop={abLoop}
            sentenceMode={playback.settings.sentence_mode}
            speed={playback.settings.speed}
            subtitleMode={playback.settings.subtitle_mode}
            onSubtitleModeChange={(mode) => playback.changeSettings({ subtitle_mode: mode })}
            initialPosition={playback.initialPosition}
            onProgress={playback.saveProgress}
            onSpeedChange={(value) => playback.changeSettings({ speed: value })}
            onSentenceModeToggle={() => playback.changeSettings({ sentence_mode: !playback.settings.sentence_mode })}
            onAbLoopClear={handleClearAbLoop}
          />
        </div>

        {/* Subtitle Panel */}
        <aside
          ref={subtitlePanelRef}
          aria-label="字幕列表"
          className={`shrink-0 border-l border-[#2a2a2a] overflow-hidden ${subtitlesCollapsed ? 'lg:w-[52px]' : 'lg:w-[420px] lg:min-w-[380px]'}`}
        >
          {subtitlesCollapsed ? (
            <button
              type="button"
              onClick={() => setPanelCollapsed(false)}
              aria-label="展开字幕列表"
              aria-expanded="false"
              aria-controls={subtitlePanelId}
              title="展开字幕列表"
              className="w-full min-h-[52px] flex lg:flex-col items-center justify-center gap-2 p-2 text-sm text-[#a0a0a0] hover:text-white hover:bg-[#2a2a2a] transition"
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 6-6 6 6 6M4 5v14" /></svg>
              <span className="lg:[writing-mode:vertical-rl]">展开字幕</span>
            </button>
          ) : null}
          <div id={subtitlePanelId} className={subtitlesCollapsed ? 'hidden' : 'h-full'}>
            {!subtitlesCollapsed && (
              <SubtitlePanel
                subtitles={subtitles}
                currentTime={currentTime}
                onSeek={handleSeek}
                onSetAbLoop={handleSetAbLoop}
                onCollapse={() => setPanelCollapsed(true)}
                panelId={subtitlePanelId}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
