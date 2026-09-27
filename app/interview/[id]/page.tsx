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
import { getMentorById } from '@/components/mentors';
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
        knowledgeBase={getKnowledgeBase(interview)}
      />
    </VoiceInterviewProvider>
  );
}

const getKnowledgeBase = (interview: Interview) => {
  const mentor = getMentorById(interview.mentorId);
  const basePersonality = mentor?.personality || 'You are an AI-powered interviewer conducting a mock interview for a specific job position.';

  return `
  ${basePersonality}
  
  The candidate is described as follows: ${interview.userSummary}. 

  The job role is described as follows: ${interview.jobSummary}.

  Your task is to conduct a professional mock interview for this position. This is a short 3-minute mock interview, so you should ask 2-3 concise but highly relevant questions to assess the candidate. Tailor the questions to the candidate's background and the job's requirements, specifically looking through the lens of your assigned mentor personality. Ensure the questions are clear, concise, and encourage detailed responses. Maintain a conversational and engaging tone throughout the interview matching your persona. Keep track of time and make sure to provide valuable feedback within the 3-minute timeframe.

  IMPORTANT CONVERSATION FLOW:
  - After asking each question, pause and give the candidate time to think and respond
  - You can say phrases like "Please take your time to answer" or "You can go ahead and answer now" or "Feel free to share your thoughts"
  - Wait for the candidate's response before proceeding to the next question
  - Don't rush through questions - allow natural conversation flow with appropriate pauses
  - If there's silence after asking a question, you can gently encourage them with "You can start answering whenever you're ready"
  `;
};
