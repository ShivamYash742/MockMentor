"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
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
  const transcriptRef = useRef(""); // Keep track in a ref for the timeout closure
  const isIntentionallyStopped = useRef(false);

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
    transcriptRef.current = transcript;
  }, [transcript]);

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
      // Any result — interim or final — means the user isn't silent; disarm the watchdog above.
      if (!hasHeardSpeechRef.current) {
        hasHeardSpeechRef.current = true;
        speechStartRef.current = Date.now();
      }
      if (totalSilenceTimerRef.current) {
        clearTimeout(totalSilenceTimerRef.current);
        totalSilenceTimerRef.current = null;
      }

      let currentInterim = "";
      let currentFinal = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      setInterimTranscript(currentInterim);
      if (currentFinal) {
        setTranscript((prev) => {
          const newTranscript = prev + (prev && currentFinal.trim() ? " " : "") + currentFinal.trim();
          return newTranscript;
        });
      }

      // Silence detection logic
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      
      if (onSilenceTimeoutRef.current) {
        silenceTimeoutRef.current = setTimeout(() => {
          const combinedReady = transcriptRef.current + (transcriptRef.current && currentFinal.trim() ? " " : "") + currentFinal.trim();
          if (combinedReady.trim().length > 0 && onSilenceTimeoutRef.current) {
            const pauseBefore = speechStartRef.current !== null ? speechStartRef.current - listenStartRef.current : 0;
            // Speaking duration excludes the trailing silenceTimeoutMs spent confirming they'd finished.
            const durationMs = speechStartRef.current !== null
              ? Math.max(0, (Date.now() - silenceTimeoutMs) - speechStartRef.current)
              : 0;
            onSilenceTimeoutRef.current(combinedReady.trim(), { durationMs, pauseBefore });
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
    transcriptRef.current = "";
    isIntentionallyStopped.current = false;
    
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
    
    try {
      recognitionRef.current?.stop();
    } catch (e) {
      console.warn("Could not stop recognition:", e);
    }
  }, [isSupported]);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    transcriptRef.current = "";
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
