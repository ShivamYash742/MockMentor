'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SignInButton, useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Upload,
  FileText,
  Briefcase,
  CheckCircle,
  Loader2,
  User,
  AlertCircle,
  UserPlus,
} from 'lucide-react';

import Navbar from '@/components/navbar';
import { cn, guestHeaders } from '@/lib/utils';
import { mentors } from '@/components/mentors';
import { checkStoredGuest, startGuestSession } from '@/lib/guestSession';

interface UserProfile {
  resumeUrl?: string;
  resumeSummary?: string;
}

// Who is setting up the interview. Every API call below needs a signed-in user or a known guest,
// so without one the page asks first instead of failing each step with a vague 401.
type Identity = 'checking' | 'none' | 'user' | 'guest' | 'guest-used';

// Mirror the server's limits so problems show up before anything is uploaded.
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_RESUME_CHARS = 20_000;
const MAX_JOB_TITLE_CHARS = 200;
const MAX_JOB_DESCRIPTION_CHARS = 10_000;

// Reads the error message from a failed API response, whatever shape it came back in.
async function responseError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null);
  return (data && (data.error || data.message)) || `${fallback} (error ${response.status})`;
}

export default function NewInterviewPage() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const [identity, setIdentity] = useState<Identity>('checking');
  const [guestStarting, setGuestStarting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  // What was last sent to the AI, so going Back and then Next again doesn't re-send (and pay
  // for) an unchanged resume or job description.
  const [processedResumeKey, setProcessedResumeKey] = useState<string | null>(null);
  const [processedJobKey, setProcessedJobKey] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 1: Resume Upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resumeSummary, setResumeSummary] = useState('');
  const [useExistingResume, setUseExistingResume] = useState(false);
  const [resumeText, setResumeText] = useState(''); // For manual text input
  const [uploadMethod, setUploadMethod] = useState<'file' | 'text'>('file');

  // Step 2: Job Details
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [jobSummary, setJobSummary] = useState('');

  // Step 3: Mentor Selection
  const [selectedMentor, setSelectedMentor] = useState<string | null>(null);

  // Work out who this is: a signed-in user (load their saved resume), a guest with an interview
  // left, a guest who has used theirs, or nobody yet.
  useEffect(() => {
    if (!authLoaded) return;
    let cancelled = false;
    (async () => {
      if (isSignedIn) {
        setIdentity('user');
        await fetchUserProfile();
        return;
      }
      try {
        const guest = await checkStoredGuest();
        if (cancelled) return;
        setIdentity(!guest ? 'none' : guest.canStartInterview ? 'guest' : 'guest-used');
      } catch (error) {
        console.error('Error checking guest session:', error);
        if (!cancelled) setIdentity('none');
      } finally {
        if (!cancelled) setFetchLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoaded, isSignedIn]);

  const handleStartGuest = async () => {
    setGuestStarting(true);
    setErrorMessage(null);
    try {
      const guest = await startGuestSession();
      setIdentity(guest.canStartInterview ? 'guest' : 'guest-used');
    } catch (error) {
      console.error('Guest login error:', error);
      setErrorMessage('Could not start a guest session. Please try again.');
    } finally {
      setGuestStarting(false);
    }
  };

  const fetchUserProfile = async () => {
    try {
      setFetchLoading(true);
      const response = await fetch('/api/user-profile');
      if (!response.ok) return;
      const data = await response.json();

      if (data.success && data.userProfile) {
        setUserProfile(data.userProfile);
        if (data.userProfile.resumeSummary) {
          setResumeSummary(data.userProfile.resumeSummary);
          setUseExistingResume(true);
        }
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    } finally {
      setFetchLoading(false);
    }
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setErrorMessage(null);
    const name = file.name.toLowerCase();
    if (!name.endsWith('.pdf') && !name.endsWith('.txt')) {
      setErrorMessage('Only PDF and TXT resumes are supported.');
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      setErrorMessage('That file is too large. The limit is 5MB.');
      return;
    }
    setSelectedFile(file);
    setUseExistingResume(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
  };

  // The drop zone said "drag it here" but had no drop handling.
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const triggerFileInput = () => {
    const fileInput = document.getElementById(
      'resume-upload'
    ) as HTMLInputElement;
    fileInput?.click();
  };

  const processResumeText = async () => {
    if (!resumeText.trim()) return false;

    setErrorMessage(null);
    setLoading(true);

    try {
      const response = await fetch('/api/process-resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...guestHeaders(),
        },
        body: JSON.stringify({ fileContent: resumeText }),
      });

      if (!response.ok) {
        setErrorMessage(await responseError(response, 'Failed to process your resume'));
        return false;
      }

      const data = await response.json();
      setResumeSummary(data.resumeSummary);
      if (data.userProfile) setUserProfile(data.userProfile);
      return true;
    } catch (error) {
      console.error('Error processing resume text:', error);
      setErrorMessage('Failed to process your resume. Please check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const uploadResume = async () => {
    if (!selectedFile) return false;

    setErrorMessage(null);
    setLoading(true);

    try {
      // Send file to server-side API route for Appwrite upload + AI processing
      const formData = new FormData();
      formData.append('resume', selectedFile);

      const response = await fetch('/api/upload-resume', {
        method: 'POST',
        headers: guestHeaders(),
        body: formData,
      });

      // The server's message (e.g. "File is too large (max 5MB)"). The old code threw it inside
      // a try whose own catch replaced it with the raw response body.
      if (!response.ok) {
        setErrorMessage(await responseError(response, 'Failed to upload your resume'));
        return false;
      }

      const data = await response.json();
      setResumeSummary(data.resumeSummary);
      if (data.userProfile) setUserProfile(data.userProfile);
      return true;
    } catch (error) {
      console.error('Error uploading resume:', error);
      setErrorMessage('Failed to upload your resume. Please check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const processJobDetails = async () => {
    setErrorMessage(null);
    if (!jobTitle) {
      setErrorMessage('Please enter a job title');
      return false;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/process-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...guestHeaders(),
        },
        body: JSON.stringify({
          jobTitle,
          jobDescription,
        }),
      });

      if (!response.ok) {
        setErrorMessage(await responseError(response, 'Failed to process the job details'));
        return false;
      }

      const data = await response.json();
      setJobSummary(data.jobSummary);
      return true;
    } catch (error) {
      console.error('Error processing job details:', error);
      setErrorMessage('Failed to process the job details. Please check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const createInterview = async () => {
    setErrorMessage(null);
    if (!jobTitle || !jobSummary || !resumeSummary) {
      setErrorMessage('Please complete all steps before starting the interview');
      return;
    }

    if (!selectedMentor) {
      setErrorMessage('Please select a mentor to continue');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/create-interview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...guestHeaders(),
        },
        body: JSON.stringify({
          jobTitle,
          jobDescription,
          jobSummary,
          mentorId: selectedMentor,
          resumeSummary,
        }),
      });

      if (!response.ok) {
        // The guest used their one interview in another tab since this page loaded.
        if (response.status === 403 && identity === 'guest') setIdentity('guest-used');
        setErrorMessage(await responseError(response, 'Failed to create the interview'));
        setLoading(false); // it used to stay spinning forever after a failed request
        return;
      }

      const data = await response.json();
      // Stays "Starting..." while the interview page loads.
      router.push(`/interview/${data.interview._id}`);
    } catch (error) {
      console.error('Error creating interview:', error);
      setErrorMessage('Failed to create the interview. Please check your connection and try again.');
      setLoading(false);
    }
  };

  const handleNextStep = async () => {
    setErrorMessage(null);
    if (currentStep === 1) {
      // Step 1: Resume processing
      const resumeKey = uploadMethod === 'text'
        ? `text:${resumeText.trim()}`
        : selectedFile ? `file:${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}` : null;
      if (useExistingResume && resumeSummary) {
        setCurrentStep(2);
      } else if (resumeKey && resumeKey === processedResumeKey && resumeSummary) {
        setCurrentStep(2); // unchanged since it was last summarized
      } else if (uploadMethod === 'text' && resumeText.trim()) {
        if (resumeText.length > MAX_RESUME_CHARS) {
          setErrorMessage(`Resume text is too long (max ${MAX_RESUME_CHARS.toLocaleString()} characters).`);
          return;
        }
        const success = await processResumeText();
        if (success) {
          setProcessedResumeKey(resumeKey);
          setCurrentStep(2);
        }
      } else if (uploadMethod === 'file' && selectedFile) {
        const success = await uploadResume();
        if (success) {
          setProcessedResumeKey(resumeKey);
          setCurrentStep(2);
        }
      } else {
        setErrorMessage('Please upload a resume, paste resume text, or use your existing one');
      }
    } else if (currentStep === 2) {
      // Step 2: Job processing
      const jobKey = `${jobTitle.trim()}\n${jobDescription.trim()}`;
      if (jobKey === processedJobKey && jobSummary) {
        setCurrentStep(3);
        return;
      }
      const success = await processJobDetails();
      if (success) {
        setProcessedJobKey(jobKey);
        setCurrentStep(3);
      }
    }
  };

  if (fetchLoading || identity === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (identity === 'none' || identity === 'guest-used') {
    return (
      <div className="min-h-screen bg-background p-4">
        <Navbar />
        <div className="max-w-md mx-auto mt-12">
          <Card className="p-6 text-center space-y-4">
            <h1 className="text-2xl font-bold text-foreground">
              {identity === 'none' ? 'Set up your mock interview' : "You've used your free guest interview"}
            </h1>
            <p className="text-muted-foreground">
              {identity === 'none'
                ? 'Sign in to save your resume and keep your reports, or try one interview as a guest.'
                : 'Sign in to keep practicing. Your account can take as many interviews as you like.'}
            </p>
            {errorMessage && (
              <p role="alert" className="text-sm text-destructive">{errorMessage}</p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <SignInButton mode="modal">
                <Button>Sign in</Button>
              </SignInButton>
              {identity === 'none' && (
                <Button variant="outline" onClick={handleStartGuest} disabled={guestStarting} className="gap-2">
                  {guestStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Try as Guest
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <Navbar />
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Setup Your Interview
          </h1>
          <p className="text-muted-foreground mt-2">
            Complete the steps below to start your mock interview
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div
              className={`flex items-center space-x-2 ${
                currentStep >= 1 ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= 1
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                {currentStep > 1 ? <CheckCircle className="w-5 h-5" /> : '1'}
              </div>
              <span className="hidden sm:inline text-sm font-medium">Resume</span>
            </div>
            <div
              className={`w-4 sm:w-8 h-px ${
                currentStep >= 2 ? 'bg-primary' : 'bg-muted'
              }`}
            />
            <div
              className={`flex items-center space-x-2 ${
                currentStep >= 2 ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= 2
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                {currentStep > 2 ? <CheckCircle className="w-5 h-5" /> : '2'}
              </div>
              <span className="hidden sm:inline text-sm font-medium">Job Details</span>
            </div>
            <div
              className={`w-4 sm:w-8 h-px ${
                currentStep >= 3 ? 'bg-primary' : 'bg-muted'
              }`}
            />
            <div
              className={`flex items-center space-x-2 ${
                currentStep >= 3 ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= 3
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                3
              </div>
              <span className="hidden sm:inline text-sm font-medium">Start Interview</span>
            </div>
          </div>
        </div>

        {/* Step Content */}
        <Card className="p-6">
          {errorMessage && (
            <div className="mb-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2 flex items-center justify-center gap-2">
                  <FileText className="" />
                  Upload Your Resume
                </h2>
                <p className="text-muted-foreground">
                  Upload your resume to get personalized interview questions
                </p>
              </div>

              {userProfile?.resumeSummary && (
                <div className="border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="font-medium text-green-800 dark:text-green-200">
                      Previous Resume Found
                    </span>
                  </div>
                  <p className="text-sm text-green-700 dark:text-green-300 mb-3">
                    {userProfile.resumeSummary}
                  </p>
                  <div className="flex space-x-2">
                    <Button
                      variant={useExistingResume ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setUseExistingResume(true)}
                    >
                      Use Existing Resume
                    </Button>
                    <Button
                      variant={!useExistingResume ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setUseExistingResume(false)}
                    >
                      Upload New Resume
                    </Button>
                  </div>
                </div>
              )}

              {!useExistingResume && (
                <>
                  <div className="flex justify-center gap-2 mb-4">
                    <Button
                      variant={uploadMethod === 'file' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setUploadMethod('file')}
                    >
                      Upload File
                    </Button>
                    <Button
                      variant={uploadMethod === 'text' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setUploadMethod('text')}
                    >
                      Paste Text
                    </Button>
                  </div>

                  {uploadMethod === 'file' ? (
                    <div
                      className={cn(
                        'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                        dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
                      )}
                      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleDrop}
                    >
                      <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Choose a file or drag it here (PDF or TXT, up to 5MB)
                        </p>
                        <input
                          type="file"
                          accept=".pdf,.txt"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="resume-upload"
                        />
                        <Button
                          variant="outline"
                          onClick={triggerFileInput}
                          className="cursor-pointer"
                        >
                          Browse Files
                        </Button>
                      </div>
                      {selectedFile && (
                        <p className="mt-2 text-sm text-green-600">
                          Selected: {selectedFile.name}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label htmlFor="resume-text" className="block text-sm font-medium">
                        Paste Your Resume Text
                      </label>
                      <textarea
                        id="resume-text"
                        maxLength={MAX_RESUME_CHARS}
                        className="w-full min-h-[200px] px-3 py-2 border border-input rounded-md bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="Paste your resume content here...\n\nInclude your experience, skills, education, etc."
                        value={resumeText}
                        onChange={(e) => setResumeText(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Tip: Copy and paste your resume text for quick processing
                        ({resumeText.length.toLocaleString()} / {MAX_RESUME_CHARS.toLocaleString()} characters)
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* {resumeSummary && (
                <div className="bg-muted p-4 rounded-lg">
                  <h3 className="font-medium mb-2">Resume Summary:</h3>
                  <p className="text-sm text-muted-foreground">
                    {resumeSummary}
                  </p>
                </div>
              )} */}
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2 flex items-center justify-center gap-2">
                  <Briefcase />
                  Job Details
                </h2>
                <p className="text-muted-foreground">
                  Provide details about the position you&apos;re interviewing
                  for
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="job-title" className="block text-sm font-medium mb-2">
                    Job Title *
                  </label>
                  <Input
                    id="job-title"
                    maxLength={MAX_JOB_TITLE_CHARS}
                    placeholder="e.g., Senior Software Engineer"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="job-description" className="block text-sm font-medium mb-2">
                    Job Description
                  </label>
                  <textarea
                    id="job-description"
                    maxLength={MAX_JOB_DESCRIPTION_CHARS}
                    className="w-full min-h-[120px] px-3 py-2 border border-input rounded-md bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Paste the job description here for more targeted interview questions..."
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                  />
                </div>
              </div>

              {jobSummary && (
                <div className="bg-muted p-4 rounded-lg">
                  <h3 className="font-medium mb-2">Job Summary:</h3>
                  <p className="text-sm text-muted-foreground">{jobSummary}</p>
                </div>
              )}
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2 flex items-center justify-center gap-2">
                  <User />
                  Choose Your Mentor
                </h2>
                <p className="text-muted-foreground">
                  Select an AI mentor to conduct your interview
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {mentors.map((mentor) => (
                  <button
                    type="button"
                    key={mentor.id}
                    aria-pressed={selectedMentor === mentor.id}
                    aria-label={`${mentor.name}, ${mentor.role}`}
                    className={cn(
                      'relative cursor-pointer rounded-lg border-2 p-3 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selectedMentor === mentor.id
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-primary/50'
                    )}
                    onClick={() => setSelectedMentor(mentor.id)}
                  >
                    <div className="flex flex-col items-center space-y-2">
                      <div className="relative w-full h-32 overflow-hidden rounded-md">
                        <img
                          src={mentor.image}
                          alt={mentor.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="font-medium text-center">{mentor.name}</p>
                      <p className="text-xs text-muted-foreground text-center">{mentor.role}</p>
                    </div>
                    {selectedMentor === mentor.id && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle className="w-5 h-5 text-primary" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {selectedMentor && (
                <div className="text-center">
                  <CheckCircle className="w-16 h-16 mx-auto text-green-600 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    Ready to Start!
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Everything is set up for your mock interview with{' '}
                    {mentors.find((m) => m.id === selectedMentor)?.name}
                  </p>

                  {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left mb-6">
                    <div className="bg-muted p-4 rounded-lg">
                      <h4 className="font-medium mb-2">Your Profile:</h4>
                      <p className="text-sm text-muted-foreground">
                        {resumeSummary}
                      </p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg">
                      <h4 className="font-medium mb-2">Position: {jobTitle}</h4>
                      <p className="text-sm text-muted-foreground">
                        {jobSummary}
                      </p>
                    </div>
                  </div> */}

                  <Button
                    onClick={createInterview}
                    disabled={loading}
                    size="lg"
                    className="w-full md:w-auto"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Starting Interview...
                      </>
                    ) : (
                      'Start Interview'
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* The last step had no way back to fix the job details. */}
          {currentStep === 3 && (
            <div className="flex justify-start mt-6">
              <Button variant="outline" onClick={() => setCurrentStep(2)} disabled={loading}>
                Back
              </Button>
            </div>
          )}

          {/* Navigation Buttons */}
          {currentStep < 3 && (
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
                disabled={currentStep === 1}
              >
                Back
              </Button>
              <Button
                onClick={handleNextStep}
                disabled={
                  loading ||
                  (currentStep === 1 && !useExistingResume && uploadMethod === 'file' && !selectedFile) ||
                  (currentStep === 1 && !useExistingResume && uploadMethod === 'text' && !resumeText.trim())
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Next'
                )}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
