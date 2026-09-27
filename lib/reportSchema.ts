import { z } from 'zod';

// Structured-output schema for the AI-generated report. Passed to generateWithGroq via
// Output.object, so the model's response is validated and typed directly — no more
// regex code-fence stripping + JSON.parse (which had no way to enforce shape or ranges).
// questionId is deliberately absent: the route assigns it after generation, not the model.

const scoredSection = z.object({
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  feedback: z.string(),
});

// Omitted entirely by the model when no camera data was available for the session — the UI
// shows "Not assessed" rather than a fabricated score in that case.
const bodyLanguageSection = z.object({
  score: z.number().min(0).max(100),
  observations: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export const reportSchema = z.object({
  performanceAnalysis: z.object({
    communicationSkills: scoredSection,
    technicalKnowledge: scoredSection,
    problemSolving: scoredSection,
    confidence: z.object({
      score: z.number().min(0).max(100),
      analysis: z.string(),
      recommendations: z.array(z.string()),
    }),
    bodyLanguage: bodyLanguageSection.optional(),
  }),
  detailedFeedback: z.object({
    overallScore: z.number().min(0).max(100),
    summary: z.string(),
    keyStrengths: z.array(z.string()),
    areasForImprovement: z.array(z.string()),
    specificFeedback: z.array(
      z.object({
        question: z.string(),
        userResponse: z.string(),
        feedback: z.string(),
        score: z.number().min(0).max(100),
        suggestions: z.array(z.string()),
      })
    ),
    behavioralInsights: z.object({
      pauseAnalysis: z.string(),
      speechPaceAnalysis: z.string(),
      confidenceAnalysis: z.string(),
      emotionalStateAnalysis: z.string(),
    }),
    recommendations: z.object({
      immediate: z.array(z.string()),
      shortTerm: z.array(z.string()),
      longTerm: z.array(z.string()),
    }),
  }),
});

export type ReportOutput = z.infer<typeof reportSchema>;
