import type { SubtitleLine } from '../types';

/**
 * Select a visible subtitle in [start, end), preferring dialogue over notes.
 * For overlapping entries of the same kind, the latest start wins. Equal
 * starts keep the first entry so selection is deterministic for duplicate cues.
 */
export function getActiveSubtitleIndex(subtitles: readonly SubtitleLine[], time: number): number {
  let selectedIndex = -1;
  let selectedHasOriginal = false;

  for (let index = 0; index < subtitles.length; index++) {
    const subtitle = subtitles[index];
    if (!(subtitle.start <= time && time < subtitle.end)) continue;

    const hasOriginal = subtitle.text.trim().length > 0;
    if (!hasOriginal && !subtitle.translated_text?.trim()) continue;

    if (
      selectedIndex === -1 ||
      (hasOriginal && !selectedHasOriginal) ||
      (hasOriginal === selectedHasOriginal && subtitle.start > subtitles[selectedIndex].start)
    ) {
      selectedIndex = index;
      selectedHasOriginal = hasOriginal;
    }
  }

  return selectedIndex;
}
