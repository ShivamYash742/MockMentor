import { notFound } from 'next/navigation';

// Debug pages (/test-face, /test-speech) are dev-only: production builds serve a 404.
export default function DevOnlyLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
