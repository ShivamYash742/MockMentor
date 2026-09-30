import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Interview from '@/lib/models/Interview';
import UserProfile from '@/lib/models/User';
import GuestUser from '@/lib/models/GuestUser';
import { getRequester } from '@/lib/requester';
import { getMentorById } from '@/lib/mentors';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { LIMITS, identityKey, rateLimit } from '@/lib/rateLimit';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Everything here ends up in every interviewer and report prompt for this interview, so it's
    // type-checked and bounded. The summaries come from our own AI, echoed back by the client.
    const body = await req.json().catch(() => ({}));
    const jobTitle = text(body.jobTitle);
    const jobDescription = text(body.jobDescription);
    const jobSummary = text(body.jobSummary).slice(0, INPUT_LIMITS.summaryChars);
    const resumeSummary = text(body.resumeSummary).slice(0, INPUT_LIMITS.summaryChars);
    const mentor = getMentorById(text(body.mentorId));

    if (!jobTitle || !jobSummary) {
      return NextResponse.json(
        {
          error: 'Job title and job summary are required',
        },
        { status: 400 }
      );
    }
    if (jobTitle.length > INPUT_LIMITS.jobTitleChars || jobDescription.length > INPUT_LIMITS.jobDescriptionChars) {
      return NextResponse.json({ error: 'Job title or description is too long' }, { status: 400 });
    }
    if (!mentor) {
      return NextResponse.json({ error: 'Please choose one of the mentors' }, { status: 400 });
    }
    const mentorId = mentor.id;

    const { userId, guestId } = requester;

    // Guests are limited to one interview below; signed-in users get a daily cap.
    if (userId) {
      const limited = await rateLimit([[LIMITS.interviewsPerUser, identityKey(requester)]]);
      if (limited) return limited;
    }

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
      // getRequester() already confirmed this guestId exists, so a miss here only means the limit was hit.
      const guestUser = await GuestUser.findOneAndUpdate(
        { guestId, interviewCount: { $lt: 1 } },
        { $inc: { interviewCount: 1 }, lastInterviewAt: new Date() }
      );
      if (!guestUser) {
        return NextResponse.json(
          { error: 'Guest users can only take one interview. Please sign up for more.' },
          { status: 403 }
        );
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
      jobDescription: jobDescription || undefined,
      userSummary,
      jobSummary,
      mentorId,
      status: 'scheduled',
    });

    try {
      await interview.save();
    } catch (saveError) {
      // Don't use up the guest's one interview on an interview that was never created.
      if (guestId) await GuestUser.updateOne({ guestId }, { $inc: { interviewCount: -1 } });
      throw saveError;
    }

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