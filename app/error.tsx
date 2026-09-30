'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// Shown instead of a blank page when a page throws while rendering.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="text-muted-foreground">
          This page hit an unexpected error. Your interviews and reports are saved, so trying again is safe.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
