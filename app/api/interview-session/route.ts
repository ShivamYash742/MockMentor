import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import InterviewSession from '@/lib/models/InterviewSession';
import Interview from '@/lib/models/Interview';
import { findOwned, getRequester } from '@/lib/requester';

// Create or update interview session
export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, messageData, metricsData } = body;

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

    let session;

    switch (action) {
      case 'start':
        if (interview.status === 'completed') {
          return NextResponse.json(
            { error: 'Interview already completed' },
            { status: 409 }
          );
        }

        // Idempotent: one session per interview (unique index), so a refresh or a
        // double click gets the existing session and its original startTime.
        session = await InterviewSession.findOneAndUpdate(
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
        break;

      case 'add_message':
        if (!messageData) {
          return NextResponse.json(
            { error: 'Message data is required' },
            { status: 400 }
          );
        }

        session = await InterviewSession.findOne({
          interviewId,
          status: 'active',
        });

        if (!session) {
          return NextResponse.json(
            { error: 'Active session not found' },
            { status: 404 }
          );
        }

        session.messages.push({
          id: messageData.id || Date.now().toString(),
          sender: messageData.sender,
          text: messageData.text,
          timestamp: new Date(messageData.timestamp || Date.now()),
          duration: messageData.duration,
          pauseBefore: messageData.pauseBefore,
          confidence: messageData.confidence,
          emotion: messageData.emotion,
          volume: messageData.volume,
        });

        await session.save();
        break;

      case 'end':
        session = await InterviewSession.findOne({
          interviewId,
          status: 'active',
        });

        if (!session) {
          return NextResponse.json(
            { error: 'Active session not found' },
            { status: 404 }
          );
        }

        session.endTime = new Date();
        session.status = 'completed';

        if (metricsData) {
          session.metrics = metricsData;
        }

        await session.save();

        interview.status = 'completed';
        interview.endDateTime = session.endTime;
        await interview.save();
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        startTime: session.startTime,
        messageCount: session.messages?.length || 0,
      },
    });
  } catch (error) {
    console.error('Error managing interview session:', error);
    return NextResponse.json(
      { error: 'Failed to manage interview session' },
      { status: 500 }
    );
  }
}
