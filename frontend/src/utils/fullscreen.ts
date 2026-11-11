import { useEffect, useState } from 'react';

export type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
export type FullscreenContainer = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export const PLAYER_FULLSCREEN_EVENT = 'sublearn:player-fullscreen-change';

export function getFullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null;
}

export async function exitNativeFullscreen(): Promise<void> {
  if (document.exitFullscreen) await document.exitFullscreen();
  else if ((document as FullscreenDocument).webkitExitFullscreen) await (document as FullscreenDocument).webkitExitFullscreen!();
  else throw new Error('Fullscreen exit is unavailable');
}

function portalRoot(): Element {
  return getFullscreenElement() ?? document.querySelector('[data-player-fullscreen="true"]') ?? document.body;
}

/** Keep dialogs inside the fullscreen top layer, including the viewport fallback. */
export function useFullscreenPortal(): Element {
  const [root, setRoot] = useState(portalRoot);
  useEffect(() => {
    const update = () => setRoot(portalRoot());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    window.addEventListener(PLAYER_FULLSCREEN_EVENT, update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      window.removeEventListener(PLAYER_FULLSCREEN_EVENT, update);
    };
  }, []);
  return root;
}
