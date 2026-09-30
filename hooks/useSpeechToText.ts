"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createAnswerAccumulator, type SpeechResultList } from "@/lib/speechAnswer";

// Add TypeScript definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null;
  onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
}

interface SpeechRecognitionConstructor {
    new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor | undefined;
    webkitSpeechRecognition: SpeechRecognitionConstructor | undefined;
  }
}

// Basic type definitions for Web Speech API
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

export interface SpeechTimingMeta {
  durationMs: number;
  pauseBefore: number;
}

export const useSpeechToText = (options?: {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onSilenceTimeout?: (finalTranscript: string, meta: SpeechTimingMeta) => void;
  silenceTimeoutMs?: number;
  totalSilenceTimeoutMs?: number;
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Separate from silenceTimeoutRef above: that one fires after the user has said SOMETHING
  // and paused. This one fires when nothing was heard at all since listening started — the
  // "you've gone completely silent" case, which onresult's timer can never catch because
  // onresult never runs if there's no speech to recognize.
  const totalSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasHeardSpeechRef = useRef(false);
  // Real timing for the current listening turn, used to report durationMs/pauseBefore instead
  // of the fixed placeholders the app used to save with every message.
  const listenStartRef = useRef(0);
  const speechStartRef = useRef<number | null>(null);
  // The answer being spoken. Read synchronously by the silence timer, so it never lags a render
  // behind the way the old transcript-state-mirrored-into-a-ref did.
  const answerRef = useRef(createAnswerAccumulator());
  const isIntentionallyStopped = useRef(false);
  // True between startListening() and the recognizer's next onstart. The browser also restarts
  // recognition on its own (Chrome ends it after ~8s of silence); those restarts must not reset
  // the silence watchdog or the answer's timing, or the "you've gone quiet" nudge never fires.
  const newTurnRef = useRef(false);

  const lang = options?.lang || "en-US";
  const continuous = options?.continuous ?? true;
  const interimResults = options?.interimResults ?? true;
  const silenceTimeoutMs = options?.silenceTimeoutMs || 3000;
  const totalSilenceTimeoutMs = options?.totalSilenceTimeoutMs || 10000;
  
  // Store the callback in a ref so it doesn't cause re-initialization
  const onSilenceTimeoutRef = useRef(options?.onSilenceTimeout);
  
  useEffect(() => {
    onSilenceTimeoutRef.current = options?.onSilenceTimeout;
  }, [options?.onSilenceTimeout]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      if (!newTurnRef.current) return; // an automatic restart within the same turn
      newTurnRef.current = false;

      // Arm the "total silence" watchdog for this listening turn, and start the clock for
      // real pauseBefore/durationMs timing.
      hasHeardSpeechRef.current = false;
      listenStartRef.current = Date.now();
      speechStartRef.current = null;
      if (totalSilenceTimerRef.current) clearTimeout(totalSilenceTimerRef.current);
      if (onSilenceTimeoutRef.current) {
        totalSilenceTimerRef.current = setTimeout(() => {
          if (!hasHeardSpeechRef.current && onSilenceTimeoutRef.current) {
            onSilenceTimeoutRef.current("", { durationMs: 0, pauseBefore: totalSilenceTimeoutMs });
          }
        }, totalSilenceTimeoutMs);
      }
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // After stopListening() the recognizer may still deliver a final result for audio it had
      // buffered. That answer was already handed off (interim text included), so drop it.
      if (isIntentionallyStopped.current) return;

      // Any result — interim or final — means the user isn't silent; disarm the watchdog above.
      if (!hasHeardSpeechRef.current) {
        hasHeardSpeechRef.current = true;
        speechStartRef.current = Date.now();
      }
      if (totalSilenceTimerRef.current) {
        clearTimeout(totalSilenceTimerRef.current);
        totalSilenceTimerRef.current = null;
      }

      const answer = answerRef.current;
      answer.push(event.resultIndex, event.results);
      setTranscript(answer.finalText);
      setInterimTranscript(answer.interim);

      // Silence detection: the answer is complete once no new result arrives for silenceTimeoutMs.
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }

      if (onSilenceTimeoutRef.current) {
        silenceTimeoutRef.current = setTimeout(() => {
          const text = answerRef.current.answer();
          if (text && onSilenceTimeoutRef.current) {
            const pauseBefore = speechStartRef.current !== null ? speechStartRef.current - listenStartRef.current : 0;
            // Speaking duration excludes the trailing silenceTimeoutMs spent confirming they'd finished.
            const durationMs = speechStartRef.current !== null
              ? Math.max(0, (Date.now() - silenceTimeoutMs) - speechStartRef.current)
              : 0;
            onSilenceTimeoutRef.current(text, { durationMs, pauseBefore });
          }
        }, silenceTimeoutMs);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') {
        // 'aborted' is expected when we call stop() manually - not an error
        setIsListening(false);
        return;
      }
      
      if (event.error === 'no-speech') {
        // 'no-speech' happens automatically during silence. Don't throw a scary UI error.
        setIsListening(false);
        return;
      }
      
      // Log actual errors
      console.error('Speech recognition error:', event.error, event);
      
      if (event.error === 'not-allowed') {
        setError("Microphone access denied. Please enable it in your browser settings.");
      } else if (event.error === 'audio-capture') {
        setError("No microphone found or microphone not working. Please check your device.");
      } else if (event.error === 'network') {
        setError("Network error. Speech recognition requires internet connection.");
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      
      // Only auto-restart if:
      // 1. We didn't intentionally stop it
      // 2. Continuous mode is enabled
      // 3. We're not in the middle of cleanup
      if (!isIntentionallyStopped.current && continuous) {
        // Add a small delay to prevent rapid restart loops
        setTimeout(() => {
          if (!isIntentionallyStopped.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {
              console.warn('Could not auto-restart:', e);
            }
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        isIntentionallyStopped.current = true;
        recognitionRef.current.abort();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (totalSilenceTimerRef.current) {
        clearTimeout(totalSilenceTimerRef.current);
      }
    };
  }, [lang, continuous, interimResults, silenceTimeoutMs, totalSilenceTimeoutMs]); // Removed onSilenceTimeout from deps

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }
    
    
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    answerRef.current.reset();
    isIntentionallyStopped.current = false;
    newTurnRef.current = true;
    
    // Check microphone permissions first
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((result) => {
        if (result.state === 'denied') {
          setError("Microphone permission denied. Please allow microphone access in browser settings.");
        }
      }).catch((err) => {
        console.warn('Could not check microphone permission:', err);
      });
    }
    
    // Use a small delay to ensure state is clean
    setTimeout(() => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.start();
        } else {
          console.error('❌ recognitionRef.current is null!');
          setError('Speech recognition not initialized');
        }
      } catch (e: unknown) {
        if (e instanceof Error) {
          console.error('❌ Error calling start():', e.name, e.message);
          if (e.name === 'InvalidStateError') {
            // Already running, try to stop and restart
            try {
              recognitionRef.current?.stop();
              setTimeout(() => {
                try {
                  recognitionRef.current?.start();
                } catch (err2) {
                  console.error('Failed to restart:', err2);
                }
              }, 200);
            } catch (stopErr) {
              console.error('Failed to stop:', stopErr);
            }
          } else {
            setError(`Failed to start: ${e.message}`);
          }
        }
      }
    }, 50);
  }, [isSupported]);

  const stopListening = useCallback(() => {
    if (!isSupported) return;


    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (totalSilenceTimerRef.current) {
      clearTimeout(totalSilenceTimerRef.current);
    }
    isIntentionallyStopped.current = true;
    setInterimTranscript("");

    try {
      recognitionRef.current?.stop();
    } catch (e) {
      console.warn("Could not stop recognition:", e);
    }
  }, [isSupported]);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    answerRef.current.reset();
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    startListening,
    stopListening,
    clearTranscript,
  };
};
