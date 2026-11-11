import { useRef, useEffect, useCallback, useState, useMemo, useId } from 'react';
import type { SubtitleLine } from '../../types';

interface Props {
  src: string;
  audioSrc?: string;  // Separate audio stream for DASH (Bilibili)
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
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
const SUBTITLE_OPTIONS = [
  { value: 'ja', label: '日语' },
  { value: 'ja-zh', label: '日中字幕' },
  { value: 'off', label: '无字幕' },
] as const;
type SubtitleMode = typeof SUBTITLE_OPTIONS[number]['value'];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({
  src, audioSrc, subtitles, onTimeUpdate, seekTo, onSeeked,
  abLoop, sentenceMode, speed, onSpeedChange, onSentenceModeToggle, onAbLoopClear,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('ja-zh');
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const subtitleControlRef = useRef<HTMLDivElement>(null);
  const subtitleButtonRef = useRef<HTMLButtonElement>(null);
  const subtitleMenuId = useId();
  const lastSentenceIdx = useRef(-1);
  const syncingRef = useRef(false);  // Prevent sync loops

  const hasSeparateAudio = Boolean(audioSrc);
  const subtitleLabel = SUBTITLE_OPTIONS.find(option => option.value === subtitleMode)!.label;

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
    return subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
  }, [subtitles, currentTime]);

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
  const tick = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused) {
      const t = video.currentTime;
      setCurrentTime(t);
      onTimeUpdate(t);

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
        const idx = subtitles.findIndex(s => t >= s.start && t <= s.end);
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
    rafRef.current = requestAnimationFrame(tick);
  }, [onTimeUpdate, abLoop, sentenceMode, subtitles, syncAudio, hasSeparateAudio]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Handle seek from external
  useEffect(() => {
    if (seekTo !== null && videoRef.current) {
      videoRef.current.currentTime = seekTo;
      if (audioRef.current && hasSeparateAudio) {
        audioRef.current.currentTime = seekTo;
      }
      onSeeked();
    }
  }, [seekTo, onSeeked, hasSeparateAudio]);

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
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = ratio * duration;
    video.currentTime = newTime;
    if (audioRef.current && hasSeparateAudio) {
      audioRef.current.currentTime = newTime;
    }
  };

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Letterbox Cinema Layout: video + subtitle bar below */}
      <div className="relative flex-1 flex flex-col min-h-0">
        {/* Video Area (with black bars on sides/top) */}
        <div className="flex-1 flex items-center justify-center bg-black min-h-0" onClick={togglePlay}>
          <video
            ref={videoRef}
            src={src}
            className="max-w-full max-h-full"
            onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration)}
            onPlay={() => {
              setPlaying(true);
              if (audioRef.current && hasSeparateAudio) {
                audioRef.current.currentTime = videoRef.current!.currentTime;
                audioRef.current.play();
              }
            }}
            onPause={() => {
              setPlaying(false);
              if (audioRef.current && hasSeparateAudio) {
                audioRef.current.pause();
              }
            }}
            onSeeked={() => {
              if (audioRef.current && hasSeparateAudio && videoRef.current) {
                audioRef.current.currentTime = videoRef.current.currentTime;
              }
            }}
            playsInline
          />

          {/* Hidden audio element for DASH separate audio */}
          {hasSeparateAudio && (
            <audio ref={audioRef} src={audioSrc} preload="auto" />
          )}
        </div>

        {/* Subtitle Bar - fixed height black band below video (like cinema letterbox) */}
        <div className="bg-black flex items-center justify-center px-6 h-[88px] shrink-0 overflow-y-auto">
          {subtitleMode !== 'off' && currentSub ? (
            <div className="text-center max-w-[90%]">
              <p className="text-white text-base font-medium leading-snug">
                {currentSub.text}
              </p>
              {subtitleMode === 'ja-zh' && currentSub.translated_text && (
                <p className="text-[#b0b0b0] text-sm leading-snug mt-0.5">
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
      <div className="bg-[#141414] px-4 py-2 border-t border-[#2a2a2a]">
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
        <div className="flex items-center justify-between">
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
                  {SUBTITLE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={subtitleMode === option.value}
                      onClick={() => {
                        setSubtitleMode(option.value);
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
          </div>
        </div>
      </div>
    </div>
  );
}
