import { getGuestId } from './utils';

export interface GuestStatus {
  guestId: string;
  canStartInterview: boolean;
}

// Starts (or resumes) a guest session and remembers its id. Reuses the stored id when the
// server still knows it, so re-clicking "Try as Guest" doesn't reset the one-interview limit.
export async function startGuestSession(): Promise<GuestStatus> {
  const response = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: getGuestId() }),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.success) throw new Error(data.error || 'Could not start a guest session');
  localStorage.setItem('guestId', data.guestId);
  return { guestId: data.guestId, canStartInterview: data.canStartInterview };
}

// The stored guest, if the server still knows it. A stale id (e.g. the database was reset) is
// cleared so the visitor is offered a fresh guest session instead of failing with 401s.
export async function checkStoredGuest(): Promise<GuestStatus | null> {
  const guestId = getGuestId();
  if (!guestId) return null;
  const response = await fetch(`/api/auth/guest?guestId=${encodeURIComponent(guestId)}`);
  if (response.status === 404) {
    localStorage.removeItem('guestId');
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!data.success) throw new Error(data.error || 'Could not check the guest session');
  return { guestId: data.guestId, canStartInterview: data.canStartInterview };
}
