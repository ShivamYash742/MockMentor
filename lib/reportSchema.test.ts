import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportSchema } from './reportSchema.ts';

function sampleScoredSection() {
  return { score: 72, strengths: ['Clear structure'], improvements: ['Add metrics'], feedback: 'Solid answer overall.' };
}

function sampleReport(withBodyLanguage: boolean) {
  return {
    performanceAnalysis: {
      communicationSkills: sampleScoredSection(),
      technicalKnowledge: sampleScoredSection(),
      problemSolving: sampleScoredSection(),
      confidence: { score: 65, analysis: 'Reasonably composed.', recommendations: ['Slow down slightly'] },
      ...(withBodyLanguage
        ? { bodyLanguage: { score: 60, observations: ['Maintained eye contact'], recommendations: ['Sit up straighter'] } }
        : {}),
    },
    detailedFeedback: {
      overallScore: 68,
      summary: 'A solid but unremarkable interview.',
      keyStrengths: ['Clear communication'],
      areasForImprovement: ['More quantified results', 'Deeper technical detail', 'Stronger STAR structure'],
      specificFeedback: [
        {
          question: 'Tell me about a challenging project.',
          userResponse: 'I worked on a migration project...',
          feedback: 'Good structure, missing a quantified outcome.',
          score: 70,
          suggestions: ['Add a specific metric'],
        },
      ],
      behavioralInsights: {
        pauseAnalysis: 'Normal response latency.',
        speechPaceAnalysis: '145 WPM, within range.',
        confidenceAnalysis: 'Steady throughout.',
        emotionalStateAnalysis: 'Calm.',
      },
      recommendations: { immediate: ['Practice STAR'], shortTerm: ['Mock interviews weekly'], longTerm: ['Build a story bank'] },
    },
  };
}

test('reportSchema accepts a full report with bodyLanguage present', () => {
  const parsed = reportSchema.parse(sampleReport(true));
  assert.equal(parsed.performanceAnalysis.bodyLanguage?.score, 60);
});

test('reportSchema accepts a report with bodyLanguage omitted (no camera data)', () => {
  const parsed = reportSchema.parse(sampleReport(false));
  assert.equal(parsed.performanceAnalysis.bodyLanguage, undefined);
});

test('reportSchema rejects an out-of-range score', () => {
  const bad = sampleReport(false);
  bad.detailedFeedback.overallScore = 150;
  assert.throws(() => reportSchema.parse(bad));
});

test('reportSchema rejects a missing required field', () => {
  const bad = sampleReport(false) as Record<string, unknown>;
  delete (bad.detailedFeedback as Record<string, unknown>).summary;
  assert.throws(() => reportSchema.parse(bad));
});
