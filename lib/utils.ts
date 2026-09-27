import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Identifies a guest to the API; see getRequester in lib/requester.ts.
export function guestHeaders(): Record<string, string> {
  const guestId = localStorage.getItem('guestId')
  return guestId ? { 'x-guest-id': guestId } : {}
}
