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
  confidenceScore: number;
  conversationText: string;
}): string {
  return formatPrompt(prompts.reportGeneration.mainPrompt, {
    schemaInstruction: prompts.reportGeneration.schemaInstruction,
    ...params,
  });
}
