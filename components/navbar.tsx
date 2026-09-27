'use client';

import Link from 'next/link';
import { useState } from 'react';
import { appConfig } from '@/lib/appConfig';
import { getGuestId } from '@/lib/utils';
import { ThemeToggle } from './theme-provider';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Loader2, UserPlus } from 'lucide-react';

export default function Navbar() {
  const [guestLoading, setGuestLoading] = useState(false);

  const handleGuestLogin = async () => {
    setGuestLoading(true);
    try {
      // Reuse the existing guest id if there is one, so re-clicking doesn't reset the interview limit.
      const response = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId: getGuestId() }),
      });
      const data = await response.json();
      if (data.success) {
        localStorage.setItem('guestId', data.guestId);
        window.location.href = '/interview/new';
      } else {
        alert('Failed to create guest session: ' + data.error);
      }
    } catch (error) {
      console.error('Guest login error:', error);
      alert('Failed to create guest session');
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <nav className="">
      <div className="container mx-auto flex max-w-6xl items-center h-16 px-4">
        <div className="mr-4 flex">
          <Link className="mr-6 flex items-center space-x-2" href="/">
            <span className="font-bold">{appConfig?.title}</span>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none"></div>
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <SignedOut>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleGuestLogin}
                  disabled={guestLoading}
                  className="gap-2"
                >
                  {guestLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Try as Guest</span>
                    </>
                  )}
                </Button>
                <SignInButton />
              </div>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </nav>
        </div>
      </div>
    </nav>
  );
}