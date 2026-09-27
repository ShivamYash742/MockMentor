import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { generateWithGroq } from '@/lib/groq';
import { getJobSummaryPrompt } from '@/lib/promptHelper';

export async function POST(req: NextRequest) {
  try {
    const { jobTitle, jobDescription } = await req.json();

    if (!(await getRequester(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!jobTitle) {
      return NextResponse.json(
        { error: 'Job title is required' },
        { status: 400 }
      );
    }

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
