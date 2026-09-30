import { generateWithGroq } from './groq';
import { truncateForAI } from './pdf';
import dbConnect from './mongodb';
import UserProfile from './models/User';
import { getResumeSummaryPrompt } from './promptHelper';

export async function summarizeResume(rawText: string): Promise<string> {
  const { text } = await generateWithGroq(getResumeSummaryPrompt(truncateForAI(rawText)));
  return text;
}

// Pulls the Appwrite file id out of a stored view URL, for profiles saved before resumeFileId.
function fileIdFromUrl(url?: string | null): string | null {
  return url?.match(/\/files\/([^/]+)\/view/)?.[1] ?? null;
}

// Saves a signed-in user's resume summary, plus the uploaded file when there is one. Pasted text
// keeps whatever file the profile had (it used to overwrite it with the string "text-input").
// Returns the file this replaced, so the caller can delete it: only the latest resume is kept.
export async function saveResumeProfile(
  userId: string,
  resumeSummary: string,
  file?: { url: string; fileId: string }
) {
  await dbConnect();
  const previous = file
    ? await UserProfile.findOne({ userId }).select('resumeUrl resumeFileId').lean()
    : null;
  const userProfile = await UserProfile.findOneAndUpdate(
    { userId },
    { resumeSummary, ...(file ? { resumeUrl: file.url, resumeFileId: file.fileId } : {}) },
    { upsert: true, new: true }
  );
  const previousFileId = previous ? previous.resumeFileId ?? fileIdFromUrl(previous.resumeUrl) : null;
  return { userProfile, replacedFileId: previousFileId && previousFileId !== file?.fileId ? previousFileId : null };
}
