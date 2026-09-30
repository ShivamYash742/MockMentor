import type { ReportOutput } from './reportSchema.ts';

// The rubric's hard rules that can be checked mechanically (lib/prompts.json), applied after
// generation so a model that ignores them can't inflate a score. Only caps and clamps, so a
// report that already follows them comes back unchanged. The point deductions (rules 8 and 9)
// stay with the model: applying them again here would count them twice.
const SCORED = ['communicationSkills', 'technicalKnowledge', 'problemSolving'] as const;

export function enforceRubric(report: ReportOutput, answeredQuestions: number): ReportOutput {
  const out: ReportOutput = structuredClone(report);
  const feedback = out.detailedFeedback;

  let overall = feedback.overallScore;
  // Rule 3: overall within 8 points of the average question score.
  const scores = feedback.specificFeedback.map((f) => f.score);
  if (scores.length > 0) {
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    overall = Math.min(average + 8, Math.max(average - 8, overall));
  }
  // Rules 1 and 2: caps for one or two answered questions.
  if (answeredQuestions <= 1) overall = Math.min(overall, 45);
  else if (answeredQuestions === 2) overall = Math.min(overall, 55);
  feedback.overallScore = Math.round(Math.min(100, Math.max(0, overall)));

  // Rule 10: no listed strengths for a category scored below 40.
  for (const key of SCORED) {
    const section = out.performanceAnalysis[key];
    if (section.score < 40) section.strengths = [];
  }
  return out;
}
