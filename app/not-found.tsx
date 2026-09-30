import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
        <p className="text-muted-foreground">This page doesn&apos;t exist, or it has moved.</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
          <Button asChild>
            <Link href="/interview/new">Start an interview</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
