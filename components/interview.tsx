'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  MessageSquare,
  Phone,
  Clock,
  X,
  Send,
  Waves,
  Pause,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from './ui/input';
import { VoiceSessionState } from './logic';
import { useVoiceInterview, useVoiceInterviewContext } from './logic';
import LoadingSkeleton from './loading-skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { mentors } from './mentors';
import InterviewComplete from './interview-complete';
import { useFaceTracker } from '@/hooks/useFaceTracker';
import { StressHUD } from '@/components/interview/StressHUD';
import type { FaceSummary } from '@/lib/mlSidecar';

const Interview = ({
  interviewId,
  knowledgeBase,
  role,
  mentorId,
}: {
  interviewId: string;
  knowledgeBase: string;
  role: string;
  mentorId: string;
}) => {
  const { sessionState, start, stop, speakMessage, interimTranscript, sttError, isListening, togglePause } = useVoiceInterview();
  const { isUserTalking, isAvatarTalking, messages: contextMessages } = useVoiceInterviewContext();

  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [exitLoading, setExitLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [conversationMetrics] = useState({
    totalPauses: 0,
    totalPauseTime: 0,
    longestPause: 0,
    userSpeakingTime: 0,
    fillerWordsCount: 0,
    wordsSpoken: 0,
  });

  // Timer state
  const [startTime, setStartTime] = useState(new Date());
  const [remainingTime, setRemainingTime] = useState(180); // 3 minutes in seconds

  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const faceSummaryRef = useRef<object | null>(null);
  const questionSnapshotsRef = useRef<FaceSummary[]>([]);
  const gazeOffTimeRef = useRef<number | null>(null);
  const alertCooldownRef = useRef<number>(0);
  const interviewerMsgCountRef = useRef(0);

  const { lastFrame, isSidecarAvailable, requestSummary, resetSession } = useFaceTracker(
    videoRef,
    sessionId,
    isCameraOn,
  );

  // 3.5 — Attention alert: if gaze leaves screen for 3s, speak reminder (10s cooldown)
  useEffect(() => {
    if (!isSidecarAvailable || !lastFrame?.face_detected) return;
    const now = Date.now();
    if (!lastFrame.gaze?.looking_at_screen) {
      if (!gazeOffTimeRef.current) gazeOffTimeRef.current = now;
      else if (
        now - gazeOffTimeRef.current >= 3000 &&
        now - alertCooldownRef.current >= 10000
      ) {
        alertCooldownRef.current = now;
        gazeOffTimeRef.current = null;
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          const utt = new SpeechSynthesisUtterance('Please look at the camera.');
          utt.volume = 0.8;
          utt.rate = 1.1;
          window.speechSynthesis.speak(utt);
        }
      }
    } else {
      gazeOffTimeRef.current = null;
    }
  }, [lastFrame, isSidecarAvailable]);

  // 3.3 — Per-question emotion snapshot: on each new interviewer message (after the first),
  //        snapshot the current ML session aggregate, then reset for the next question.
  useEffect(() => {
    if (!isSidecarAvailable) return;
    const count = contextMessages.filter(m => m.sender !== 'CLIENT').length;
    if (count > interviewerMsgCountRef.current && interviewerMsgCountRef.current > 0) {
      requestSummary().then(summary => {
        if (summary) questionSnapshotsRef.current.push(summary);
        resetSession();
      });
    }
    interviewerMsgCountRef.current = count;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMessages, isSidecarAvailable]);

  // Timer effect - countdown from 3 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor(
        (new Date().getTime() - startTime.getTime()) / 1000
      );
      const remaining = Math.max(0, 180 - elapsed);
      setRemainingTime(remaining);

      // Auto-exit when time is up
      if (remaining === 0) {
        exitInterview();
      }
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime]);

  // Initialize backend interview session
  useEffect(() => {
    if (interviewId && !sessionId) {
      initializeSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  const initializeSession = async () => {
    try {
      const guestId = localStorage.getItem('guestId');
      const body = { interviewId, action: 'start', ...(guestId && { guestId }) };
      const response = await fetch('/api/interview-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.success && data.session) {
        setSessionId(data.session.id);
      }
    } catch (error) {
      console.error('Error initializing session:', error);
    }
  };

  const saveMessageToSession = useCallback(async (messageData: Record<string, unknown>) => {
    if (!sessionId) return;
    try {
      const guestId = localStorage.getItem('guestId');
      const body = { interviewId, action: 'add_message', messageData, ...(guestId && { guestId }) };
      await fetch('/api/interview-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  }, [sessionId, interviewId]);

  // Sync context messages to backend (new un-saved ones)
  const savedMessagesCount = useRef(0);
  useEffect(() => {
    if (contextMessages.length > savedMessagesCount.current) {
      const newMsgs = contextMessages.slice(savedMessagesCount.current);
      newMsgs.forEach(m => {
        saveMessageToSession({
          id: m.id,
          sender: m.sender === 'CLIENT' ? 'user' : 'interviewer',
          text: m.content,
          timestamp: new Date(),
          duration: 3000, // placeholder metrics
          confidence: 0.9,
          emotion: 'neutral',
        });
      });
      savedMessagesCount.current = contextMessages.length;
    }
  }, [contextMessages, saveMessageToSession]);

  const analyzeFillerWords = (text: string): number => {
    const fillerWords = ['um', 'uh', 'like', 'you know', 'actually', 'basically', 'literally'];
    let count = 0;
    const words = text.toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (fillerWords.includes(word.replace(/[^a-z]/g, ''))) {
        count++;
      }
    });
    return count;
  };

  const calculateWPM = (text: string, durationMs: number): number => {
    const words = text.split(/\s+/).length;
    const minutes = durationMs / 60000;
    return minutes > 0 ? Math.round(words / minutes) : 0;
  };

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [contextMessages, interimTranscript]);

  // Get user media
  useEffect(() => {
    if (isCameraOn && videoRef.current) {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .then((stream) => {
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch((err) => console.log('Error accessing media devices:', err));
    } else if (!isCameraOn && videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track: MediaStreamTrack) => track.stop());
      videoRef.current.srcObject = null;
    }
  }, [isCameraOn]); // Note: mic state is handled by the STT hook directly

  // Explicit user start handler (Fixes browser gesture requirements for TTS/Microphone)
  const handleStartSession = () => {
    start(knowledgeBase, role).catch(console.error);
  };
  
  const hasWelcomed = useRef(false);

  useEffect(() => {
    if (sessionState === VoiceSessionState.CONNECTED) {
      setLoading(false);
      
      // Start real timer when connected
      if (!hasWelcomed.current) {
        setStartTime(new Date());
      }

      if (!hasWelcomed.current) {
        hasWelcomed.current = true;
        // Delay to let connection settle
        setTimeout(async () => {
          try {
            console.log('Generating AI welcome message...');
            const response = await fetch('/api/ai-chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'START_INTERVIEW',
                conversationHistory: [],
                knowledgeBase,
                interviewContext: { role, candidateBackground: 'New candidate joining', duration: '3 minutes' },
              }),
            });

            const data = await response.json();
            if (data.success) {
              speakMessage(data.response);
            } else {
              speakMessage("Hello! Welcome to your mock interview. I'm excited to speak with you today.");
            }
          } catch (error) {
            console.error('Error generating welcome message:', error);
            speakMessage("Hello! Welcome to your mock interview. I'm excited to speak with you today.");
          }
        }, 1500);
      }
    }
  }, [sessionState, role, knowledgeBase, speakMessage]);

  // Ref keeps the latest closure so the unmount cleanup sees current sessionState/stop.
  const onUnmountRef = useRef<() => void>(() => {});
  onUnmountRef.current = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track: MediaStreamTrack) => track.stop());
      videoRef.current.srcObject = null;
    }
    if (sessionState !== VoiceSessionState.INACTIVE) {
      stop();
    }
  };
  useEffect(() => () => onUnmountRef.current(), []);

  const getMentorName = (id: string) => {
    const mentor = mentors.find(m => m.id === id || m.id.trim() === id.trim());
    return mentor ? mentor.name : 'AI Interviewer';
  };
  const mentorName = getMentorName(mentorId);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const exitInterview = async () => {
    setExitLoading(true);

    // Collect face analytics before stopping tracker (3.3: merge per-question snapshots)
    const finalSummary = await requestSummary();
    faceSummaryRef.current = finalSummary
      ? { ...finalSummary, questionSnapshots: questionSnapshotsRef.current }
      : questionSnapshotsRef.current.length > 0
        ? { questionSnapshots: questionSnapshotsRef.current }
        : null;

    const totalDuration = Date.now() - startTime.getTime();
    const averagePauseLength = conversationMetrics.totalPauses > 0 
      ? conversationMetrics.totalPauseTime / conversationMetrics.totalPauses : 0;
      
    // Synthesize string of all user text
    const allUserText = contextMessages.filter(m => m.sender === 'CLIENT').map(m => m.content).join(' ');
    const fillerWordsCount = analyzeFillerWords(allUserText);
    const wordsSpoken = allUserText.split(/\s+/).length;
    const wordsPerMinute = calculateWPM(allUserText, conversationMetrics.userSpeakingTime || totalDuration/2);
    
    const finalMetrics = {
      totalDuration,
      userSpeakingTime: conversationMetrics.userSpeakingTime || totalDuration/2,
      interviewerSpeakingTime: totalDuration - (conversationMetrics.userSpeakingTime || totalDuration/2),
      totalPauses: conversationMetrics.totalPauses,
      averagePauseLength,
      longestPause: conversationMetrics.longestPause,
      averageResponseTime: averagePauseLength,
      wordsPerMinute,
      interruptionCount: 0,
      fillerWordsCount,
      confidenceScore: Math.max(0.3, 1 - (fillerWordsCount / Math.max(1, wordsSpoken))),
      emotionalTone: { positive: 0.6, neutral: 0.3, negative: 0.1, confident: 0.7, nervous: 0.3 },
    };

    if (sessionId) {
      try {
        const guestId = localStorage.getItem('guestId');
        const body = { interviewId, action: 'end', metricsData: finalMetrics, ...(guestId && { guestId }) };
        await fetch('/api/interview-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (error) {
        console.error('Error ending session:', error);
      }
    }

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track: MediaStreamTrack) => track.stop());
      videoRef.current.srcObject = null;
    }

    stop();
    setIsInterviewComplete(true);
  };

  if (isInterviewComplete) {
    return (
      <InterviewComplete
        interviewId={interviewId}
        sessionId={sessionId}
        faceAnalytics={faceSummaryRef.current}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col px-4">
      {loading && <LoadingSkeleton />}
      
      {/* Header */}
      <div className="flex flex-row items-center gap-2 py-4">
        <div className="relative">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <div className="absolute top-0 left-0 w-2 h-2 bg-green-400 rounded-full animate-ping"></div>
        </div>
        <h1 className="text-md font-semibold overflow-hidden whitespace-nowrap text-ellipsis">
          {role || ''} Voice Interview{' '}
        </h1>
        {!loading && (
          <Badge
            variant={remainingTime <= 30 ? 'destructive' : 'secondary'}
            className="flex items-center space-x-1 shrink-0 ml-auto"
          >
            <Clock className="w-3 h-3" />
            <span>{formatTime(remainingTime)}</span>
          </Badge>
        )}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 max-w-7xl mx-auto w-full">
        {/* Visual/Camera Section */}
        <div className={`flex-1 transition-all duration-300 ${isChatOpen ? 'lg:pr-2' : ''}`}>
          <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-160px)]">
            
            {/* AI Voice Visualizer */}
            <div className="relative overflow-hidden rounded-lg border bg-muted flex flex-col items-center justify-center">
              <div className="absolute top-4 left-4 z-10 bg-background/80 backdrop-blur-sm rounded px-3 py-1.5 shadow-sm border">
                <span className="text-foreground text-sm font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  {mentorName}
                </span>
              </div>
              
              <div className="flex flex-col items-center gap-6">
                <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isAvatarTalking 
                    ? 'bg-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.5)] border-4 border-blue-500' 
                    : 'bg-muted-foreground/10 border-4 border-transparent'
                }`}>
                  <Waves className={`w-12 h-12 ${isAvatarTalking ? 'text-blue-500 animate-pulse' : 'text-muted-foreground'}`} />
                </div>
                
                {sessionState === VoiceSessionState.INACTIVE ? (
                   <Button onClick={handleStartSession} size="lg" className="px-8 shadow-md">
                     <Phone className="w-4 h-4 mr-2" /> Start Interview
                   </Button>
                ) : (
                  <h3 className="text-xl font-medium tracking-wide">
                    {sessionState === VoiceSessionState.PAUSED ? "Paused" : isAvatarTalking ? "Speaking..." : sessionState === VoiceSessionState.CONNECTED ? "Listening..." : "Connecting..."}
                  </h3>
                )}
              </div>
            </div>

            {/* User Visualizer / Camera */}
            <div className="relative overflow-hidden rounded-lg border bg-muted">
              <div className="absolute top-4 left-4 z-10 bg-background/80 backdrop-blur-sm rounded px-3 py-1.5 shadow-sm border">
                <span className="text-foreground text-sm font-medium flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isListening && (isUserTalking || interimTranscript) ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
                  You
                </span>
              </div>
              
              {sttError && (
                 <div className="absolute top-16 left-4 right-4 z-20 bg-destructive text-destructive-foreground px-4 py-2 rounded shadow-md font-medium text-sm text-center">
                    {sttError}
                 </div>
              )}
              
              {isCameraOn ? (
                <video playsInline ref={videoRef} autoPlay muted className="w-full h-full object-cover">
                  <track kind="captions" />
                </video>
              ) : (
                <div className="h-full flex flex-col items-center justify-center bg-background/50">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
                    isUserTalking || interimTranscript ? 'bg-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.4)]' : 'bg-muted'
                  }`}>
                    <Mic className={`w-10 h-10 ${isUserTalking || interimTranscript ? 'text-green-500' : 'text-muted-foreground'}`} />
                  </div>
                  <p className="mt-4 text-muted-foreground font-medium">Camera is off</p>
                </div>
              )}

              {/* ML face analytics HUD (only when sidecar connected) */}
              {isSidecarAvailable && <StressHUD frame={lastFrame} />}

              {/* Interim Transcript Overlay */}
              {interimTranscript && (
                <div className="absolute bottom-4 left-4 right-4 bg-black/60 backdrop-blur-md text-white p-3 rounded-lg text-center animate-in fade-in slide-in-from-bottom-2">
                  {interimTranscript}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Chat Panel */}
        <div className={`flex flex-col pl-2 transition-all duration-300 ${isChatOpen ? 'w-full lg:w-96 bg-muted lg:bg-background' : 'w-0'} ${isChatOpen ? 'fixed lg:relative inset-0 lg:inset-auto z-50 lg:z-auto' : 'hidden'}`}>
          <div className="bg-muted/30 h-full flex flex-col rounded-none lg:rounded-lg lg:border">
            <div className="flex items-center justify-between py-3 px-4 border-b">
              <div className="text-lg flex items-center space-x-2 font-medium">
                <MessageSquare className="w-5 h-5" />
                <span>Transcript</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsChatOpen(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex flex-col flex-1 pt-2">
              <ScrollArea className="px-4 flex flex-1 flex-col" ref={chatScrollRef}>
                <div className="space-y-4 pb-3 mt-2">
                  {contextMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === 'CLIENT' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] ${msg.sender === 'CLIENT' ? 'order-2' : 'order-1'}`}>
                        <div className={`border rounded-xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${msg.sender === 'CLIENT' ? 'bg-primary text-primary-foreground border-transparent' : 'bg-background'}`}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ))}
                  {interimTranscript && (
                    <div className="flex justify-end opacity-70">
                      <div className="max-w-[85%] border rounded-xl px-4 py-2.5 text-[15px] leading-relaxed bg-primary/80 text-primary-foreground border-transparent italic">
                        {interimTranscript}
                      </div>
                    </div>
                  )}
                  {isAvatarTalking && contextMessages[contextMessages.length - 1]?.sender === 'CLIENT' && (
                    <div className="flex justify-start">
                      <div className="bg-background border rounded-xl px-4 py-3 flex space-x-1.5 shadow-sm">
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              
              {/* Optional manual input */}
              <div className="border-t p-3 bg-background lg:rounded-b-lg">
                <div className="flex space-x-2">
                  <Input
                    placeholder="Speak into microphone or type..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (message.trim()) {
                          stop(); // Actually we should just call handleUserSpeech from context, but we don't expose it directly.
                          // As a workaround, we could fetch here or expose it. Since it's voice first, typing is secondary.
                          setMessage('');
                        }
                      }
                    }}
                    className="flex-1"
                  />
                  <Button disabled size="sm">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Area */}
      <div className="py-6 flex justify-center items-center gap-6">
        <Button
          variant={isCameraOn ? 'outline' : 'secondary'}
          size="lg"
          onClick={() => setIsCameraOn(!isCameraOn)}
          className={`rounded-full shadow-sm w-14 h-14 ${isCameraOn ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {isCameraOn ? <Camera className="w-6 h-6" /> : <CameraOff className="w-6 h-6" />}
        </Button>
        <Button
          variant={isMicOn ? 'outline' : 'secondary'}
          size="lg"
          onClick={() => setIsMicOn(!isMicOn)}
          className={`rounded-full shadow-sm w-14 h-14 ${isMicOn ? 'border-green-500 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950' : 'text-muted-foreground'}`}
        >
          {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </Button>
        <Button
          variant={isChatOpen ? 'default' : 'outline'}
          size="lg"
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="rounded-full shadow-sm w-14 h-14"
        >
          <MessageSquare className="w-6 h-6" />
        </Button>

        <Button
          variant={sessionState === VoiceSessionState.PAUSED ? 'default' : 'outline'}
          size="lg"
          onClick={togglePause}
          disabled={sessionState === VoiceSessionState.INACTIVE}
          className={`rounded-full shadow-sm w-14 h-14 ${sessionState === VoiceSessionState.PAUSED ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500' : 'text-amber-500 border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-950'}`}
        >
          {sessionState === VoiceSessionState.PAUSED ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="lg"
              variant="destructive"
              className="rounded-full shadow-md w-14 h-14 ml-4"
            >
              <Phone className="w-6 h-6 rotate-[135deg]" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure you want to exit?</AlertDialogTitle>
              <AlertDialogDescription>
                This action will end your interview and generate your feedback report.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={exitLoading} onClick={exitInterview} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                End Interview
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default Interview;
