import { NextRequest, NextResponse } from 'next/server';
import { Output } from 'ai';
import { generateWithGroq } from '@/lib/groq';
import dbConnect from '@/lib/mongodb';
import InterviewSession from '@/lib/models/InterviewSession';
import InterviewReport from '@/lib/models/InterviewReport';
import Interview from '@/lib/models/Interview';
import { getMentorById } from '@/lib/mentors';
import { getReportGenerationPrompt } from '@/lib/promptHelper';
import { findOwned, getRequester } from '@/lib/requester';
import { sanitizeFaceAnalytics, type SanitizedFaceAnalytics } from '@/lib/faceAnalytics';
import { reportSchema, type ReportOutput } from '@/lib/reportSchema';
import { enforceRubric } from '@/lib/reportRules';
import { closeSession, computeSessionMetrics, type SessionMetrics } from '@/lib/sessionLifecycle';
import { aiLimits, rateLimit } from '@/lib/rateLimit';
import type { IMessage } from '@/lib/models/InterviewSession';

// A full structured report is a lot of output; the 8s default meant for chat replies is too short.
const REPORT_TIMEOUT_MS = 60_000;
// Bounds the prompt (and its cost) whatever the transcript looks like.
const MAX_TRANSCRIPT_CHARS = 40_000;

// Real numbers when the session has camera data; otherwise an explicit instruction not to
// guess. Feeds into the report prompt as {bodyLanguageSection} — see lib/prompts.json.
function buildBodyLanguageSection(faceAnalytics: SanitizedFaceAnalytics | null): string {
  const omitInstruction = 'No camera data was captured for this session. Do NOT invent a "bodyLanguage" assessment — omit the "bodyLanguage" key from performanceAnalysis entirely.';
  if (!faceAnalytics) return omitInstruction;

  const lines: string[] = [];
  // The tracker's stress score is 0–10 (lib/faceAnalysis.ts computeMetaSignals).
  if (typeof faceAnalytics.stress_avg === 'number') lines.push(`- Stress level (0-10, higher = more stressed): ${faceAnalytics.stress_avg}`);
  if (typeof faceAnalytics.engagement_avg === 'number') lines.push(`- Engagement (0-1): ${faceAnalytics.engagement_avg}`);
  if (typeof faceAnalytics.attention_on_screen_frac === 'number') lines.push(`- Time looking at the screen (fraction): ${faceAnalytics.attention_on_screen_frac}`);
  if (typeof faceAnalytics.blinks_per_min_avg === 'number') lines.push(`- Blink rate (per minute; ~15-20 is typical): ${faceAnalytics.blinks_per_min_avg}`);

  if (lines.length === 0) return omitInstruction;

  return `Camera-derived body-language metrics for this session:\n${lines.join('\n')}\nBase the "bodyLanguage" score and observations on these real numbers only — do not invent visual details beyond what they support.`;
}

// Speech numbers only describe spoken answers. A candidate who typed (e.g. in Firefox, which has
// no speech recognition) used to be told "Speaking Time: 0 seconds" and get the -15 penalty.
function buildSpeechMetricsSection(metrics: SessionMetrics, spokenAnswers: number, typedAnswers: number): string {
  if (spokenAnswers === 0) {
    return '- The candidate typed every answer, so speaking time, speech rate, filler words and fluency were not measured. Do not apply the speech-based penalties (hard rules 8 and 9).';
  }
  const lines = [
    `- Speaking Time: ${Math.round(metrics.userSpeakingTime / 1000)} seconds${typedAnswers === 0 ? ' (under 60s = insufficient effort, apply -15 penalty)' : ''}`,
    `- Speech Rate: ${metrics.wordsPerMinute} WPM (ideal: 130–160 WPM)`,
    `- Filler Words: ${metrics.fillerWordsCount} (over 10 = deduct 8 from communicationSkills)`,
    `- Speech Fluency Index: ${Math.round(metrics.confidenceScore * 100)}% (this reflects filler-word density, not measured emotional confidence)`,
  ];
  if (typedAnswers > 0) {
    lines.push(`- ${typedAnswers} of ${spokenAnswers + typedAnswers} answers were typed, so the numbers above cover only the spoken ones. Do not apply hard rule 9.`);
  }
  return lines.join('\n');
}

