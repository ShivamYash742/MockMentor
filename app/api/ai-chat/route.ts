import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { generateWithGroq } from '@/lib/groq';
import { getInterviewWelcomePrompt, getInterviewConversationPrompt, getInterviewKnowledgeBase } from '@/lib/promptHelper';
import { appConfig } from '@/lib/appConfig';
import dbConnect from '@/lib/mongodb';
import Interview from '@/lib/models/Interview';
import InterviewSession, { type IMessage } from '@/lib/models/InterviewSession';
import { findOwned, getRequester } from '@/lib/requester';
import { getMentorById } from '@/lib/mentors';
import { GRACE_MS, isInterviewLive } from '@/lib/interviewWindow';
import { START_INTERVIEW, USER_PAUSED } from '@/lib/chatProtocol';
import { sanitizeTiming } from '@/lib/sessionLifecycle';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { aiLimits, rateLimit } from '@/lib/rateLimit';

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = INPUT_LIMITS.answerChars;
// Caps how many AI calls one interview can make: every call stores at least one message.
const MAX_SESSION_MESSAGES = 60;

function historyText(messages: IMessage[]): string {
  return messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => `${m.sender === 'user' ? 'Candidate' : 'Interviewer'}: ${m.text.slice(0, MAX_MESSAGE_CHARS)}`)
    .join('\n') || 'No previous conversation';
}

function newMessage(sender: IMessage['sender'], text: string, extra: Partial<IMessage> = {}): IMessage {
  return { id: randomUUID(), sender, text, timestamp: new Date(), ...extra };
}

// The server keeps the transcript: each call stores the candidate's answer and the interviewer's
// reply in order. The report is graded from this copy, so a client can't rewrite either side.
async function appendMessages(sessionId: unknown, messages: IMessage[]) {
  await InterviewSession.updateOne(
    { _id: sessionId, status: 'active' },
    { $push: { messages: { $each: messages } } },
    { runValidators: true }
  );
}

async function generateReply(prompt: string): Promise<string> {
  const { text } = await generateWithGroq(prompt);
  const reply = text.trim();
  if (!reply) throw new Error('Empty reply from the model');
  return reply;
}

export async function POST(request: NextRequest) {
  try {
    const requester = await getRequester(request);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const interviewId = body?.interviewId;
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : '';

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

    // Caps how long one interview can keep using the AI.
    const session = interview.status === 'in-progress' && isInterviewLive(interview.startDateTime, GRACE_MS)
      ? await InterviewSession.findOne({ interviewId: String(interview._id), status: 'active' })
      : null;
    if (!session) {
      return NextResponse.json({ success: false, error: 'inactive' }, { status: 409 });
    }

    // The prompt is built entirely server-side — the client can't supply its own system prompt,
    // interview context or conversation history.
    const mentor = getMentorById(interview.mentorId);
    const knowledgeBase = getInterviewKnowledgeBase(mentor?.personality, interview.userSummary, interview.jobSummary);
    const role = interview.jobTitle;

    if (message === START_INTERVIEW) {
      // After a refresh the interview already has its welcome: repeat the last thing the
      // interviewer said instead of starting over (the client already shows it in the transcript).
      const lastQuestion = [...session.messages].reverse().find((m) => m.sender === 'interviewer');
      if (lastQuestion) {
        return NextResponse.json({ success: true, response: lastQuestion.text, resumed: true });
      }
      const limited = await rateLimit(aiLimits(request, requester));
      if (limited) return limited;
      const response = await generateReply(getInterviewWelcomePrompt(knowledgeBase, role));
      await appendMessages(session._id, [newMessage('interviewer', response)]);
      return NextResponse.json({ success: true, response });
    }

    if (session.messages.length >= MAX_SESSION_MESSAGES) {
      return NextResponse.json({ success: false, error: 'message_limit' }, { status: 409 });
    }
    const limited = await rateLimit(aiLimits(request, requester));
    if (limited) return limited;

    const isUserPaused = message === USER_PAUSED;
    const systemPrompt = getInterviewConversationPrompt({
      knowledgeBase,
      role,
      candidateBackground: 'New candidate joining',
      duration: `${appConfig.interviewDurationSec / 60} minutes`,
      conversationHistory: historyText(session.messages),
      message,
      isUserPaused,
    });

    // The answer is kept even if the AI call below fails — it's still part of the interview.
    if (!isUserPaused) {
      await appendMessages(session._id, [newMessage('user', message, sanitizeTiming(body.timing))]);
    }

    const response = await generateReply(systemPrompt);
    await appendMessages(session._id, [
      newMessage('interviewer', response, isUserPaused ? { kind: 'nudge' } : {}),
    ]);

    return NextResponse.json({ success: true, response });
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
