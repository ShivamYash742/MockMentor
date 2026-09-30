'use client';

import Link from 'next/link';
import { useState } from 'react';
import { appConfig } from '@/lib/appConfig';
import { startGuestSession } from '@/lib/guestSession';
import { ThemeToggle } from './theme-provider';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Loader2, UserPlus } from 'lucide-react';

export default function Navbar() {
  const [guestLoading, setGuestLoading] = useState(false);

  const [guestError, setGuestError] = useState(false);

  const handleGuestLogin = async () => {
    setGuestLoading(true);
    setGuestError(false);
    try {
      await startGuestSession();
      window.location.href = '/interview/new';
    } catch (error) {
      console.error('Guest login error:', error);
      setGuestError(true);
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <nav className="">
      <div className="container mx-auto flex max-w-6xl items-center h-16 px-4">
        <div className="mr-2 sm:mr-4 flex">
          <Link className="mr-2 sm:mr-6 flex items-center space-x-2" href="/">
            <span className="font-bold whitespace-nowrap">{appConfig?.title}</span>
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
                  title={guestError ? 'Could not start a guest session. Please try again.' : undefined}
                >
                  {guestLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      {guestError ? (
                        <span>Try again</span>
                      ) : (
                        <span>
                          <span className="hidden sm:inline">Try as </span>Guest
                        </span>
                      )}
                    </>
                  )}
                </Button>
                <SignInButton>
                  <Button variant="ghost" className="whitespace-nowrap px-2 sm:px-4">Sign in</Button>
                </SignInButton>
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