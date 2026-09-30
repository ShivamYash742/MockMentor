import React, { useState, useEffect } from 'react';
import { CheckCircle, ArrowRight, Loader2, Sparkles, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { guestHeaders } from '@/lib/utils';

interface InterviewCompleteProps {
  interviewId?: string;
  sessionId?: string | null;
  faceAnalytics?: object | null;
  hasReport?: boolean;
}

const MAX_RETRIES = 3;

const InterviewComplete: React.FC<InterviewCompleteProps> = ({ interviewId, sessionId, faceAnalytics, hasReport = false }) => {
  const [showAnimation, setShowAnimation] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(hasReport);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // The candidate never answered, so the server has nothing to grade (and won't spend an AI call).
  const [nothingToGrade, setNothingToGrade] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowAnimation(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const generateReport = async () => {
    if (!interviewId || !sessionId) return;
    
    setGeneratingReport(true);
    setError(null);
    try {
      const body = { interviewId, ...(faceAnalytics ? { faceAnalytics } : {}) };
      const response = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...guestHeaders() },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.success) {
        setReportGenerated(true);
      } else if (data.error === 'no_answers') {
        setNothingToGrade(true);
      } else if (data.error === 'rate_limit') {
        setError(data.message); // a wait, not a failure: doesn't use up a retry
      } else {
        throw new Error(data.error || 'Report generation failed');
      }
    } catch (err) {
      console.error('Error generating report:', err);
      setRetryCount(prev => prev + 1);
      setError(
        retryCount + 1 >= MAX_RETRIES
          ? 'Report generation failed after multiple attempts. Please come back to this page and try again later.'
          : `Report generation failed. ${MAX_RETRIES - retryCount - 1} retries remaining.`
      );
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-background to-secondary/20 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute top-0 -left-64 w-96 h-96 bg-primary/10 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob" />
      <div className="absolute top-0 -right-64 w-96 h-96 bg-purple-500/10 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000" />
      <div className="absolute -bottom-64 left-1/2 w-96 h-96 bg-green-500/10 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-4000" />

      <Card className="max-w-xl w-full border border-border/50 bg-background/60 backdrop-blur-xl shadow-2xl relative z-10">
        <div className="p-8 sm:p-12 space-y-10">
          
          {/* Success Icon and Title */}
          <div
            className={`text-center space-y-6 transition-all duration-1000 ease-out transform ${
              showAnimation ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-10 opacity-0 scale-95'
            }`}
          >
            <div className="flex justify-center relative">
               <div className="absolute inset-0 bg-green-500/20 blur-xl rounded-full" />
               <div className="p-5 rounded-full bg-gradient-to-br from-green-400 to-green-600 relative z-10 shadow-lg shadow-green-500/30">
                 <CheckCircle className="w-12 h-12 text-white" strokeWidth={2.5} />
               </div>
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                Mission Accomplished
              </h1>
              <p className="text-lg text-muted-foreground max-w-md mx-auto leading-relaxed">
                You&apos;ve successfully completed your mock interview. The data has been captured and is ready for analysis.
              </p>
            </div>
          </div>

          {nothingToGrade && (
            <p role="status" className="text-center text-muted-foreground">
              You didn&apos;t answer any questions in this interview, so there&apos;s nothing to grade.
              Start a new interview to practice.
            </p>
          )}

          {/* Error State */}
          {error && (
            <div
              className={`flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 backdrop-blur-sm transition-all duration-500 ${
                showAnimation ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-300">{error}</p>
                {retryCount < MAX_RETRIES && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={generateReport}
                    disabled={generatingReport}
                    className="mt-2 h-8 text-red-300 hover:text-red-100 hover:bg-red-500/20 gap-2"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div
            className={`flex flex-col sm:flex-row justify-center items-center gap-4 transition-all duration-1000 delay-300 ease-out transform ${
              showAnimation ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
            }`}
          >
            {!reportGenerated && !nothingToGrade && interviewId && sessionId && !error && (
              <Button 
                size="lg" 
                onClick={generateReport}
                disabled={generatingReport}
                className="w-full sm:w-auto h-14 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-xl shadow-blue-500/25 transition-all active:scale-95 group relative overflow-hidden"
              >
                {generatingReport ? (
                  <>
                     <Loader2 className="mr-3 w-5 h-5 animate-spin" />
                     Synthesizing Insights...
                  </>
                ) : (
                  <>
                     <Sparkles className="mr-3 w-5 h-5 group-hover:animate-pulse" />
                     Generate Detailed Report
                  </>
                )}
                {/* Shine effect inside button */}
                <div className="absolute inset-0 -translate-x-[150%] bg-white/20 skew-x-[-20deg] group-hover:animate-[shine_1.5s_ease-out]" />
              </Button>
            )}
            
            {reportGenerated && (
              <Button 
                size="lg" 
                asChild 
                className="w-full sm:w-auto h-14 px-8 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-xl shadow-emerald-500/25 transition-all active:scale-95 group"
              >
                <Link href={`/report/${interviewId}`}>
                  View Intelligence Report
                  <ArrowRight className="ml-3 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            )}
            
            <Button size="lg" variant="outline" asChild className="w-full sm:w-auto h-14 px-8 border-border/60 hover:bg-muted/50 backdrop-blur-sm transition-all active:scale-95">
              <Link href="/interview/new">
                Start a new interview
              </Link>
            </Button>
          </div>

        </div>
      </Card>
    </div>
  );
};

export default InterviewComplete;

