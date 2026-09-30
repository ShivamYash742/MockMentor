import { NextResponse } from 'next/server';
import dbConnect from './mongodb';
import RateLimit from './models/RateLimit';
import type { Requester } from './requester';
import { clientIp } from './clientIp';

export { clientIp };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface Limit {
  name: string;
  limit: number;
  windowMs: number;
}

// Per identity caps what one user or guest can spend; per IP caps someone minting new guests to
// get around that. Many people can share one IP (a classroom or office behind one router), so
// the IP limits are deliberately generous.
export const LIMITS = {
  guestCreatePerIp: { name: 'guest-create-ip', limit: 20, windowMs: HOUR },
  aiPerIdentity: { name: 'ai-id', limit: 100, windowMs: HOUR },
  aiPerIp: { name: 'ai-ip', limit: 600, windowMs: HOUR },
  interviewsPerUser: { name: 'interview-user', limit: 20, windowMs: DAY },
} satisfies Record<string, Limit>;

export function identityKey(requester: Requester): string {
  return requester.userId ? `user:${requester.userId}` : `guest:${requester.guestId}`;
}

// Counts one request against a fixed window. Returns seconds until the window resets when the
// limit is exceeded, or 0 when the request is allowed.
async function hit({ name, limit, windowMs }: Limit, subject: string): Promise<number> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${name}:${subject}:${windowStart}`;
  const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs) } };
  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate({ key }, update, { upsert: true, new: true });
  } catch (error) {
    // Two first requests in the same window can race on the unique key; the retry increments.
    if ((error as { code?: number })?.code !== 11000) throw error;
    doc = await RateLimit.findOneAndUpdate({ key }, update, { new: true });
  }
  return doc && doc.count > limit ? Math.ceil((windowStart + windowMs - now) / 1000) : 0;
}

// Checks every limit (each request counts against all of them). Returns a 429 response to send
// back, or null if the request may go ahead. A null subject (unknown IP) skips that limit.
export async function rateLimit(checks: Array<[Limit, string | null]>): Promise<NextResponse | null> {
  await dbConnect();
  let retryAfter = 0;
  for (const [limit, subject] of checks) {
    if (subject) retryAfter = Math.max(retryAfter, await hit(limit, subject));
  }
  if (retryAfter === 0) return null;
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return NextResponse.json(
    {
      success: false,
      error: 'rate_limit',
      message: `Too many requests. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

// The usual pair for any route that calls the AI.
export function aiLimits(req: Request, requester: Requester): Array<[Limit, string | null]> {
  return [
    [LIMITS.aiPerIdentity, identityKey(requester)],
    [LIMITS.aiPerIp, clientIp(req)],
  ];
}
