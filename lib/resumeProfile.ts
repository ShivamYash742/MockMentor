import { generateWithGroq } from './groq';
import { truncateForAI } from './pdf';
import dbConnect from './mongodb';
import UserProfile from './models/User';
import { getResumeSummaryPrompt } from './promptHelper';
import type { Requester } from './requester';

// Shared by upload-resume (file) and process-resume (pasted text): summarize the resume
// text with Groq, and save it to the signed-in user's profile (guests have no profile to save to).
// fileUrl is only set for an uploaded file; pasted text keeps whatever file the profile had
// (it used to overwrite it with the string "text-input").
export async function summarizeAndSaveResume(rawText: string, fileUrl: string | null, requester: Requester) {
  const prompt = getResumeSummaryPrompt(truncateForAI(rawText));
  const { text: resumeSummary } = await generateWithGroq(prompt);

  await dbConnect();
  let userProfile = null;
  if (requester.userId) {
    userProfile = await UserProfile.findOneAndUpdate(
      { userId: requester.userId },
      { resumeSummary, ...(fileUrl ? { resumeUrl: fileUrl } : {}) },
      { upsert: true, new: true }
    );
  }

  return { resumeSummary, userProfile };
}