function buildConversationText(messages: IMessage[]): string {
  const text = messages
    .filter((m) => m.kind !== 'nudge') // check-ins after silence aren't questions to grade
    .map((m) => `${m.sender === 'user' ? 'CANDIDATE' : 'INTERVIEWER'}: ${m.text}`)
    .join('\n\n');
  return text.length > MAX_TRANSCRIPT_CHARS
    ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated]`
    : text;
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { interviewId, faceAnalytics: clientFaceAnalytics } = await req.json().catch(() => ({}));

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

    // The client's "end" never arrived (network error, closed tab): close the session now, with
    // the camera summary the client sent here as a fallback.
    if (session.status === 'active') {
      await closeSession(session, new Date(), clientFaceAnalytics);
    }

    const answers = session.messages.filter((m) => m.sender === 'user' && m.text.trim());
    if (answers.length === 0) {
      // Nothing to grade — don't spend an AI call scoring an empty transcript.
      return NextResponse.json(
        { error: 'no_answers', message: "You didn't answer any questions, so there's nothing to grade." },
        { status: 400 }
      );
    }
    const spokenAnswers = answers.filter((m) => typeof m.duration === 'number' && m.duration > 0).length;

    const limited = await rateLimit(aiLimits(req, requester));
    if (limited) return limited;

    const metrics = computeSessionMetrics(session.messages, session.startTime, session.endTime ?? new Date());
    const faceAnalytics = sanitizeFaceAnalytics(session.faceAnalytics) ?? sanitizeFaceAnalytics(clientFaceAnalytics);
    const mentorName = getMentorById(interview.mentorId)?.name ?? 'AI Interviewer';

    const prompt = getReportGenerationPrompt({
      jobTitle: interview.jobTitle,
      userSummary: interview.userSummary,
      jobSummary: interview.jobSummary,
      speechMetricsSection: buildSpeechMetricsSection(metrics, spokenAnswers, answers.length - spokenAnswers),
      conversationText: buildConversationText(session.messages),
      bodyLanguageSection: buildBodyLanguageSection(faceAnalytics),
    });

    // 1. Generate the report. On failure, report it honestly and save nothing — never a
    // fabricated report standing in for a real assessment. Structured output via zod
    // validates shape and score ranges directly.
    let aiAnalysis: ReportOutput;
    try {
      const result = await generateWithGroq(prompt, {
        temperature: 0.3,
        timeoutMs: REPORT_TIMEOUT_MS,
        output: Output.object({ schema: reportSchema }),
      });
      aiAnalysis = enforceRubric(result.output as ReportOutput, answers.length);
    } catch (aiError) {
      console.error('Report generation failed (AI unavailable):', aiError);
      return NextResponse.json(
        { error: 'Report generation is temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }

    // 2. Map QA specificFeedback to include unique IDs (assigned here, not by the model)
    const specificFeedback = aiAnalysis.detailedFeedback.specificFeedback.map((fb, i) => ({
      ...fb,
      questionId: `q${i + 1}`,
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
      interviewDuration: metrics.totalDuration,
      generatedAt: new Date(),
      reportVersion: '5.0',
    });

    try {
      await report.save();
    } catch (saveError) {
      // Two requests raced (double click, retry while the first was still running): the unique
      // index kept one report. Return that one instead of a 500.
      if (isDuplicateKey(saveError)) {
        const winner = await InterviewReport.findOne({ interviewId: String(interview._id) });
        if (winner) return NextResponse.json({ success: true, report: winner, message: 'Report already exists' });
      }
      throw saveError;
    }

    await Promise.all([
      Interview.findByIdAndUpdate(interview._id, {
        reportId: String(report._id),
        reportGenerated: true,
        status: 'completed',
        ...(interview.endDateTime ? {} : { endDateTime: session.endTime }),
      }),
      InterviewSession.findByIdAndUpdate(session._id, {
        status: 'completed',
        reportGenerated: true,
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
