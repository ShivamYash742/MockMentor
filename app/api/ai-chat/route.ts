import { NextRequest, NextResponse } from 'next/server';
import { generateWithGroq } from '@/lib/groq';
import { getInterviewWelcomePrompt, getInterviewConversationPrompt, getInterviewKnowledgeBase } from '@/lib/promptHelper';
import { appConfig } from '@/lib/appConfig';
import dbConnect from '@/lib/mongodb';
import Interview from '@/lib/models/Interview';
import { findOwned, getRequester } from '@/lib/requester';
import { getMentorById } from '@/lib/mentors';
import { GRACE_MS, isInterviewLive } from '@/lib/interviewWindow';

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;

export async function POST(request: NextRequest) {
  try {
    const requester = await getRequester(request);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { interviewId, message, conversationHistory } = await request.json().catch(() => ({}));

    if (!interviewId || !message) {
      return NextResponse.json(
        { error: 'interviewId and message are required' },
        { status: 400 }
      );
    }

    await dbConnect();
    const interview = await findOwned(Interview, interviewId, requester);
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    // Caps how much AI use one interview can rack up, without a rate-limit library.
    if (interview.status !== 'in-progress' || !isInterviewLive(interview.startDateTime, GRACE_MS)) {
      return NextResponse.json({ error: 'This interview is no longer active' }, { status: 409 });
    }

    // The prompt is built entirely server-side — the client can no longer supply its own
    // system prompt or interview context.
    const mentor = getMentorById(interview.mentorId);
    const knowledgeBase = getInterviewKnowledgeBase(mentor?.personality, interview.userSummary, interview.jobSummary);
    const role = interview.jobTitle;

    // Handle special cases
    if (message === 'START_INTERVIEW') {
      const welcomePrompt = getInterviewWelcomePrompt(knowledgeBase, role);
      const result = await generateWithGroq(welcomePrompt);

      return NextResponse.json({
        success: true,
        response: result.text.trim(),
      });
    }

    // Build conversation context for regular responses — capped so a client can't inflate
    // the prompt (and the Groq bill) with an unbounded history.
    const history: Array<{ sender?: string; text?: string }> = Array.isArray(conversationHistory) ? conversationHistory : [];
    const conversationHistoryText = history
      .slice(-MAX_HISTORY_MESSAGES)
      .map((msg) => `${msg?.sender ?? ''}: ${String(msg?.text ?? '').slice(0, MAX_MESSAGE_CHARS)}`)
      .join('\n') || 'No previous conversation';

    const systemPrompt = getInterviewConversationPrompt({
      knowledgeBase,
      role,
      candidateBackground: 'New candidate joining',
      duration: `${appConfig.interviewDurationSec / 60} minutes`,
      conversationHistory: conversationHistoryText,
      message: String(message).slice(0, MAX_MESSAGE_CHARS),
      isUserPaused: message === '[USER_PAUSED]'
    });

    const result = await generateWithGroq(systemPrompt);

    return NextResponse.json({
      success: true,
      response: result.text.trim(),
    });

  } catch (error: unknown) {
    console.error('Error generating AI response:', error);

    // Report the failure honestly instead of returning a canned line dressed up as a real
    // interviewer response — the user should know the AI is down, not be quietly misled.
    const isRateLimit = (error as Error)?.message?.includes('rate_limit') || (error as Error)?.message?.includes('429');
    return NextResponse.json(
      { success: false, error: isRateLimit ? 'rate_limit' : 'ai_error' },
      { status: 503 }
    );
  }
}
