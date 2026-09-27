import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Interview from '@/lib/models/Interview';
import UserProfile from '@/lib/models/User';
import GuestUser from '@/lib/models/GuestUser';
import { getRequester } from '@/lib/requester';

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    const body = await req.json();
    const { jobTitle, jobDescription, jobSummary, mentorId, resumeSummary } = body;

    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!jobTitle || !jobSummary) {
      return NextResponse.json(
        {
          error: 'Job title and job summary are required',
        },
        { status: 400 }
      );
    }

    const { userId, guestId } = requester;

    if (guestId && !resumeSummary) {
      return NextResponse.json(
        {
          error: 'Resume summary is required for guest users',
        },
        { status: 400 }
      );
    }

    await dbConnect();

    let userSummary: string;

    if (guestId) {
      // Atomic check-and-increment: concurrent requests can't both pass the limit.
      const guestUser = await GuestUser.findOneAndUpdate(
        { guestId, interviewCount: { $lt: 1 } },
        { $inc: { interviewCount: 1 }, lastInterviewAt: new Date() }
      );
      if (!guestUser) {
        return (await GuestUser.exists({ guestId }))
          ? NextResponse.json(
              { error: 'Guest users can only take one interview. Please sign up for more.' },
              { status: 403 }
            )
          : NextResponse.json({ error: 'Guest user not found' }, { status: 404 });
      }

      userSummary = resumeSummary;
    } else {
      if (resumeSummary) {
        userSummary = resumeSummary;
      } else {
        const userProfile = await UserProfile.findOne({ userId }).exec();

        if (!userProfile || !userProfile.resumeSummary) {
          return NextResponse.json(
            {
              error: 'User profile with resume summary not found',
            },
            { status: 404 }
          );
        }

        userSummary = userProfile.resumeSummary;
      }
    }

    const interview = new Interview({
      userId,
      guestId,
      jobTitle,
      jobDescription,
      userSummary,
      jobSummary,
      mentorId,
      status: 'scheduled',
    });

    await interview.save();

    return NextResponse.json({
      success: true,
      interview,
    });
  } catch (error) {
    console.error('Error creating interview:', error);
    return NextResponse.json(
      { error: 'Failed to create interview' },
      { status: 500 }
    );
  }
}