import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { exitNativeFullscreen, getFullscreenElement, PLAYER_FULLSCREEN_EVENT } from '../../utils/fullscreen';
import type { FullscreenContainer } from '../../utils/fullscreen';

export function usePlayerFullscreen(
  containerRef: RefObject<HTMLDivElement | null>,
  buttonRef: RefObject<HTMLButtonElement | null>,
) {
  const [native, setNative] = useState(false);
  const [viewport, setViewport] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const activeRef = useRef(false);
  const fullscreen = native || viewport;

  const leave = useCallback(async () => {
    if (getFullscreenElement() === containerRef.current) {
      try {
        await exitNativeFullscreen();
        setMessage('');
      } catch {
        setMessage('暂时无法退出全屏，请按 Esc 退出。');
      }
    } else {
      setViewport(false);
      setMessage('');
      buttonRef.current?.focus();
    }
  }, [containerRef, buttonRef]);

  const toggle = async () => {
    const container = containerRef.current as FullscreenContainer | null;
    if (!container || pending) return;
    if (fullscreen) {
      await leave();
      return;
    }
    const request = container.requestFullscreen ?? container.webkitRequestFullscreen;
    if (!request) {
      setViewport(true);
      setMessage('此浏览器不支持网页全屏，已铺满窗口。');
      return;
    }
    setPending(true);
    setMessage('');
    try {
      await request.call(container);
      setNative(getFullscreenElement() === container);
    } catch {
      if (getFullscreenElement() === container) setNative(true);
      else {
        setViewport(true);
        setMessage('浏览器未允许全屏，已铺满窗口。');
      }
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    const changed = () => {
      const active = getFullscreenElement() === container;
      setNative(active);
      if (active) setViewport(false);
      if (activeRef.current && !active) buttonRef.current?.focus();
      activeRef.current = active;
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
      if (container && getFullscreenElement() === container) void exitNativeFullscreen().catch(() => {});
    };
  }, [containerRef, buttonRef]);

  useEffect(() => {
    // React has committed the viewport marker before portal consumers select it.
    window.dispatchEvent(new Event(PLAYER_FULLSCREEN_EVENT));
  }, [fullscreen, viewport]);

  useEffect(() => {
    if (!viewport) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = previousOverflow; };
  }, [viewport]);

  useEffect(() => {
    if (!fullscreen) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void leave();
        return;
      }
      if (event.key !== 'Tab' || !viewport) return;
      const container = containerRef.current;
      // Dialogs maintain their own focus loop.
      if (!container || container.querySelector('[aria-modal="true"]')) return;
      const elements = Array.from(container.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
      )).filter(element => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!container.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
    };
    document.addEventListener('keydown', keyDown);
    return () => document.removeEventListener('keydown', keyDown);
  }, [fullscreen, viewport, leave, containerRef]);

  return { fullscreen, viewport, pending, message, toggle };
}
