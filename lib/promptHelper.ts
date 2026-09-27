import prompts from './prompts.json';

type PromptVariables = Record<string, string | number | boolean>;

/**
 * Replace variables in a prompt template
 * Example: "Hello {name}" with {name: "John"} => "Hello John"
 */
function formatPrompt(template: string, variables: PromptVariables): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key]?.toString() || match;
  });
}

/**
 * Get resume summary prompt
 */
export function getResumeSummaryPrompt(resumeText: string): string {
  return formatPrompt(prompts.resumeSummary.prompt, { resumeText });
}

/**
 * Get job summary prompt
 */
export function getJobSummaryPrompt(jobTitle: string, jobDescription?: string): string {
  if (jobDescription) {
    return formatPrompt(prompts.jobSummary.withDescription, { jobTitle, jobDescription });
  }
  return formatPrompt(prompts.jobSummary.withoutDescription, { jobTitle });
}

/**
 * Build the interviewer's knowledge base (mentor personality + candidate + job) — built
 * server-side in /api/ai-chat so a client can never substitute its own system prompt.
 */
export function getInterviewKnowledgeBase(
  mentorPersonality: string | undefined,
  userSummary: string,
  jobSummary: string
): string {
  const basePersonality = mentorPersonality || 'You are an AI-powered interviewer conducting a mock interview for a specific job position.';

  return `
  ${basePersonality}

  The candidate is described as follows: ${userSummary}.

  The job role is described as follows: ${jobSummary}.

  Your task is to conduct a professional mock interview for this position. This is a short 3-minute mock interview, so you should ask 2-3 concise but highly relevant questions to assess the candidate. Tailor the questions to the candidate's background and the job's requirements, specifically looking through the lens of your assigned mentor personality. Ensure the questions are clear, concise, and encourage detailed responses. Maintain a conversational and engaging tone throughout the interview matching your persona. Keep track of time and make sure to provide valuable feedback within the 3-minute timeframe.

  IMPORTANT CONVERSATION FLOW:
  - After asking each question, pause and give the candidate time to think and respond
  - You can say phrases like "Please take your time to answer" or "You can go ahead and answer now" or "Feel free to share your thoughts"
  - Wait for the candidate's response before proceeding to the next question
  - Don't rush through questions - allow natural conversation flow with appropriate pauses
  - If there's silence after asking a question, you can gently encourage them with "You can start answering whenever you're ready"
  `;
}

/**
 * Get interview welcome message prompt
 */
export function getInterviewWelcomePrompt(knowledgeBase: string, role: string): string {
  return formatPrompt(prompts.interviewWelcome.prompt, { knowledgeBase, role });
}

/**
 * Get interview conversation prompt
 */
export function getInterviewConversationPrompt(params: {
  knowledgeBase: string;
  role: string;
  candidateBackground: string;
  duration: string;
  conversationHistory: string;
  message: string;
  isUserPaused: boolean;
}): string {
  const responseGuidelines = params.isUserPaused
    ? prompts.interviewConversation.userPausedGuideline
    : prompts.interviewConversation.normalResponseGuideline;

  return formatPrompt(prompts.interviewConversation.systemPrompt, {
    ...params,
    responseGuidelines,
  });
}

/**
 * Get report generation prompt
 */
export function getReportGenerationPrompt(params: {
  jobTitle: string;
  userSummary: string;
  jobSummary: string;
  speakingTime: number;
  wordsPerMinute: number;
  fillerWordsCount: number;
  fluencyScore: number; // filler-word-density-derived fluency proxy — not measured confidence
  conversationText: string;
  bodyLanguageSection: string; // real numbers, or an instruction to omit bodyLanguage entirely
}): string {
  return formatPrompt(prompts.reportGeneration.mainPrompt, {
    schemaInstruction: prompts.reportGeneration.schemaInstruction,
    ...params,
  });
}
