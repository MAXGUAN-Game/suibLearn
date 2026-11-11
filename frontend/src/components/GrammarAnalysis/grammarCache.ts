import type { GrammarAnalysisResult } from '../../services/api';

export const grammarAnalysisCache = new Map<string, GrammarAnalysisResult>();

export function clearGrammarAnalysisCache() {
  grammarAnalysisCache.clear();
}
