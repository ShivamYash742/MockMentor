"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceSessionState, MessageSender, useVoiceInterviewContext, type MessageMeta } from "./VoiceInterviewContext";
import { useSpeechToText, type SpeechTimingMeta } from "../../hooks/useSpeechToText";
import { useTextToSpeech } from "../../hooks/useTextToSpeech";
import { guestHeaders } from "@/lib/utils";

export const USER_PAUSED = "[USER_PAUSED]";
// How many times in a row the interviewer checks in on a silent candidate before it just waits.
const MAX_CONSECUTIVE_NUDGES = 2;
const APOLOGY = "I'm sorry, I encountered an issue. Could you repeat that?";

export const useVoiceInterview = () => {
  const {
    sessionState,
    setSessionState,
    setIsUserTalking,
    setIsAvatarTalking,
    isMuted,
    setIsMuted,
    addMessage,
    clearMessages,
  } = useVoiceInterviewContext();

  // Read by the STT/TTS callbacks, which can outlive the render that created them, so this is a
  // ref rather than state. The server (ai-chat) builds the prompt and keeps the transcript itself;
  // the client only says which interview this is.
  const aiStateRef = useRef({
    interviewId: "",
    isProcessing: false,
    isPaused: false,
    isActive: false,
    isMuted: false,
    nudges: 0,
  });
  // Mirrors isProcessing for the UI: true from sending an answer until the reply has been spoken.
  const [isAwaitingReply, setIsAwaitingReply] = useState(false);
  // Why the interviewer stopped replying (time or message limit), shown as a banner.
  const [notice, setNotice] = useState<string | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setProcessing = (value: boolean) => {
    aiStateRef.current.isProcessing = value;
    setIsAwaitingReply(value);
  };

  // Returns false if the answer wasn't accepted (a reply is still in progress, or the interview
  // is over), so callers can keep a typed answer instead of silently dropping it.
  const handleUserSpeech = async (text: string, meta?: MessageMeta): Promise<boolean> => {
    const state = aiStateRef.current;
    if (state.isProcessing || !state.isActive) return false;

    const isNudge = text === USER_PAUSED;
    if (!isNudge) {
      state.nudges = 0;
      addMessage(MessageSender.CLIENT, text, meta);
    }
    stopListening();
    setProcessing(true);

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...guestHeaders() },
        body: JSON.stringify({
          interviewId: state.interviewId,
          message: text,
          ...(meta ? { timing: meta } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));

      // The interview ended while we were waiting: a late reply must not be spoken over the
      // "complete" screen.
      if (!aiStateRef.current.isActive) return true;

      if (data.success) {
        await speakMessage(data.response);
      } else if (data.error === 'inactive' || data.error === 'message_limit') {
        setNotice(
          data.error === 'inactive'
            ? "Time's up for this interview. End it to generate your report."
            : "This interview has reached its message limit. End it to generate your report."
        );
      } else {
        console.error("AI chat error", data.error);
        await speakMessage(APOLOGY);
      }
    } catch (err) {
      console.error("AI chat error", err);
      if (aiStateRef.current.isActive) await speakMessage(APOLOGY);
    } finally {
      setProcessing(false);
    }
    return true;
  };

  // Typed answers go through the exact same pipeline as recognized speech (the Send button
  // and Enter key in the transcript box).
  const sendText = (text: string): boolean => {
    const trimmed = text.trim();
    const state = aiStateRef.current;
    if (!trimmed || state.isProcessing || !state.isActive) return false;
    setIsUserTalking(false);
    void handleUserSpeech(trimmed);
    return true;
  };

  const { startListening, stopListening, interimTranscript, isSupported: isSttSupported, error: sttError, isListening } = useSpeechToText({
    silenceTimeoutMs: 3000,
    onSilenceTimeout: (finalText, meta: SpeechTimingMeta) => {
      const state = aiStateRef.current;
      // Empty finalText means total silence (nothing was said at all); otherwise the user
      // spoke and then paused, so finalText is their completed answer.
      if (!finalText.trim()) {
        if (state.isProcessing || state.isPaused || !state.isActive) return;
        // Check in at most twice in a row; after that, just keep listening quietly.
        if (sessionState === VoiceSessionState.CONNECTED && state.nudges < MAX_CONSECUTIVE_NUDGES) {
          state.nudges += 1;
          void handleUserSpeech(USER_PAUSED);
        }
        return;
      }
      setIsUserTalking(false);
      void handleUserSpeech(finalText, meta);
    }
  });

  const togglePause = useCallback(() => {
    const state = aiStateRef.current;
    if (sessionState === VoiceSessionState.PAUSED) {
      setSessionState(VoiceSessionState.CONNECTED);
      state.isPaused = false;
      // While a reply is in progress, speakMessage restarts listening once it's done.
      if (!state.isMuted && !state.isProcessing) startListening();
    } else if (sessionState === VoiceSessionState.CONNECTED) {
      setSessionState(VoiceSessionState.PAUSED);
      state.isPaused = true;
      stopListening();
    }
  }, [sessionState, setSessionState, startListening, stopListening]);

  // The mic button: mute stops listening immediately and stays stopped (every restart path
  // checks isMuted); unmute resumes listening if we're in a state that should be listening now.
  const setMuted = useCallback((muted: boolean) => {
    const state = aiStateRef.current;
    state.isMuted = muted;
    setIsMuted(muted);
    if (muted) {
      stopListening();
    } else if (!state.isProcessing && !state.isPaused && state.isActive) {
      startListening();
    }
  }, [setIsMuted, startListening, stopListening]);

  const { speak, stop: stopTts, isSupported: isTtsSupported } = useTextToSpeech();

  const start = useCallback(
    async (interviewId: string) => {
      if (!isSttSupported || !isTtsSupported) {
        console.warn("Speech APIs not supported in this browser; typed answers still work.");
      }
      Object.assign(aiStateRef.current, { interviewId, isActive: true, isPaused: false, nudges: 0 });
      setNotice(null);
      setSessionState(VoiceSessionState.CONNECTING);

      // Simulate brief connection setup
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      connectTimerRef.current = setTimeout(() => {
        if (aiStateRef.current.isActive) setSessionState(VoiceSessionState.CONNECTED);
      }, 500);
    },
    [isSttSupported, isTtsSupported, setSessionState]
  );

  const stop = useCallback(() => {
    Object.assign(aiStateRef.current, { isActive: false, isPaused: false });
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    stopListening();
    stopTts();
    setIsAvatarTalking(false);
    setSessionState(VoiceSessionState.INACTIVE);
    clearMessages();
  }, [stopListening, stopTts, setIsAvatarTalking, setSessionState, clearMessages]);

  useEffect(() => () => {
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
  }, []);

  // addToTranscript: false re-speaks a message that's already in the transcript (the last
  // question, after a page refresh).
  const speakMessage = useCallback(async (text: string, opts?: { addToTranscript?: boolean }) => {
    if (!aiStateRef.current.isActive) return;
    setIsAvatarTalking(true);
    if (opts?.addToTranscript !== false) addMessage(MessageSender.AVATAR, text);
    stopListening(); // Pause mic while AI speaks

    try {
      await speak(text);
    } catch (e) {
      console.warn("TTS Error", e);
    } finally {
      setIsAvatarTalking(false);
      // Hand the turn back to the candidate — unless they muted, paused, or already answered
      // by typing while this was being spoken.
      setTimeout(() => {
        const state = aiStateRef.current;
        if (state.isActive && !state.isMuted && !state.isPaused && !state.isProcessing) {
          setIsUserTalking(true);
          startListening();
        }
      }, 200);
    }
  }, [speak, setIsAvatarTalking, addMessage, stopListening, startListening, setIsUserTalking]);

  return {
    sessionState,
    start,
    stop,
    speakMessage,
    sendText,
    togglePause,
    isMuted,
    setMuted,
    isAwaitingReply,
    notice,
    isSttSupported,
    interimTranscript,
    sttError,
    isListening,
  };
};
