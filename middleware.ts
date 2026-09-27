import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/', 
  '/test-face(.*)',
  '/api/auth/guest(.*)',
  '/api/guest/interview-count(.*)',
  '/api/create-interview(.*)',
  '/api/interview-session(.*)',
  '/api/process-resume(.*)',
  '/api/upload-resume(.*)',
  '/api/process-job(.*)',
  '/api/user-profile(.*)',
  '/api/interview/(.*)',
  '/api/ai-chat(.*)',
  '/api/generate-report(.*)',
  '/api/report/(.*)',
  '/interview/new(.*)',
  '/interview/(.*)',
  '/report/(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
