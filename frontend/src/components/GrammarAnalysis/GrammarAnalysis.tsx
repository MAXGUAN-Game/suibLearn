import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { analyzeGrammar, type GrammarAnalysisResult } from '../../services/api';
import type { SubtitleLine } from '../../types';
import { grammarAnalysisCache as cache } from './grammarCache';
import './GrammarAnalysis.css';

interface Props {
  subtitle: SubtitleLine;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

const COLORS = ['#8ec5ff', '#e6b0ff', '#7ee2b8', '#ffc680', '#ff9fb6', '#bfc1ff'];
// Keep a bounded session cache: opening the same sentence again costs no request.
type PopoverStyle = CSSProperties & { '--grammar-arrow-left'?: string; '--grammar-arrow-top'?: string };

function AnnotatedText({ tokens }: { tokens: GrammarAnalysisResult['segments'][number]['reading_tokens'] }) {
  return tokens.map((token, index) => token.reading
    ? <ruby key={index}>{token.text}<rp>（</rp><rt>{token.reading}</rt><rp>）</rp></ruby>
    : <span key={index}>{token.text}</span>);
}

export default function GrammarAnalysis({ subtitle, anchorRef, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [position, setPosition] = useState<PopoverStyle>({ visibility: 'hidden' });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<GrammarAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  const closeAndFocus = useCallback(() => {
    onClose();
    anchorRef.current?.focus();
  }, [onClose, anchorRef]);

  useEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(540, window.innerWidth - 24);
      const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
      const above = anchor.top >= 220;
      setPosition({
        left,
        width,
        ...(above
          ? { bottom: window.innerHeight - anchor.top + 12, maxHeight: Math.min(640, anchor.top - 24) }
          : { top: anchor.bottom + 12, maxHeight: Math.max(120, window.innerHeight - anchor.bottom - 24) }),
        '--grammar-arrow-left': `${Math.max(16, Math.min(width - 24, anchor.left + anchor.width / 2 - left - 6))}px`,
        '--grammar-arrow-top': above ? '100%' : '0',
      });
    };
    updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndFocus();
      }
    };
    const handleFocus = (event: FocusEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocus);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocus);
    };
  }, [anchorRef, onClose, closeAndFocus]);

  // Focus only after the visible position has actually committed to the DOM.
  useEffect(() => {
    if (position.visibility !== 'hidden') closeRef.current?.focus();
  }, [position.visibility]);

  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify(['sentence-grammar-v4', subtitle.text, subtitle.translated_text || '']);
    const cached = cache.get(key);
    const load = async () => {
      try {
        const analysis = cached || await analyzeGrammar(subtitle.text, subtitle.translated_text, controller.signal);
        if (controller.signal.aborted) return;
        if (analysis.sentence !== subtitle.text || !analysis.segments.length || analysis.segments.map(segment => segment.text).join('') !== subtitle.text) {
          throw new Error('解析结果与原句不匹配，请重试');
        }
        if (analysis.segments.some(segment => !segment.structure?.trim() || typeof segment.meaning !== 'string' ||
          !Array.isArray(segment.reading_tokens) || !segment.reading_tokens.length ||
          segment.reading_tokens.some(token => !token.text || typeof token.reading !== 'string') ||
          segment.reading_tokens.map(token => token.text).join('') !== segment.text)) {
          throw new Error('句子结构或读音信息不完整，请重新解析');
        }
        if (!cached) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(key, analysis);
        }
        setResult(analysis);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : '暂时无法解析，请稍后重试');
      }
    };
    void load();
    return () => controller.abort();
  }, [subtitle.text, subtitle.translated_text, attempt]);

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal="false" aria-labelledby={titleId} className="grammar-popover" style={position}>
      <div className="grammar-popover-arrow" aria-hidden="true" />
      <div className="grammar-popover-scroll">
        <div className="grammar-heading">
          <div>
            <div className="grammar-eyebrow">DeepSeek · 语法解析</div>
            <h2 id={titleId}>读懂这句台词</h2>
          </div>
          <button ref={closeRef} type="button" onClick={closeAndFocus} className="grammar-close" aria-label="关闭语法解析">×</button>
        </div>

        {!result && <p className="grammar-original" lang="ja">{subtitle.text}</p>}
        {!result && !error && (
          <div className="grammar-loading" role="status">
            <span className="grammar-spinner" aria-hidden="true" />
            <span>正在分析句子结构与语法…</span>
          </div>
        )}
        {error && (
          <div className="grammar-error" role="alert">
            <p>{error}</p>
            <button type="button" className="grammar-retry" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重新解析</button>
            <button type="button" className="grammar-retry" style={{ marginLeft: 8 }} onClick={() => window.dispatchEvent(new Event('sublearn:open-ai-settings'))}>AI 设置</button>
          </div>
        )}
        {result && (
          <>
            <h3 className="grammar-structure-heading">句子结构</h3>
            <div className="grammar-colored-sentence" lang="ja" aria-label="按语法成分标注的原句">
              {result.segments.map((segment, index) => (
                <button
                  key={index}
                  type="button"
                  className={`grammar-segment${activeSegment === index ? ' is-active' : ''}`}
                  style={{ '--segment-color': COLORS[index % COLORS.length] } as CSSProperties}
                  aria-label={`第${index + 1}部分：${segment.text}，${segment.structure}，${segment.role}`}
                  onMouseEnter={() => setActiveSegment(index)}
                  onMouseLeave={() => setActiveSegment(null)}
                  onFocus={() => setActiveSegment(index)}
                  onBlur={() => setActiveSegment(null)}
                  onClick={() => panelRef.current?.querySelector(`#${CSS.escape(`${titleId}-part-${index}`)}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                >
                  <span className="grammar-segment-text"><AnnotatedText tokens={segment.reading_tokens} /><sup aria-hidden="true">{index + 1}</sup></span>
                  <span className="grammar-structure-label" lang="zh-CN">{segment.structure}</span>
                </button>
              ))}
            </div>
            <p className="grammar-translation">{result.translation || subtitle.translated_text || '暂无中文译文'}</p>
            <div className="grammar-summary"><h3>整句理解</h3><p>{result.summary}</p></div>
            <h3 className="grammar-parts-heading">语法拆解</h3>
            <div className="grammar-parts">
              {result.segments.map((segment, index) => (
                <div
                  key={index}
                  id={`${titleId}-part-${index}`}
                  className={`grammar-part${activeSegment === index ? ' is-active' : ''}`}
                  style={{ '--segment-color': COLORS[index % COLORS.length] } as CSSProperties}
                  onMouseEnter={() => setActiveSegment(index)}
                  onMouseLeave={() => setActiveSegment(null)}
                >
                  <div className="grammar-part-heading"><span className="grammar-part-number">{index + 1}</span><span lang="ja" className="grammar-part-text"><AnnotatedText tokens={segment.reading_tokens} /></span><span className="grammar-role">{segment.role}</span></div>
                  {segment.meaning.trim() && <p className="grammar-meaning"><span>词义：</span>{segment.meaning}</p>}
                  <p>{segment.explanation}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
