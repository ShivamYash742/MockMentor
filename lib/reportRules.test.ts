import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enforceRubric } from './reportRules.ts';
import type { ReportOutput } from './reportSchema.ts';

function report(overallScore: number, questionScores: number[], sectionScore = 60): ReportOutput {
  const section = { score: sectionScore, strengths: ['Clear'], improvements: ['More depth'], feedback: 'ok' };
  return {
    performanceAnalysis: {
      communicationSkills: { ...section },
      technicalKnowledge: { ...section },
      problemSolving: { ...section },
      confidence: { score: 60, analysis: 'ok', recommendations: [] },
    },
    detailedFeedback: {
      overallScore,
      summary: 's',
      keyStrengths: [],
      areasForImprovement: [],
      specificFeedback: questionScores.map((score) => ({ question: 'q', userResponse: 'a', feedback: 'f', score, suggestions: [] })),
      behavioralInsights: { pauseAnalysis: '', speechPaceAnalysis: '', confidenceAnalysis: '', emotionalStateAnalysis: '' },
      recommendations: { immediate: [], shortTerm: [], longTerm: [] },
    },
  };
}

test('overall score is pulled to within 8 points of the question average', () => {
  assert.equal(enforceRubric(report(97, [50, 10]), 5).detailedFeedback.overallScore, 38); // avg 30 → max 38
  assert.equal(enforceRubric(report(5, [80, 70]), 5).detailedFeedback.overallScore, 67); // avg 75 → min 67
});

test('one or two answered questions cap the overall score', () => {
  assert.equal(enforceRubric(report(90, [90, 90]), 1).detailedFeedback.overallScore, 45);
  assert.equal(enforceRubric(report(90, [90, 90]), 2).detailedFeedback.overallScore, 55);
  assert.equal(enforceRubric(report(90, [90, 90]), 3).detailedFeedback.overallScore, 90);
});

test('a report that already follows the rules is unchanged', () => {
  const input = report(62, [60, 64]);
  assert.deepEqual(enforceRubric(input, 4), input);
});

test('categories below 40 lose their strengths; the input is not mutated', () => {
  const input = report(30, [30], 35);
  const out = enforceRubric(input, 3);
  assert.deepEqual(out.performanceAnalysis.communicationSkills.strengths, []);
  assert.deepEqual(input.performanceAnalysis.communicationSkills.strengths, ['Clear']);
});
