// Real speech metrics computed from actual per-answer timing, replacing the placeholders that
// used to live in components/interview.tsx (a fixed 50/50 speaking-time split, a filler-word
// counter that could never match a multi-word phrase, and a hardcoded emotionalTone).

export interface SpeechMessage {
  content: string;
  durationMs?: number;
  pauseBefore?: number;
}

export interface SpeechMetrics {
  userSpeakingTime: number;
  interviewerSpeakingTime: number;
  totalPauses: number;
  averagePauseLength: number;
  longestPause: number;
  averageResponseTime: number;
  wordsPerMinute: number;
  fillerWordsCount: number;
  confidenceScore: number;
}

// Matched as whole-word/whole-phrase boundaries, not as single tokens — the old
// `words.split(/\s+/)` approach could never match "you know" since no single word equals it.
const FILLER_PATTERNS = ['um', 'uh', 'you know', 'actually', 'basically', 'literally'].map(
  (phrase) => new RegExp(`\\b${phrase}\\b`, 'g')
);
// "like" is only a filler when it isn't doing its normal job: "I like Python", "would like to",
// "looks like", "felt like" and so on are real words, not hesitation.
const FILLER_LIKE = /(?<!\b(?:i|you|we|they|he|she|would|'d|do|don't|didn't|really|also|looks?|looked|feels?|felt|seems?|seemed|sounds?|something|anything|nothing|much|more|not)\s)\blike\b/g;

export function countFillerWords(text: string): number {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  return [...FILLER_PATTERNS, FILLER_LIKE].reduce(
    (count, re) => count + (normalized.match(re)?.length ?? 0),
    0
  );
}

export function computeSpeechMetrics(userMessages: SpeechMessage[], totalDurationMs: number): SpeechMetrics {
  // Pace, fillers and fluency describe speech, so only spoken answers (the ones with a measured
  // duration) count. Typed answers used to add their words to WPM with no time to divide by.
  const spoken = userMessages.filter((m) => typeof m.durationMs === 'number' && m.durationMs > 0);
  const spokenText = spoken.map((m) => m.content).join(' ').trim();
  const wordsSpoken = spokenText ? spokenText.split(/\s+/).length : 0;
  const fillerWordsCount = countFillerWords(spokenText);

  const userSpeakingTime = spoken.reduce((sum, m) => sum + (m.durationMs as number), 0);

  const pauses = userMessages
    .map((m) => m.pauseBefore)
    .filter((p): p is number => typeof p === 'number' && p >= 0);
  const totalPauses = pauses.length;
  const averagePauseLength = totalPauses > 0 ? pauses.reduce((sum, p) => sum + p, 0) / totalPauses : 0;
  const longestPause = totalPauses > 0 ? Math.max(...pauses) : 0;

  const wordsPerMinute = userSpeakingTime > 0 ? Math.round(wordsSpoken / (userSpeakingTime / 60000)) : 0;

  return {
    userSpeakingTime,
    interviewerSpeakingTime: Math.max(0, totalDurationMs - userSpeakingTime),
    totalPauses,
    averagePauseLength,
    longestPause,
    averageResponseTime: averagePauseLength,
    wordsPerMinute,
    fillerWordsCount,
    // A real (if crude) fluency proxy from filler-word density — not a fabricated constant.
    // Labeled "fluency" (not "confidence") wherever it's shown, since that's what it measures.
    confidenceScore: Math.max(0.3, 1 - fillerWordsCount / Math.max(1, wordsSpoken)),
  };
}
