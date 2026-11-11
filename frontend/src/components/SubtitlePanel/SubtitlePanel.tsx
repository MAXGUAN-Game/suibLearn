import { useRef, useEffect, useMemo } from 'react';
import type { SubtitleLine, RomajiSegment } from '../../types';
import { getActiveSubtitleIndex } from '../../utils/subtitleSelection';

interface Props {
  subtitles: SubtitleLine[];
  currentTime: number;
  onSeek: (time: number) => void;
  onSetAbLoop: (a: number, b: number) => void;
  onCollapse: () => void;
  panelId: string;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Render romaji segments above original text */
function RomajiDisplay({ segments }: { segments: RomajiSegment[] }) {
  if (!segments || segments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-1 items-end mb-0.5">
      {segments.map((seg, i) => (
        <span key={i} className="inline-flex flex-col items-center">
          {seg.roma && seg.type !== 'symbol' && seg.type !== 'ascii' ? (
            <span className="text-[10px] text-[#888] leading-tight">{seg.roma}</span>
          ) : (
            <span className="text-[10px] leading-tight opacity-0">.</span>
          )}
          <span className="text-sm leading-tight">{seg.orig}</span>
        </span>
      ))}
    </div>
  );
}

export default function SubtitlePanel({ subtitles, currentTime, onSeek, onSetAbLoop, onCollapse, panelId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Find current subtitle index
  const currentIdx = useMemo(() => {
    return getActiveSubtitleIndex(subtitles, currentTime);
  }, [subtitles, currentTime]);

  // Auto-scroll to current subtitle
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      const active = activeRef.current;
      const container = containerRef.current;
      container.scrollTo({
        top: Math.max(0, active.getBoundingClientRect().top - container.getBoundingClientRect().top +
          container.scrollTop - (container.clientHeight - active.clientHeight) / 2),
        behavior: 'smooth',
      });
    }
  }, [currentIdx]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Panel Header */}
      <div className="shrink-0 px-4 py-2 border-b border-[#2a2a2a] flex items-center justify-between">
        <span className="text-sm text-[#a0a0a0]">
          字幕 ({subtitles.length} 句)
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="收拢字幕列表"
          aria-expanded="true"
          aria-controls={panelId}
          title="收拢字幕列表"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1 rounded-lg text-sm text-[#a0a0a0] hover:bg-[#2a2a2a] hover:text-white transition px-2"
        >
          <span>收拢</span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 6 6 6-6 6M20 5v14" /></svg>
        </button>
      </div>

      {/* Subtitle List */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto">
        {subtitles.map((sub, idx) => {
          const isActive = idx === currentIdx;
          return (
            <div
              key={idx}
              ref={isActive ? activeRef : null}
              className={`px-4 py-3 border-b border-[#1a1a1a] cursor-pointer transition-colors ${
                isActive
                  ? 'bg-[rgba(231,76,60,0.15)] border-l-2 border-l-[#e74c3c]'
                  : 'hover:bg-[#1a1a1a] border-l-2 border-l-transparent'
              }`}
              onClick={() => onSeek(sub.start)}
            >
              <div className="flex items-start gap-3">
                {/* Timestamp */}
                <span className="text-xs text-[#666] font-mono mt-1 shrink-0 min-w-[40px]">
                  {formatTimestamp(sub.start)}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Romaji (top) */}
                  {sub.romaji_segments && sub.romaji_segments.length > 0 && (
                    <RomajiDisplay segments={sub.romaji_segments} />
                  )}

                  {/* Original text (middle) */}
                  {(!sub.romaji_segments || sub.romaji_segments.length === 0) && (
                    <p className={`text-sm leading-relaxed ${isActive ? 'text-white' : 'text-[#e0e0e0]'}`}>
                      {sub.text}
                    </p>
                  )}

                  {/* Translation (bottom) */}
                  {sub.translated_text && (
                    <p className="text-xs text-[#888] mt-1 leading-relaxed">
                      {sub.translated_text}
                    </p>
                  )}
                </div>

                {/* AB Loop button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetAbLoop(sub.start, sub.end);
                  }}
                  className="text-xs text-[#666] hover:text-[#e74c3c] transition shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="循环播放此句"
                >
                  🔄
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
