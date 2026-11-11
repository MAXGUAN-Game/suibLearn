import { useRef, useEffect, useCallback, useState, useMemo, useId } from 'react';
import type { SubtitleLine } from '../../types';
import GrammarAnalysis from '../GrammarAnalysis/GrammarAnalysis';
import { getActiveSubtitleIndex } from '../../utils/subtitleSelection';
import { PLAYER_SPEEDS, restorePosition } from '../../utils/playerState';
import type { SubtitleMode } from '../../utils/playerState';
import { usePlayerFullscreen } from './usePlayerFullscreen';
import './VideoPlayer.css';

interface Props {
  src: string;
  audioSrc?: string;  // Separate audio stream for DASH (Bilibili)
  sourceLanguage?: string;
  subtitles: SubtitleLine[];
  onTimeUpdate: (time: number) => void;
  seekTo: number | null;
  onSeeked: () => void;
  abLoop: { a: number; b: number } | null;
  sentenceMode: boolean;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onSentenceModeToggle: () => void;
  onAbLoopClear: () => void;
  subtitleMode: SubtitleMode;
  onSubtitleModeChange: (mode: SubtitleMode) => void;
  initialPosition?: number;
  onProgress?: (position: number, duration: number, flush?: boolean) => void;
}

const SPEED_OPTIONS = PLAYER_SPEEDS;
const SUBTITLE_LABELS: Record<string, { original: string; bilingual: string }> = {
  ja: { original: '日语', bilingual: '日中字幕' },
  en: { original: '英语', bilingual: '英中字幕' },
  ko: { original: '韩语', bilingual: '韩中字幕' },
  zh: { original: '中文', bilingual: '双语字幕' },
};
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({
  src, audioSrc, sourceLanguage = 'ja', subtitles, onTimeUpdate, seekTo, onSeeked,
  abLoop, sentenceMode, speed, onSpeedChange, onSentenceModeToggle, onAbLoopClear,
  subtitleMode, onSubtitleModeChange, initialPosition = 0, onProgress,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const { fullscreen, viewport, pending: fullscreenPending, message: fullscreenMessage, toggle: toggleFullscreen } = usePlayerFullscreen(containerRef, fullscreenButtonRef);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [analysisTarget, setAnalysisTarget] = useState<{ src: string; subtitle: SubtitleLine } | null>(null);
  const analysisButtonRef = useRef<HTMLButtonElement>(null);
  const subtitleControlRef = useRef<HTMLDivElement>(null);
  const subtitleButtonRef = useRef<HTMLButtonElement>(null);
  const subtitleMenuId = useId();
  const lastSentenceIdx = useRef(-1);
  const syncingRef = useRef(false);  // Prevent sync loops
  const restoredRef = useRef(false);
  const initialSeekRef = useRef<number | null>(null);

  useEffect(() => {
    const screen = screenRef.current;
    const video = videoRef.current;
    if (!screen || !video) return;
    const update = () => {
      const bounds = screen.getBoundingClientRect();
      const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : bounds.width / bounds.height;
      const imageHeight = Math.min(bounds.height, bounds.width / ratio);
      screen.style.setProperty('--video-bottom-gap', `${Math.max(0, (bounds.height - imageHeight) / 2) || 0}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(screen);
    video.addEventListener('loadedmetadata', update);
    return () => { observer.disconnect(); video.removeEventListener('loadedmetadata', update); };
  }, []);

  const hasSeparateAudio = Boolean(audioSrc);
  const language = sourceLanguage.trim().toLowerCase().split(/[-_]/)[0];
  const labels = SUBTITLE_LABELS[language] ?? { original: '原文', bilingual: '双语字幕' };
  const subtitleOptions = [
    { value: 'original', label: labels.original },
    { value: 'bilingual', label: labels.bilingual },
    { value: 'off', label: '无字幕' },
  ] as const;
  const subtitleLabel = subtitleOptions.find(option => option.value === subtitleMode)!.label;

  useEffect(() => {
    if (!showSubtitleMenu) return;

    subtitleControlRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!subtitleControlRef.current?.contains(event.target as Node)) {
        setShowSubtitleMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSubtitleMenu(false);
        subtitleButtonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSubtitleMenu]);

  // Current subtitle for overlay
  const currentSub = useMemo(() => {
    return subtitles[getActiveSubtitleIndex(subtitles, currentTime)];
  }, [subtitles, currentTime]);
  const showAnalysis = analysisTarget !== null && analysisTarget.src === src &&
    analysisTarget.subtitle.start === currentSub?.start && analysisTarget.subtitle.end === currentSub?.end &&
    analysisTarget.subtitle.text === currentSub?.text;
  const closeAnalysis = useCallback(() => setAnalysisTarget(null), []);

  // Sync audio to video time (for DASH)
  const syncAudio = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !hasSeparateAudio || syncingRef.current) return;

    // Sync time if drifted more than 0.3s
    if (Math.abs(video.currentTime - audio.currentTime) > 0.3) {
      syncingRef.current = true;
      audio.currentTime = video.currentTime;
      syncingRef.current = false;
    }
  }, [hasSeparateAudio]);

  // High-precision time tracking via RAF
  const tick = useCallback(function trackPlayback() {
    const video = videoRef.current;
    if (video && !video.paused) {
      const t = video.currentTime;
      setCurrentTime(t);
      onTimeUpdate(t);
      if (restoredRef.current) onProgress?.(t, video.duration);

      // Sync audio for DASH
      syncAudio();

      // AB Loop check
      if (abLoop && t >= abLoop.b) {
        video.currentTime = abLoop.a;
        if (audioRef.current && hasSeparateAudio) {
          audioRef.current.currentTime = abLoop.a;
        }
      }

      // Sentence mode check
      if (sentenceMode) {
        const idx = getActiveSubtitleIndex(subtitles, t);
        if (idx >= 0 && idx !== lastSentenceIdx.current) {
          // New sentence started
          lastSentenceIdx.current = idx;
        }
        if (lastSentenceIdx.current >= 0) {
          const sub = subtitles[lastSentenceIdx.current];
          if (sub && t >= sub.end - 0.05) {
            video.pause();
            if (audioRef.current && hasSeparateAudio) {
              audioRef.current.pause();
            }
            setPlaying(false);
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(trackPlayback);
  }, [onTimeUpdate, onProgress, abLoop, sentenceMode, subtitles, syncAudio, hasSeparateAudio]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Handle seek from external
  useEffect(() => {
    if (seekTo !== null && videoRef.current) {
      if (videoRef.current.readyState < 1) return; // Apply it when metadata arrives.
      initialSeekRef.current = null; // An explicit user seek supersedes resume.
      restoredRef.current = true;
      videoRef.current.currentTime = seekTo;
      setCurrentTime(seekTo);
      onTimeUpdate(seekTo);
      lastSentenceIdx.current = -1;
      closeAnalysis();
      if (audioRef.current && hasSeparateAudio) {
        audioRef.current.currentTime = seekTo;
      }
      onSeeked();
    }
  }, [seekTo, onSeeked, hasSeparateAudio, onTimeUpdate, closeAnalysis]);

  // Handle speed change
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    if (audioRef.current && hasSeparateAudio) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, hasSeparateAudio]);

  const togglePlay = () => {
    closeAnalysis();
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      if (audio && hasSeparateAudio) {
        audio.currentTime = video.currentTime;
        audio.play();
      }
      setPlaying(true);
      lastSentenceIdx.current = -1;
    } else {
      video.pause();
      if (audio && hasSeparateAudio) {
        audio.pause();
      }
      setPlaying(false);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    closeAnalysis();
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = ratio * duration;
    initialSeekRef.current = null;
    restoredRef.current = true;
    video.currentTime = newTime;
    setCurrentTime(newTime);
    onTimeUpdate(newTime);
    lastSentenceIdx.current = -1;
    if (audioRef.current && hasSeparateAudio) {
      audioRef.current.currentTime = newTime;
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="video-player"
      data-player-fullscreen={fullscreen ? 'true' : undefined}
      data-fullscreen-mode={fullscreen ? viewport ? 'viewport' : 'native' : 'inline'}
      className={`video-player flex flex-col h-full bg-black${fullscreen ? ' is-fullscreen' : ''}${viewport ? ' is-viewport-fullscreen' : ''}`}
    >
      {fullscreenMessage && <div className="player-fullscreen-message" role="status">{fullscreenMessage}</div>}
      {/* Letterbox Cinema Layout: video + subtitle bar below */}
      <div ref={screenRef} data-testid="player-screen" className="video-player-screen relative flex-1 flex flex-col min-h-0">
        {/* Video Area (with black bars on sides/top) */}
        <div className="flex-1 flex items-center justify-center bg-black min-h-0" onClick={togglePlay}>
          <video
            ref={videoRef}
            src={src}
            className="video-player-video max-w-full max-h-full"
            onLoadedMetadata={(e) => {
              const element = e.currentTarget;
              setDuration(element.duration);
              if (!restoredRef.current) {
                const position = restorePosition(seekTo ?? initialPosition, element.duration);
                initialSeekRef.current = position > 0 ? position : null;
                restoredRef.current = position === 0;
                element.currentTime = position;
                setCurrentTime(position);
                onTimeUpdate(position);
                if (seekTo !== null) onSeeked();
              }
              element.playbackRate = speed;
            }}
            onLoadedData={(e) => {
              // Some streams reset an early metadata-time seek to zero. Retry
              // after the first decoded frame; never save that transient zero.
              if (initialSeekRef.current !== null) e.currentTarget.currentTime = initialSeekRef.current;
            }}
            onPlay={() => {
              closeAnalysis();
              setPlaying(true);
              if (audioRef.current && hasSeparateAudio) {
                audioRef.current.currentTime = videoRef.current!.currentTime;
                audioRef.current.play();
              }
            }}
            onPause={() => {
              setPlaying(false);
              if (restoredRef.current && videoRef.current) onProgress?.(videoRef.current.currentTime, videoRef.current.duration, true);
              if (audioRef.current && hasSeparateAudio) {
                audioRef.current.pause();
              }
            }}
            onSeeked={() => {
              closeAnalysis();
              if (videoRef.current) {
                const initialSeek = initialSeekRef.current;
                if (initialSeek !== null) {
                  if (Math.abs(initialSeek - videoRef.current.currentTime) > .15) return;
                  initialSeekRef.current = null;
                  restoredRef.current = true;
                }
                setCurrentTime(videoRef.current.currentTime);
                onTimeUpdate(videoRef.current.currentTime);
                if (restoredRef.current && initialSeek === null) {
                  onProgress?.(videoRef.current.currentTime, videoRef.current.duration, true);
                }
              }
              if (audioRef.current && hasSeparateAudio && videoRef.current) {
                audioRef.current.currentTime = videoRef.current.currentTime;
              }
            }}
            onEnded={(e) => { setPlaying(false); onProgress?.(e.currentTarget.duration, e.currentTarget.duration, true); }}
            playsInline
          />

          {/* Hidden audio element for DASH separate audio */}
          {hasSeparateAudio && (
            <audio ref={audioRef} src={audioSrc} preload="auto" />
          )}
        </div>

        {/* Subtitle Bar - fixed height black band below video (like cinema letterbox) */}
        <div data-testid="player-subtitles" data-overlay={fullscreen} className="video-player-subtitles bg-black flex items-center justify-center px-6 h-[88px] shrink-0 overflow-y-auto">
          {subtitleMode !== 'off' && currentSub ? (
            <div className="text-center max-w-[90%]">
              <p className="player-subtitle-original text-white text-base font-medium leading-snug">
                {currentSub.text}
              </p>
              {subtitleMode === 'bilingual' && currentSub.translated_text && (
                <p className="player-subtitle-translation text-[#b0b0b0] text-sm leading-snug mt-0.5">
                  {currentSub.translated_text}
                </p>
              )}
            </div>
          ) : (
            <div className="h-4" /> /* Empty spacer when no subtitle */
          )}
        </div>
      </div>

      {/* Controls Bar */}
      <div data-testid="player-controls" className="relative shrink-0 z-20 bg-[#141414] px-4 py-2 border-t border-[#2a2a2a]">
        {/* Progress Bar */}
        <div
          className="w-full h-2 bg-[#2a2a2a] rounded cursor-pointer mb-2 group"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-[#e74c3c] rounded transition-all duration-100"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-between flex-wrap gap-y-1">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-[#2a2a2a] transition text-xl"
            >
              {playing ? '⏸' : '▶️'}
            </button>

            {/* Time Display */}
            <span className="text-sm text-[#a0a0a0] font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              ref={analysisButtonRef}
              type="button"
              disabled={!currentSub?.text.trim()}
              aria-label="解析当前台词语法"
              aria-expanded={showAnalysis}
              aria-haspopup="dialog"
              title={currentSub?.text.trim() ? 'AI 解析当前台词的语法' : '当前没有台词可解析'}
              onClick={() => {
                if (showAnalysis) {
                  closeAnalysis();
                  return;
                }
                const playbackTime = videoRef.current?.currentTime ?? currentTime;
                const activeSubtitle = subtitles[getActiveSubtitleIndex(subtitles, playbackTime)];
                if (!activeSubtitle?.text.trim()) return;
                videoRef.current?.pause();
                if (hasSeparateAudio) audioRef.current?.pause();
                setCurrentTime(playbackTime);
                onTimeUpdate(playbackTime);
                setPlaying(false);
                setShowSubtitleMenu(false);
                setShowSpeedMenu(false);
                setAnalysisTarget({ src, subtitle: activeSubtitle });
              }}
              className={`min-w-[56px] min-h-[44px] flex items-center justify-center rounded-lg transition text-sm disabled:opacity-35 disabled:cursor-not-allowed ${
                showAnalysis ? 'bg-[#2a2a2a] text-white' : 'hover:bg-[#2a2a2a] text-[#a0a0a0]'
              }`}
              style={{ padding: '0 12px' }}
            >
              解析
            </button>
            {showAnalysis && analysisTarget && (
              <GrammarAnalysis
                key={`${src}:${analysisTarget.subtitle.start}:${analysisTarget.subtitle.text}`}
                subtitle={analysisTarget.subtitle}
                anchorRef={analysisButtonRef}
                onClose={closeAnalysis}
              />
            )}
            {/* Subtitle Mode */}
            <div
              ref={subtitleControlRef}
              className="relative shrink-0"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setShowSubtitleMenu(false);
                }
              }}
            >
              <button
                ref={subtitleButtonRef}
                type="button"
                aria-label={`字幕模式：${subtitleLabel}`}
                aria-expanded={showSubtitleMenu}
                aria-controls={showSubtitleMenu ? subtitleMenuId : undefined}
                title="切换字幕模式"
                onClick={() => {
                  closeAnalysis();
                  setShowSubtitleMenu(open => !open);
                  setShowSpeedMenu(false);
                }}
                className={`w-[104px] min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg transition text-sm px-2 ${
                  showSubtitleMenu ? 'bg-[#2a2a2a] text-white' : 'hover:bg-[#2a2a2a] text-[#a0a0a0]'
                }`}
              >
                {subtitleLabel}
                <span aria-hidden="true" className="text-xs">▴</span>
              </button>
              {showSubtitleMenu && (
                <div
                  id={subtitleMenuId}
                  role="group"
                  aria-label="字幕模式"
                  className="absolute bottom-full right-0 mb-2 w-36 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg py-1 z-10"
                >
                  {subtitleOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={subtitleMode === option.value}
                      onClick={() => {
                        onSubtitleModeChange(option.value);
                        setShowSubtitleMenu(false);
                        subtitleButtonRef.current?.focus();
                      }}
                      className={`flex items-center justify-between w-full px-4 py-2 text-sm text-left hover:bg-[#2a2a2a] transition min-h-[44px] ${
                        subtitleMode === option.value ? 'text-[#e74c3c]' : 'text-[#e0e0e0]'
                      }`}
                    >
                      {option.label}
                      {subtitleMode === option.value && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sentence Mode */}
            <button
              onClick={onSentenceModeToggle}
              aria-pressed={sentenceMode}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition text-sm px-3 ${
                sentenceMode ? 'bg-[#e74c3c] text-white' : 'hover:bg-[#2a2a2a] text-[#a0a0a0]'
              }`}
              title="逐句跟读模式"
            >
              📖
            </button>

            {/* AB Loop indicator */}
            {abLoop && (
              <button
                onClick={onAbLoopClear}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-[#e74c3c] text-white transition text-sm px-3"
                title="点击取消AB循环"
              >
                🔄 {formatTime(abLoop.a)}-{formatTime(abLoop.b)}
              </button>
            )}

            {/* Speed */}
            <div className="relative">
              <button
                onClick={() => {
                  closeAnalysis();
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowSubtitleMenu(false);
                }}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-[#2a2a2a] transition text-sm px-3 text-[#a0a0a0]"
              >
                {speed}x
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg py-1 z-10">
                  {SPEED_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => { onSpeedChange(s); setShowSpeedMenu(false); }}
                      className={`block w-full px-4 py-2 text-sm text-left hover:bg-[#2a2a2a] transition min-h-[40px] ${
                        speed === s ? 'text-[#e74c3c]' : 'text-[#e0e0e0]'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              ref={fullscreenButtonRef}
              data-testid="player-fullscreen-toggle"
              type="button"
              aria-label={fullscreen ? '退出全屏' : '全屏'}
              aria-pressed={fullscreen}
              aria-busy={fullscreenPending}
              disabled={fullscreenPending}
              title={fullscreen ? '退出全屏（Esc）' : '全屏'}
              onClick={() => { void toggleFullscreen(); }}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-[#2a2a2a] transition text-[#a0a0a0] disabled:opacity-50"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={fullscreen ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'} />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
