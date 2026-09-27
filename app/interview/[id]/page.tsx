'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { VoiceInterviewProvider } from '@/components/logic';
import Interview from '@/components/interview';
import LoadingSkeleton from '@/components/loading-skeleton';
import InterviewComplete from '@/components/interview-complete';
import Link from 'next/link';
import { guestHeaders } from '@/lib/utils';

interface Interview {
  _id: string;
  userId: string;
  jobTitle: string;
  jobDescription?: string;
  userSummary: string;
  jobSummary: string;
  status: 'scheduled' | 'in-progress' | 'completed';
  startDateTime?: string;
  sessionId?: string;
  reportId?: string;
  createdAt: string;
  updatedAt: string;
  mentorId: string;
}

export default function InterviewPage() {
  const params = useParams();
  const interviewId = params.id as string;

  const [interview, setInterview] = useState<Interview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch interview data
  const fetchInterview = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/interview/${interviewId}`, { headers: guestHeaders() });
      const data = await response.json();

      if (data.success) {
        setInterview(data.interview);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch interview');
      }
    } catch (error) {
      console.error('Error fetching interview:', error);
      setError('Failed to fetch interview');
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  // Fetch interview on component mount
  useEffect(() => {
    if (interviewId) {
      fetchInterview();
    }
  }, [interviewId, fetchInterview]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 max-w-md w-full text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={fetchInterview} variant="outline">
            <Link href="/interview/new">Start New Interview</Link>
          </Button>
        </Card>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 max-w-md w-full text-center">
          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Interview Not Found</h2>
          <p className="text-gray-600">
            The requested interview could not be found.
          </p>
        </Card>
      </div>
    );
  }

  if (interview.status === 'completed') {
    return (
      <InterviewComplete
        interviewId={interview._id}
        sessionId={interview.sessionId}
        hasReport={!!interview.reportId}
      />
    );
  }

  return (
    <VoiceInterviewProvider>
      <Interview
        interviewId={interview._id}
        mentorId={interview.mentorId}
        role={interview.jobTitle}
      />
    </VoiceInterviewProvider>
  );
}
