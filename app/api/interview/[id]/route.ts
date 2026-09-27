import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Interview from '@/lib/models/Interview';
import InterviewSession from '@/lib/models/InterviewSession';
import { GRACE_MS, interviewEndTime } from '@/lib/interviewWindow';
import { findOwned, getRequester } from '@/lib/requester';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requester = await getRequester(req);

    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    const interview = await findOwned(Interview, id, requester);

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      );
    }

    // An interview left in progress past its time limit (tab closed, crash) is closed here.
    if (interview.status === 'in-progress' && interview.startDateTime) {
      const endTime = interviewEndTime(interview.startDateTime);
      if (Date.now() > endTime.getTime() + GRACE_MS) {
        interview.status = 'completed';
        interview.endDateTime = endTime;
        await interview.save();
        // Older in-progress interviews have no session (the page used to start them on load).
        if (interview.sessionId) {
          await InterviewSession.updateOne(
            { _id: interview.sessionId, status: 'active' },
            { status: 'completed', endTime }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      interview,
    });
  } catch (error) {
    console.error('Error fetching interview:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interview' },
      { status: 500 }
    );
  }
}
