// Input limits, shared by the setup page (so it can warn before sending) and the API routes that
// enforce them. They also bound how much text can reach an AI prompt.
export const INPUT_LIMITS = {
  resumeBytes: 5 * 1024 * 1024,
  resumeChars: 20_000,
  jobTitleChars: 200,
  jobDescriptionChars: 10_000,
  // AI summaries the client echoes back to create-interview; anything longer is cut.
  summaryChars: 4_000,
  answerChars: 2_000,
} as const;
