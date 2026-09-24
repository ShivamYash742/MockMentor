import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import GuestUser from '@/lib/models/GuestUser';

export async function POST(req: NextRequest) {
  try {
    await dbConnect();

    const { guestId } = await req.json().catch(() => ({ guestId: null }));

    let guestUser;

    if (guestId) {
      guestUser = await GuestUser.findOne({ guestId });
    }

    if (!guestUser) {
      const newGuestId = crypto.randomUUID();
      guestUser = new GuestUser({
        guestId: newGuestId,
        interviewCount: 0,
      });
      await guestUser.save();
    }

    return NextResponse.json({
      success: true,
      guestId: guestUser.guestId,
      interviewCount: guestUser.interviewCount,
      canStartInterview: guestUser.interviewCount < 1,
    });
  } catch (error) {
    console.error('Error creating guest user:', error);
    return NextResponse.json(
      { error: 'Failed to create guest user' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const guestId = searchParams.get('guestId');

    if (!guestId) {
      return NextResponse.json(
        { error: 'Guest ID is required' },
        { status: 400 }
      );
    }

    const guestUser = await GuestUser.findOne({ guestId });

    if (!guestUser) {
      return NextResponse.json(
        { error: 'Guest user not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      guestId: guestUser.guestId,
      interviewCount: guestUser.interviewCount,
      canStartInterview: guestUser.interviewCount < 1,
    });
  } catch (error) {
    console.error('Error fetching guest user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch guest user' },
      { status: 500 }
    );
  }
}