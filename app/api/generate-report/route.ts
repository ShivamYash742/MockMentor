import { NextRequest, NextResponse } from 'next/server';
import { Output } from 'ai';
import { generateWithGroq } from '@/lib/groq';
import dbConnect from '@/lib/mongodb';
import InterviewSession, { IInterviewMetrics } from '@/lib/models/InterviewSession';
import InterviewReport from '@/lib/models/InterviewReport';
import Interview from '@/lib/models/Interview';
import { mentors } from '@/lib/mentors';
import { getReportGenerationPrompt } from '@/lib/promptHelper';
import { findOwned, getRequester } from '@/lib/requester';
import { sanitizeFaceAnalytics, type SanitizedFaceAnalytics } from '@/lib/faceAnalytics';
import { reportSchema, type ReportOutput } from '@/lib/reportSchema';

// Real numbers when the session has camera data; otherwise an explicit instruction not to
// guess. Feeds into the report prompt as {bodyLanguageSection} — see lib/prompts.json.
function buildBodyLanguageSection(faceAnalytics: SanitizedFaceAnalytics | null): string {
  const omitInstruction = 'No camera data was captured for this session. Do NOT invent a "bodyLanguage" assessment — omit the "bodyLanguage" key from performanceAnalysis entirely.';
  if (!faceAnalytics) return omitInstruction;

  const lines: string[] = [];
  if (typeof faceAnalytics.stress_avg === 'number') lines.push(`- Stress level (0-1, higher = more stressed): ${faceAnalytics.stress_avg}`);
  if (typeof faceAnalytics.engagement_avg === 'number') lines.push(`- Engagement (0-1): ${faceAnalytics.engagement_avg}`);
  if (typeof faceAnalytics.attention_on_screen_frac === 'number') lines.push(`- Time looking at the screen (fraction): ${faceAnalytics.attention_on_screen_frac}`);
  if (typeof faceAnalytics.blinks_per_min_avg === 'number') lines.push(`- Blink rate (per minute; ~15-20 is typical): ${faceAnalytics.blinks_per_min_avg}`);

  if (lines.length === 0) return omitInstruction;

  return `Camera-derived body-language metrics for this session:\n${lines.join('\n')}\nBase the "bodyLanguage" score and observations on these real numbers only — do not invent visual details beyond what they support.`;
}

async function generateUnifiedReport(
  messages: Array<{ sender: string; text: string }>,
  metrics: IInterviewMetrics,
  jobTitle: string,
  userSummary: string,
  jobSummary: string,
  faceAnalytics: SanitizedFaceAnalytics | null
): Promise<ReportOutput> {
  const conversationText = messages
    .filter(msg => msg.sender !== 'system')
    .map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`)
    .join('\n\n');

  const prompt = getReportGenerationPrompt({
    jobTitle,
    userSummary,
    jobSummary,
    speakingTime: Math.round(Number(metrics.userSpeakingTime ?? 0) / 1000),
    wordsPerMinute: Number(metrics.wordsPerMinute ?? 0),
    fillerWordsCount: Number(metrics.fillerWordsCount ?? 0),
    fluencyScore: Math.round(Number(metrics.confidenceScore ?? 0) * 100),
    conversationText,
    bodyLanguageSection: buildBodyLanguageSection(faceAnalytics),
  });

  // Structured output via zod validates shape and score ranges directly — no more
  // ```json fence stripping + JSON.parse with no guarantee the result matched anything.
  const result = await generateWithGroq(prompt, {
    temperature: 0.3,
    output: Output.object({ schema: reportSchema }),
  });

  return result.output as ReportOutput;
}

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { interviewId, faceAnalytics: rawFaceAnalytics } = await req.json().catch(() => ({}));
    const faceAnalytics = sanitizeFaceAnalytics(rawFaceAnalytics);

    if (!interviewId) {
      return NextResponse.json(
        { error: 'Interview ID is required' },
        { status: 400 }
      );
    }

    await dbConnect();

    const interview = await findOwned(Interview, interviewId, requester);

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      );
    }

    const existingReport = await InterviewReport.findOne({ interviewId: String(interview._id) });
    if (existingReport) {
      return NextResponse.json({
        success: true,
        report: existingReport,
        message: 'Report already exists'
      });
    }

    // The session is taken from the interview, never from the client.
    const session = interview.sessionId
      ? await InterviewSession.findById(interview.sessionId)
      : null;

    if (!session) {
      return NextResponse.json(
        { error: 'No session found for this interview' },
        { status: 404 }
      );
    }

    const mentor = mentors.find(m => m.id === interview.mentorId);
    const mentorName = mentor ? mentor.name : 'AI Interviewer';

    // 1. Generate the report. On failure, report it honestly and save nothing — never a
    // fabricated report standing in for a real assessment.
    let aiAnalysis: ReportOutput;
    try {
      aiAnalysis = await generateUnifiedReport(
        session.messages,
        session.metrics as IInterviewMetrics,
        interview.jobTitle,
        interview.userSummary,
        interview.jobSummary,
        faceAnalytics
      );
    } catch (aiError) {
      console.error('Report generation failed (AI unavailable):', aiError);
      return NextResponse.json(
        { error: 'Report generation is temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }

    // 2. Map QA specificFeedback to include unique IDs (assigned here, not by the model)
    let qIdCounter = 1;
    const specificFeedback = aiAnalysis.detailedFeedback.specificFeedback.map((fb) => ({
      ...fb,
      questionId: `q${qIdCounter++}`
    }));

    // 3. Save to database
    const report = new InterviewReport({
      interviewId: String(interview._id),
      sessionId: String(session._id),
      userId: interview.userId,
      guestId: interview.guestId,
      jobTitle: interview.jobTitle,
      mentorName,
      performanceAnalysis: aiAnalysis.performanceAnalysis,
      detailedFeedback: { ...aiAnalysis.detailedFeedback, specificFeedback },
      ...(faceAnalytics ? { faceAnalytics } : {}),
      interviewDuration: session.metrics.totalDuration || 0,
      generatedAt: new Date(),
      reportVersion: '4.0',
    });

    await report.save();

    await Promise.all([
      Interview.findByIdAndUpdate(interview._id, {
        reportId: report._id,
        status: 'completed'
      }),
      InterviewSession.findByIdAndUpdate(session._id, {
        status: 'completed'
      })
    ]);

    return NextResponse.json({ success: true, report });
  } catch (error) {
    console.error('Error generating report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
