import { useState, useCallback, useEffect, useRef } from 'react';
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
  const navigate = useNavigate();

  const [video, setVideo] = useState<VideoItem | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Player control state
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [abLoop, setAbLoop] = useState<{ a: number; b: number } | null>(null);
  const [sentenceMode, setSentenceMode] = useState(false);
  const [speed, setSpeed] = useState(1.0);

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
      } catch (err: any) {
        if (!silent) setError(err.message || '加载失败');
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

  if (loading) {
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
            sentenceMode={sentenceMode}
            speed={speed}
            onSpeedChange={setSpeed}
            onSentenceModeToggle={() => setSentenceMode((v) => !v)}
            onAbLoopClear={handleClearAbLoop}
          />
        </div>

        {/* Subtitle Panel */}
        <div className="lg:w-[420px] lg:min-w-[380px] border-l border-[#2a2a2a] overflow-hidden">
          <SubtitlePanel
            subtitles={subtitles}
            currentTime={currentTime}
            onSeek={handleSeek}
            onSetAbLoop={handleSetAbLoop}
          />
        </div>
      </div>
    </div>
  );
}
