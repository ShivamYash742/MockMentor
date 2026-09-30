import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { saveResumeProfile, summarizeResume } from '@/lib/resumeProfile';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { aiLimits, rateLimit } from '@/lib/rateLimit';

// Pasted-text path only (app/interview/new's "paste your resume" flow). File uploads go
// through /api/upload-resume, which parses PDFs itself.
export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fileContent } = await req.json().catch(() => ({}));

    if (typeof fileContent !== 'string' || !fileContent.trim()) {
      return NextResponse.json(
        { error: 'Resume text is required' },
        { status: 400 }
      );
    }
    if (fileContent.length > INPUT_LIMITS.resumeChars) {
      return NextResponse.json(
        { error: `Resume text is too long (max ${INPUT_LIMITS.resumeChars.toLocaleString('en-US')} characters)` },
        { status: 400 }
      );
    }

    const limited = await rateLimit(aiLimits(req, requester));
    if (limited) return limited;

    const resumeSummary = await summarizeResume(fileContent);
    // Guests have no profile to save to; the summary goes back to the client for this interview.
    const userProfile = requester.userId
      ? (await saveResumeProfile(requester.userId, resumeSummary)).userProfile
      : null;

    return NextResponse.json({
      success: true,
      resumeSummary,
      userProfile,
      extractedTextLength: fileContent.length,
    });
  } catch (error) {
    // Details stay in the server log; they used to be sent to the client.
    console.error('Error processing resume:', error);
    return NextResponse.json(
      { error: 'Failed to process your resume. Please try again.' },
      { status: 500 }
    );
  }
}
