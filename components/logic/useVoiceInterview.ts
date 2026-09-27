"use client";

import { useCallback, useRef } from "react";
import { VoiceSessionState, MessageSender, useVoiceInterviewContext } from "./VoiceInterviewContext";
import { useSpeechToText } from "../../hooks/useSpeechToText";
import { useTextToSpeech } from "../../hooks/useTextToSpeech";
import { guestHeaders } from "@/lib/utils";

export const useVoiceInterview = () => {
  const {
    sessionState,
    setSessionState,
    setIsUserTalking,
    setIsAvatarTalking,
    addMessage,
    clearMessages,
    messages
  } = useVoiceInterviewContext();

  // The server (ai-chat) builds the prompt itself from interviewId — the client only
  // identifies which interview this is.
  const aiStateRef = useRef<{ interviewId: string, isProcessing: boolean, isPaused: boolean, isActive: boolean }>({ interviewId: "", isProcessing: false, isPaused: false, isActive: false });

  const handleUserSpeech = async (text: string) => {
    if (aiStateRef.current.isProcessing) return;
    
    if (text !== "[USER_PAUSED]") {
      addMessage(MessageSender.CLIENT, text);
    }
    stopListening();
    
    aiStateRef.current.isProcessing = true;
    
    try {
       // Convert UI messages to AI conversation history format
       const history = messages.map(m => ({
          sender: m.sender === MessageSender.CLIENT ? 'User' : 'Interviewer',
          text: m.content
       }));

       const response = await fetch('/api/ai-chat', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', ...guestHeaders() },
         body: JSON.stringify({
            interviewId: aiStateRef.current.interviewId,
            message: text,
            conversationHistory: history,
         })
       });
       
       const data = await response.json();
       if (data.success) {
          await speakMessage(data.response);
       } else {
          console.error("AI chat error", data.error);
          await speakMessage("I'm sorry, I encountered an issue. Could you repeat that?");
       }
    } catch (err) {
       console.error("AI chat error", err);
       await speakMessage("I'm sorry, I encountered an issue. Could you repeat that?");
    } finally {
       aiStateRef.current.isProcessing = false;
    }
  };

  const { startListening, stopListening, interimTranscript, isSupported: isSttSupported, error: sttError, isListening } = useSpeechToText({
    silenceTimeoutMs: 3000,
    onSilenceTimeout: (finalText) => {
      // User finished speaking a chunk or stayed silent for 5 seconds
      if (!finalText.trim()) {
        if (!aiStateRef.current.isProcessing && !aiStateRef.current.isPaused && sessionState === VoiceSessionState.CONNECTED) {
          handleUserSpeech("[USER_PAUSED]");
        } else if (!aiStateRef.current.isProcessing && !aiStateRef.current.isPaused && aiStateRef.current.isActive) {
          startListening();
        }
        return;
      }
      setIsUserTalking(false);
      handleUserSpeech(finalText);
    }
  });

  const togglePause = useCallback(() => {
    if (sessionState === VoiceSessionState.PAUSED) {
      setSessionState(VoiceSessionState.CONNECTED);
      aiStateRef.current.isPaused = false;
      startListening();
    } else if (sessionState === VoiceSessionState.CONNECTED) {
      setSessionState(VoiceSessionState.PAUSED);
      aiStateRef.current.isPaused = true;
      stopListening();
    }
  }, [sessionState, setSessionState, startListening, stopListening]);

  const { speak, stop: stopTts, isSupported: isTtsSupported } = useTextToSpeech();

  const start = useCallback(
    async (interviewId: string) => {
      if (!isSttSupported || !isTtsSupported) {
        console.error("Speech APIs not supported in this browser");
        // We'll let the user continue but voice won't work well
      }
      aiStateRef.current.interviewId = interviewId;
      aiStateRef.current.isActive = true;
      
      setSessionState(VoiceSessionState.CONNECTING);
      
      // Simulate brief connection setup
      setTimeout(() => {
        setSessionState(VoiceSessionState.CONNECTED);
      }, 500);
    },
    [isSttSupported, isTtsSupported, setSessionState]
  );

  const stop = useCallback(() => {
    aiStateRef.current.isActive = false;
    stopListening();
    stopTts();
    setSessionState(VoiceSessionState.INACTIVE);
    clearMessages();
  }, [stopListening, stopTts, setSessionState, clearMessages]);

  const speakMessage = useCallback(async (text: string) => {
    setIsAvatarTalking(true);
    addMessage(MessageSender.AVATAR, text);
    stopListening(); // Pause mic while AI speaks
    
    try {
      await speak(text);
    } catch (e) {
      console.warn("TTS Error", e);
    } finally {
      setIsAvatarTalking(false);
      // Restart listening for user response!
      setTimeout(() => {
        if (aiStateRef.current.isActive) {
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
    togglePause,
    interimTranscript,
    sttError,
    isListening,
  };
};
