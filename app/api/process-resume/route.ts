import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { summarizeAndSaveResume } from '@/lib/resumeProfile';

const MAX_TEXT_CHARS = 20_000;

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
    if (fileContent.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `Resume text is too long (max ${MAX_TEXT_CHARS} characters)` },
        { status: 400 }
      );
    }

    const { resumeSummary, userProfile } = await summarizeAndSaveResume(fileContent, null, requester);

    return NextResponse.json({
      success: true,
      resumeSummary,
      userProfile,
      extractedTextLength: fileContent.length,
    });
  } catch (error) {
    console.error('Error processing resume:', error);
    return NextResponse.json(
      {
        error: 'Failed to process resume',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
