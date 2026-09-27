import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Interview from '@/lib/models/Interview';
import InterviewReport from '@/lib/models/InterviewReport';
import { findOwned, getRequester } from '@/lib/requester';

// Read-only: viewing a report never triggers an AI call. [id] is the interview id.
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
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const report = await InterviewReport.findOne({ interviewId: String(interview._id) });
    if (!report) {
      return NextResponse.json({ error: 'Report not generated yet' }, { status: 404 });
    }

    return NextResponse.json({ success: true, report });
  } catch (error) {
    console.error('Error fetching report:', error);
    return NextResponse.json({ error: 'Failed to fetch report' }, { status: 500 });
  }
}
