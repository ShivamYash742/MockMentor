import { appConfig } from './appConfig';

// Extra time allowed past the interview's limit before it's treated as abandoned — covers
// the client's own "end" call (or last ai-chat message) arriving late on a slow connection.
export const GRACE_MS = 2 * 60 * 1000;

export function interviewEndTime(startDateTime: Date): Date {
  return new Date(startDateTime.getTime() + appConfig.interviewDurationSec * 1000);
}

export function isInterviewLive(startDateTime: Date | undefined, graceMs = 0): boolean {
  if (!startDateTime) return false;
  return Date.now() <= interviewEndTime(startDateTime).getTime() + graceMs;
}
