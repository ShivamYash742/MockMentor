'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { MessageSender, VoiceSessionState } from './logic';
import { useVoiceInterview, useVoiceInterviewContext } from './logic';
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
import { getMentorById } from '@/lib/mentors';
import InterviewComplete from './interview-complete';
import { useFaceTracker } from '@/hooks/useFaceTracker';
import { StressHUD } from '@/components/interview/StressHUD';
import type { FaceSummary } from '@/lib/mlSidecar';
import { appConfig } from '@/lib/appConfig';
import { guestHeaders } from '@/lib/utils';
import { START_INTERVIEW } from '@/lib/chatProtocol';

const FALLBACK_WELCOME = "Hello! Welcome to your mock interview. I'm excited to speak with you today.";

type SavedMessage = { id: string; sender: 'user' | 'interviewer'; text: string; duration?: number; pauseBefore?: number };

const Interview = ({
  interviewId,
  role,
  mentorId,
}: {
  interviewId: string;
  role: string;
  mentorId: string;
}) => {
  const {
    sessionState, start, stop, speakMessage, sendText, interimTranscript, sttError, isListening,
    togglePause, isMuted, setMuted, isAwaitingReply, notice, isSttSupported,
  } = useVoiceInterview();
  const { isUserTalking, isAvatarTalking, messages: contextMessages, replaceMessages } = useVoiceInterviewContext();

  const [isCameraOn, setIsCameraOn] = useState(true);
  const [starting, setStarting] = useState(false);
  const [exitLoading, setExitLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [gazeAlertVisible, setGazeAlertVisible] = useState(false);

  // Timer state: startTime comes from the server session, so a refresh keeps the clock.
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [remainingTime, setRemainingTime] = useState(appConfig.interviewDurationSec);
  const exitingRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatViewportRef = useRef<HTMLDivElement>(null);
  const faceSummaryRef = useRef<object | null>(null);
  const questionSnapshotsRef = useRef<FaceSummary[]>([]);
  const gazeOffTimeRef = useRef<number | null>(null);
  const alertCooldownRef = useRef<number>(0);
  const interviewerMsgCountRef = useRef(0);
  const gazeBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { lastFrame, isConnected: isTracking, requestSummary, resetSession } = useFaceTracker(
    videoRef,
    isCameraOn && !isInterviewComplete,
  );

  // 3.5 — Attention alert: if gaze leaves screen for 3s, show an on-screen banner (10s cooldown).
  // Not spoken: speechSynthesis audio was being picked up by the mic and recorded as if the
  // candidate had said it.
  useEffect(() => {
    if (!isTracking || !lastFrame?.face_detected) return;
    const now = Date.now();
    if (!lastFrame.gaze?.looking_at_screen) {
      if (!gazeOffTimeRef.current) gazeOffTimeRef.current = now;
      else if (
        now - gazeOffTimeRef.current >= 3000 &&
        now - alertCooldownRef.current >= 10000
      ) {
        alertCooldownRef.current = now;
        gazeOffTimeRef.current = null;
        setGazeAlertVisible(true);
        if (gazeBannerTimerRef.current) clearTimeout(gazeBannerTimerRef.current);
        gazeBannerTimerRef.current = setTimeout(() => setGazeAlertVisible(false), 4000);
      }
    } else {
      gazeOffTimeRef.current = null;
    }
  }, [lastFrame, isTracking]);

  // 3.3 — Per-question emotion snapshot: on each new interviewer message (after the first),
  //        snapshot the current ML session aggregate, then reset for the next question.
  useEffect(() => {
    const count = contextMessages.filter(m => m.sender !== 'CLIENT').length;
    if (isTracking && count > interviewerMsgCountRef.current && interviewerMsgCountRef.current > 0) {
      requestSummary().then(summary => {
        if (summary) questionSnapshotsRef.current.push(summary);
        resetSession();
      });
    }
    interviewerMsgCountRef.current = count;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMessages, isTracking]);

  // Countdown runs once the session has started
  useEffect(() => {
    if (!startTime || isInterviewComplete) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
      setRemainingTime(Math.max(0, appConfig.interviewDurationSec - elapsed));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime, isInterviewComplete]);

  // Auto-exit when time is up (a separate effect so exitInterview sees current state)
  useEffect(() => {
    if (startTime && remainingTime === 0) exitInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, remainingTime]);

  // Auto-scroll the transcript. The ref is the ScrollArea's viewport — the element that scrolls;
  // setting scrollTop on the ScrollArea root did nothing.
  useEffect(() => {
    const viewport = chatViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [contextMessages, interimTranscript, isChatOpen]);

  // Camera. The stream is kept in its own ref: turning the camera off unmounts the <video>
  // before this cleanup runs, so going through videoRef (as this used to) never stopped the
  // tracks and the camera stayed on.
  useEffect(() => {
    if (!isCameraOn || isInterviewComplete) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not available in this browser. You can continue with it off.');
      setIsCameraOn(false);
      return;
    }
    let cancelled = false;
    const video = videoRef.current; // rendered whenever the camera is on
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (video) video.srcObject = stream;
        setCameraError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error accessing media devices:', err);
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera access denied. Please enable it in your browser settings.'
            : 'Could not access the camera. You can continue with it off.'
        );
        setIsCameraOn(false);
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [isCameraOn, isInterviewComplete]); // Note: mic state is handled by the STT hook directly

  // Explicit user start handler (Fixes browser gesture requirements for TTS/Microphone).
  // The server session is created (or, after a refresh, reused) first. A refresh also gets the
  // transcript so far back, so the interview picks up where it left off.
  const handleStartSession = async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch('/api/interview-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...guestHeaders() },
        body: JSON.stringify({ interviewId, action: 'start' }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Could not start the interview');
      setSessionId(data.session.id);
      setStartTime(new Date(data.session.startTime));
      const saved: SavedMessage[] = data.session.messages ?? [];
      if (saved.length > 0) {
        replaceMessages(saved.map((m) => ({
          id: m.id,
          sender: m.sender === 'user' ? MessageSender.CLIENT : MessageSender.AVATAR,
          content: m.text,
          durationMs: m.duration,
          pauseBefore: m.pauseBefore,
        })));
      }
    } catch (error) {
      console.error('Error starting session:', error);
      setStartError(error instanceof Error ? error.message : 'Could not start the interview');
      setStarting(false);
      return;
    }
    // Without speech recognition (e.g. Firefox), typing is the only way to answer.
    if (!isSttSupported) setIsChatOpen(true);
    start(interviewId).catch(console.error);
    setStarting(false);
  };

  const hasWelcomed = useRef(false);

  useEffect(() => {
    if (sessionState !== VoiceSessionState.CONNECTED) return;
    if (hasWelcomed.current) return;
    hasWelcomed.current = true;
    // Delay to let connection settle. Not cleared when deps change (that would cancel the
    // welcome); cleared on unmount below.
    welcomeTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...guestHeaders() },
          body: JSON.stringify({ interviewId, message: START_INTERVIEW }),
        });
        const data = await response.json();
        if (data.success) {
          // resumed: the last question is already in the restored transcript — just repeat it.
          await speakMessage(data.response, { addToTranscript: !data.resumed });
          return;
        }
      } catch (error) {
        console.error('Error generating welcome message:', error);
      }
      speakMessage(FALLBACK_WELCOME);
    }, 1500);
  }, [sessionState, interviewId, speakMessage]);

  // Ref keeps the latest closure so the unmount cleanup sees current sessionState/stop.
  // The camera is released by its own effect's cleanup.
  const onUnmountRef = useRef<() => void>(() => {});
  onUnmountRef.current = () => {
    if (sessionState !== VoiceSessionState.INACTIVE) stop();
  };
  useEffect(() => {
    const timers = { gaze: gazeBannerTimerRef, welcome: welcomeTimerRef };
    return () => {
      onUnmountRef.current();
      if (timers.gaze.current) clearTimeout(timers.gaze.current);
      if (timers.welcome.current) clearTimeout(timers.welcome.current);
    };
  }, []);

  const mentorName = getMentorById(mentorId)?.name ?? 'AI Interviewer';

  const formatTime = (seconds: number) => {
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Typed answers reuse the same pipeline as recognized speech — also the only way to
  // answer in a browser without SpeechRecognition support (e.g. Firefox). The text is only
  // cleared once it's been accepted, so nothing typed is lost while the interviewer is replying.
  const handleSendText = () => {
    if (!message.trim() || sessionState !== VoiceSessionState.CONNECTED) return;
    if (sendText(message)) setMessage('');
  };

  const exitInterview = async () => {
    if (exitingRef.current) return; // timer and End button can both fire
    exitingRef.current = true;
    setExitLoading(true);

    // Silence the interviewer and the mic right away, not after the network calls below.
    stop();

    // Collect face analytics before stopping tracker (3.3: merge per-question snapshots)
    const finalSummary = await requestSummary();
    faceSummaryRef.current = finalSummary
      ? { ...finalSummary, questionSnapshots: questionSnapshotsRef.current }
      : questionSnapshotsRef.current.length > 0
        ? { questionSnapshots: questionSnapshotsRef.current }
        : null;

    // Metrics are computed on the server from its own transcript; the camera summary is stored
    // with the session so a report generated later still has it.
    if (sessionId) {
      try {
        await fetch('/api/interview-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...guestHeaders() },
          body: JSON.stringify({ interviewId, action: 'end', faceAnalytics: faceSummaryRef.current }),
        });
      } catch (error) {
        console.error('Error ending session:', error);
      }
    }

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
      {/* Header */}
      <div className="flex flex-row items-center gap-2 py-4">
        <div className="relative">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <div className="absolute top-0 left-0 w-2 h-2 bg-green-400 rounded-full animate-ping"></div>
        </div>
        <h1 className="text-md font-semibold overflow-hidden whitespace-nowrap text-ellipsis">
          {role || ''} Voice Interview{' '}
        </h1>
        {startTime && (
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
                
                {exitLoading ? (
                  <h3 className="text-xl font-medium tracking-wide">Ending interview...</h3>
                ) : sessionState === VoiceSessionState.INACTIVE ? (
                  <>
                    <Button onClick={handleStartSession} disabled={starting} size="lg" className="px-8 shadow-md">
                      <Phone className="w-4 h-4 mr-2" /> {starting ? 'Starting...' : 'Start Interview'}
                    </Button>
                    {startError && <p role="alert" className="text-sm text-destructive">{startError}</p>}
                  </>
                ) : (
                  <h3 className="text-xl font-medium tracking-wide" aria-live="polite">
                    {sessionState === VoiceSessionState.PAUSED
                      ? "Paused"
                      : isAvatarTalking
                        ? "Speaking..."
                        : isAwaitingReply
                          ? "Thinking..."
                          : sessionState === VoiceSessionState.CONNECTED
                            ? isMuted ? "Mic muted" : "Listening..."
                            : "Connecting..."}
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
              
              {(sttError || cameraError || gazeAlertVisible || notice || sessionState === VoiceSessionState.PAUSED) && (
                <div className="absolute top-16 left-4 right-4 z-20 flex flex-col gap-2" role="status">
                  {notice && (
                    <div className="bg-destructive text-destructive-foreground px-4 py-2 rounded shadow-md font-medium text-sm text-center">
                      {notice}
                    </div>
                  )}
                  {sessionState === VoiceSessionState.PAUSED && (
                    <div className="bg-amber-500 text-white px-4 py-2 rounded shadow-md font-medium text-sm text-center">
                      Paused. The interview clock keeps running.
                    </div>
                  )}
                  {sttError && (
                    <div className="bg-destructive text-destructive-foreground px-4 py-2 rounded shadow-md font-medium text-sm text-center">
                      {sttError}
                    </div>
                  )}
                  {cameraError && (
                    <div className="bg-destructive text-destructive-foreground px-4 py-2 rounded shadow-md font-medium text-sm text-center">
                      {cameraError}
                    </div>
                  )}
                  {gazeAlertVisible && (
                    <div className="bg-amber-500 text-white px-4 py-2 rounded shadow-md font-medium text-sm text-center">
                      Please look at the camera
                    </div>
                  )}
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

              {/* Face analytics HUD, only while the camera is on and tracking */}
              {isCameraOn && isTracking && <StressHUD frame={lastFrame} />}

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
        {/* Bounded height (full screen on mobile, the camera row's height on desktop) with a
            min-h-0 chain, so a long transcript scrolls inside the panel instead of pushing the
            answer box off-screen. */}
        <div className={`flex flex-col pl-2 transition-all duration-300 ${isChatOpen ? 'w-full lg:w-96 bg-muted lg:bg-background' : 'w-0'} ${isChatOpen ? 'fixed lg:relative inset-0 lg:inset-auto z-50 lg:z-auto lg:h-[calc(100vh-160px)]' : 'hidden'}`}>
          <div className="bg-muted/30 h-full min-h-0 flex flex-col rounded-none lg:rounded-lg lg:border">
            <div className="flex items-center justify-between py-3 px-4 border-b">
              <div className="text-lg flex items-center space-x-2 font-medium">
                <MessageSquare className="w-5 h-5" />
                <span>Transcript</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsChatOpen(false)} aria-label="Close transcript">
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex flex-col flex-1 min-h-0 pt-2">
              <ScrollArea className="px-4 flex-1 min-h-0" viewportRef={chatViewportRef}>
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
                  {isAwaitingReply && !isAvatarTalking && contextMessages[contextMessages.length - 1]?.sender === 'CLIENT' && (
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
                    aria-label="Type your answer"
                    placeholder={isAwaitingReply ? 'Wait for the interviewer to finish...' : 'Speak into microphone or type...'}
                    maxLength={2000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendText();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={handleSendText}
                    disabled={!message.trim() || sessionState !== VoiceSessionState.CONNECTED || isAwaitingReply}
                    aria-label="Send answer"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Area */}
      <div className="py-6 flex justify-center items-center gap-3 sm:gap-6">
        <Button
          variant={isCameraOn ? 'outline' : 'secondary'}
          size="lg"
          onClick={() => setIsCameraOn(!isCameraOn)}
          aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
          aria-pressed={isCameraOn}
          className={`rounded-full shadow-sm w-14 h-14 ${isCameraOn ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {isCameraOn ? <Camera className="w-6 h-6" /> : <CameraOff className="w-6 h-6" />}
        </Button>
        <Button
          variant={!isMuted ? 'outline' : 'secondary'}
          size="lg"
          onClick={() => setMuted(!isMuted)}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={isMuted}
          className={`rounded-full shadow-sm w-14 h-14 ${!isMuted ? 'border-green-500 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950' : 'text-muted-foreground'}`}
        >
          {!isMuted ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </Button>
        <Button
          variant={isChatOpen ? 'default' : 'outline'}
          size="lg"
          onClick={() => setIsChatOpen(!isChatOpen)}
          aria-label={isChatOpen ? 'Hide transcript' : 'Show transcript'}
          aria-pressed={isChatOpen}
          className="rounded-full shadow-sm w-14 h-14"
        >
          <MessageSquare className="w-6 h-6" />
        </Button>

        <Button
          variant={sessionState === VoiceSessionState.PAUSED ? 'default' : 'outline'}
          size="lg"
          onClick={togglePause}
          disabled={sessionState === VoiceSessionState.INACTIVE}
          aria-label={sessionState === VoiceSessionState.PAUSED ? 'Resume interview' : 'Pause interview'}
          className={`rounded-full shadow-sm w-14 h-14 ${sessionState === VoiceSessionState.PAUSED ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500' : 'text-amber-500 border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-950'}`}
        >
          {sessionState === VoiceSessionState.PAUSED ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="lg"
              variant="destructive"
              aria-label="End interview"
              disabled={!sessionId || exitLoading}
              className="rounded-full shadow-md w-14 h-14 ml-2 sm:ml-4"
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
