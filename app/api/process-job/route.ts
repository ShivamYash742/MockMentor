import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { generateWithGroq } from '@/lib/groq';
import { getJobSummaryPrompt } from '@/lib/promptHelper';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { aiLimits, rateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobTitle, jobDescription } = await req.json().catch(() => ({}));

    if (typeof jobTitle !== 'string' || !jobTitle.trim()) {
      return NextResponse.json(
        { error: 'Job title is required' },
        { status: 400 }
      );
    }
    // Both go straight into a prompt, so their size is bounded.
    if (jobTitle.length > INPUT_LIMITS.jobTitleChars) {
      return NextResponse.json({ error: `Job title is too long (max ${INPUT_LIMITS.jobTitleChars} characters)` }, { status: 400 });
    }
    if (jobDescription !== undefined && typeof jobDescription !== 'string') {
      return NextResponse.json({ error: 'Job description must be text' }, { status: 400 });
    }
    if (jobDescription && jobDescription.length > INPUT_LIMITS.jobDescriptionChars) {
      return NextResponse.json({ error: `Job description is too long (max ${INPUT_LIMITS.jobDescriptionChars.toLocaleString('en-US')} characters)` }, { status: 400 });
    }

    const limited = await rateLimit(aiLimits(req, requester));
    if (limited) return limited;

    // Generate job summary using Groq (with automatic model fallback)
    const prompt = getJobSummaryPrompt(jobTitle, jobDescription);
    const { text: jobSummary } = await generateWithGroq(prompt);

    return NextResponse.json({
      success: true,
      jobSummary,
    });
  } catch (error) {
    console.error('Error processing job:', error);
    return NextResponse.json(
      { error: 'Failed to process job details' },
      { status: 500 }
    );
  }
}
