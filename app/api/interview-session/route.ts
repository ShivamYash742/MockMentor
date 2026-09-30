import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import InterviewSession from '@/lib/models/InterviewSession';
import Interview from '@/lib/models/Interview';
import { findOwned, getRequester } from '@/lib/requester';
import { closeSession } from '@/lib/sessionLifecycle';

// Starts or ends an interview's session. Messages are added by /api/ai-chat, which keeps the
// transcript on the server.
export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, faceAnalytics } = body;

    if (!body.interviewId || !action) {
      return NextResponse.json(
        { error: 'Interview ID and action are required' },
        { status: 400 }
      );
    }

    await dbConnect();

    const interview = await findOwned(Interview, body.interviewId, requester);
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }
    const interviewId = String(interview._id);

    switch (action) {
      case 'start': {
        if (interview.status === 'completed') {
          return NextResponse.json(
            { error: 'Interview already completed' },
            { status: 409 }
          );
        }

        // Idempotent: one session per interview (unique index), so a refresh or a
        // double click gets the existing session and its original startTime.
        const session = await InterviewSession.findOneAndUpdate(
          { interviewId },
          {
            $setOnInsert: {
              userId: interview.userId,
              guestId: interview.guestId,
              startTime: new Date(),
              status: 'active',
            },
          },
          { upsert: true, new: true }
        );

        // Rewriting the same values on a repeat start is a no-op. Matching in-progress too links
        // interviews the old page auto-started without a session.
        await Interview.updateOne(
          { _id: interview._id, status: { $ne: 'completed' } },
          {
            status: 'in-progress',
            startDateTime: session.startTime,
            sessionId: String(session._id),
          }
        );

        // The transcript so far, so a refreshed page picks up where it left off.
        return NextResponse.json({
          success: true,
          session: {
            id: session._id,
            status: session.status,
            startTime: session.startTime,
            messages: session.messages.map((m) => ({
              id: m.id,
              sender: m.sender,
              text: m.text,
              duration: m.duration,
              pauseBefore: m.pauseBefore,
            })),
          },
        });
      }

      case 'end': {
        const session = await InterviewSession.findOne({ interviewId, status: 'active' });
        if (!session) {
          return NextResponse.json(
            { error: 'Active session not found' },
            { status: 404 }
          );
        }

        // Metrics are computed from the stored transcript; faceAnalytics is sanitized first.
        await closeSession(session, new Date(), faceAnalytics);

        interview.status = 'completed';
        interview.endDateTime = session.endTime;
        await interview.save();

        return NextResponse.json({
          success: true,
          session: { id: session._id, status: session.status, startTime: session.startTime },
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error managing interview session:', error);
    return NextResponse.json(
      { error: 'Failed to manage interview session' },
      { status: 500 }
    );
  }
}
