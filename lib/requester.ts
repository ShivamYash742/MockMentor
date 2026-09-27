import { auth } from '@clerk/nextjs/server';
import { isObjectIdOrHexString, type Model } from 'mongoose';
import dbConnect from './mongodb';
import GuestUser from './models/GuestUser';

// Who is calling: a signed-in Clerk user, or a guest identified by the x-guest-id header.
// A Clerk user id takes precedence so a stale guest id in localStorage is ignored after sign-in.
export type Requester = { userId: string; guestId?: never } | { guestId: string; userId?: never };

type Owned = { userId?: string; guestId?: string };

// A guest id only counts if it names a real GuestUser — otherwise anyone could invent one
// and call every guest-accessible route for free. Checked here once, so every caller gets it.
export async function getRequester(req: Request): Promise<Requester | null> {
  const { userId } = await auth();
  if (userId) return { userId };
  const guestId = req.headers.get('x-guest-id');
  if (!guestId) return null;
  await dbConnect();
  const exists = await GuestUser.exists({ guestId });
  return exists ? { guestId } : null;
}

export function isOwner(doc: Owned, requester: Requester): boolean {
  return requester.userId ? doc.userId === requester.userId : doc.guestId === requester.guestId;
}

// Loads a document by id if the requester owns it. Malformed ids, missing docs and
// docs owned by someone else all return null, so routes answer 404 without leaking existence.
export async function findOwned<T extends Owned>(model: Model<T>, id: unknown, requester: Requester) {
  if (!isObjectIdOrHexString(id)) return null;
  const doc = await model.findById(id);
  return doc && isOwner(doc, requester) ? doc : null;
}
