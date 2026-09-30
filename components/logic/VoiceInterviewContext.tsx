"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export enum VoiceSessionState {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  PAUSED = "PAUSED",
}

export enum MessageSender {
  CLIENT = "CLIENT",
  AVATAR = "AVATAR",
}

export interface Message {
  id: string;
  sender: MessageSender;
  content: string;
  // Real speech timing (from recognized speech only — undefined for typed/AI messages, never
  // fabricated). durationMs: how long the candidate spoke. pauseBefore: how long they took to
  // start answering.
  durationMs?: number;
  pauseBefore?: number;
}

export interface MessageMeta {
  durationMs?: number;
  pauseBefore?: number;
}

interface VoiceInterviewContextProps {
  sessionState: VoiceSessionState;
  setSessionState: (s: VoiceSessionState) => void;
  isUserTalking: boolean;
  setIsUserTalking: (v: boolean) => void;
  isAvatarTalking: boolean;
  setIsAvatarTalking: (v: boolean) => void;
  isMuted: boolean;
  setIsMuted: (v: boolean) => void;
  messages: Message[];
  addMessage: (sender: MessageSender, content: string, meta?: MessageMeta) => void;
  // Restores a transcript (e.g. the server's copy after a page refresh).
  replaceMessages: (messages: Message[]) => void;
  clearMessages: () => void;
}

const VoiceInterviewContext = createContext<VoiceInterviewContextProps>({
  sessionState: VoiceSessionState.INACTIVE,
  setSessionState: () => {},
  isUserTalking: false,
  setIsUserTalking: () => {},
  isAvatarTalking: false,
  setIsAvatarTalking: () => {},
  isMuted: false,
  setIsMuted: () => {},
  messages: [],
  addMessage: () => {},
  replaceMessages: () => {},
  clearMessages: () => {},
});

// Date.now() ids collided when two messages landed in the same millisecond (duplicate React keys).
function newMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const VoiceInterviewProvider = ({ children }: { children: React.ReactNode }) => {
  const [sessionState, setSessionState] = useState(VoiceSessionState.INACTIVE);
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const addMessage = useCallback((sender: MessageSender, content: string, meta?: MessageMeta) => {
    setMessages((prev) => [...prev, { id: newMessageId(), sender, content, ...meta }]);
  }, []);

  const replaceMessages = useCallback((next: Message[]) => {
    setMessages(next);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <VoiceInterviewContext.Provider
      value={{
        sessionState,
        setSessionState,
        isUserTalking,
        setIsUserTalking,
        isAvatarTalking,
        setIsAvatarTalking,
        isMuted,
        setIsMuted,
        messages,
        addMessage,
        replaceMessages,
        clearMessages,
      }}
    >
      {children}
    </VoiceInterviewContext.Provider>
  );
};

export const useVoiceInterviewContext = () => useContext(VoiceInterviewContext);
