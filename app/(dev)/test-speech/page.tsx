"use client";

import { useState, useEffect, useCallback } from "react";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";

export default function TestSpeechPage() {
  const [testText, setTestText] = useState(
    "Hello! This is a test of the text to speech system. Can you hear me clearly?"
  );
  const [sttResult, setSttResult] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [userAgent, setUserAgent] = useState<string>("");
  const [micPermission, setMicPermission] = useState<string>("unknown");

  // Initialize TTS
  const {
    isSpeaking,
    isSupported: ttsSupported,
    voices,
    selectedVoice,
    speak,
    stop: stopSpeaking,
  } = useTextToSpeech();

  // Memoize the silence timeout callback to prevent useEffect re-runs
  const handleSilenceTimeout = useCallback((finalText: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] 🔕 Silence detected. Final text: "${finalText}"`, ...prev].slice(0, 50));
    setSttResult(finalText);
  }, []);

  // Initialize STT
  const {
    isListening,
    transcript,
    interimTranscript,
    error: sttError,
    isSupported: sttSupported,
    startListening,
    stopListening,
    clearTranscript,
  } = useSpeechToText({
    lang: "en-US",
    continuous: true,
    interimResults: true,
    onSilenceTimeout: handleSilenceTimeout,
    silenceTimeoutMs: 3000,
  });

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
  };

  useEffect(() => {
    addLog("🚀 Speech Test Page Loaded");
    addLog(`🎤 STT Supported: ${sttSupported}`);
    addLog(`🔊 TTS Supported: ${ttsSupported}`);
    // Set user agent on client side only
    setUserAgent(navigator.userAgent);
    
    // Check microphone permission
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((result) => {
        setMicPermission(result.state);
        addLog(`🎙️ Microphone permission: ${result.state}`);
        
        result.onchange = () => {
          setMicPermission(result.state);
          addLog(`🎙️ Microphone permission changed to: ${result.state}`);
        };
      }).catch((err) => {
        addLog(`⚠️ Could not check microphone permission: ${err}`);
      });
    }
  }, [sttSupported, ttsSupported]);

  useEffect(() => {
    if (voices.length > 0) {
      addLog(`🎵 Loaded ${voices.length} voices`);
      if (selectedVoice) {
        addLog(`✅ Selected voice: ${selectedVoice.name} (${selectedVoice.lang})`);
      } else {
        addLog(`⚠️ No voice selected - voices loaded but none chosen`);
      }
    } else if (ttsSupported) {
      addLog(`⏳ Waiting for voices to load...`);
    }
  }, [voices, selectedVoice, ttsSupported]);

  useEffect(() => {
    if (transcript) {
      addLog(`📝 Transcript updated: "${transcript}"`);
      console.log('📝 TRANSCRIPT UPDATED:', transcript);
    }
  }, [transcript]);

  useEffect(() => {
    if (interimTranscript) {
      console.log('💬 INTERIM:', interimTranscript);
    }
  }, [interimTranscript]);

  useEffect(() => {
    if (sttError) {
      addLog(`❌ STT Error: ${sttError}`);
    }
  }, [sttError]);

  const handleTestTTS = async () => {
    try {
      addLog(`🔊 Starting TTS: "${testText}"`);
      addLog(`📊 Voices available: ${voices.length}, Selected: ${selectedVoice?.name || 'none'}`);
      await speak(testText);
      addLog("✅ TTS completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`❌ TTS Error: ${errorMessage}`);
      console.error("TTS Error details:", error);
    }
  };

  const handleStartSTT = () => {
    addLog("🎤 Starting STT listening...");
    console.log('🎤 USER CLICKED START LISTENING');
    clearTranscript();
    setSttResult("");
    startListening();
    
    // Add a timeout check
    setTimeout(() => {
      if (isListening) {
        console.log('⏰ 5 seconds of listening - any results?', { transcript, interimTranscript });
        if (!transcript && !interimTranscript) {
          addLog("⚠️ No speech detected after 5 seconds. Try speaking louder!");
        }
      }
    }, 5000);
  };

  const handleStopSTT = () => {
    addLog("⏹️ Stopping STT listening...");
    stopListening();
    if (transcript) {
      setSttResult(transcript);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    addLog("🧹 Logs cleared");
  };

  const testMicrophone = async () => {
    try {
      addLog("🎙️ Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog("✅ Microphone access granted!");
      addLog(`🎤 Audio tracks: ${stream.getAudioTracks().length}`);
      stream.getAudioTracks().forEach(track => {
        addLog(`  - ${track.label} (${track.kind})`);
        track.stop(); // Stop the track after testing
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`❌ Microphone test failed: ${errorMessage}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            🎤 Speech API Test Page
          </h1>
          <p className="text-slate-300">
            Test Speech-to-Text (STT) and Text-to-Speech (TTS) functionality
          </p>
        </div>

        {/* Support Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div
            className={`p-6 rounded-lg ${
              ttsSupported ? "bg-green-900/30" : "bg-red-900/30"
            } border ${
              ttsSupported ? "border-green-500" : "border-red-500"
            }`}
          >
            <h3 className="text-xl font-semibold text-white mb-2">
              🔊 Text-to-Speech
            </h3>
            <p className="text-slate-300">
              Status:{" "}
              <span
                className={`font-bold ${
                  ttsSupported ? "text-green-400" : "text-red-400"
                }`}
              >
                {ttsSupported ? "✅ Supported" : "❌ Not Supported"}
              </span>
            </p>
            {ttsSupported && (
              <>
                <p className="text-slate-300 mt-2">
                  Voices: {voices.length} available
                </p>
                <p className="text-slate-300">
                  Selected: {selectedVoice?.name || "None"}
                </p>
                <p className="text-slate-300">
                  Speaking: {isSpeaking ? "🔊 Yes" : "🔇 No"}
                </p>
              </>
            )}
          </div>

          <div
            className={`p-6 rounded-lg ${
              sttSupported ? "bg-green-900/30" : "bg-red-900/30"
            } border ${
              sttSupported ? "border-green-500" : "border-red-500"
            }`}
          >
            <h3 className="text-xl font-semibold text-white mb-2">
              🎤 Speech-to-Text
            </h3>
            <p className="text-slate-300">
              Status:{" "}
              <span
                className={`font-bold ${
                  sttSupported ? "text-green-400" : "text-red-400"
                }`}
              >
                {sttSupported ? "✅ Supported" : "❌ Not Supported"}
              </span>
            </p>
            {sttSupported && (
              <>
                <p className="text-slate-300 mt-2">
                  Listening: {isListening ? "🎤 Active" : "⏸️ Inactive"}
                </p>
                <p className="text-slate-300">
                  Mic Permission: {
                    micPermission === "granted" ? "✅ Granted" :
                    micPermission === "denied" ? "❌ Denied" :
                    micPermission === "prompt" ? "⏳ Not requested" :
                    "❓ Unknown"
                  }
                </p>
                {sttError && (
                  <p className="text-red-400 mt-2">Error: {sttError}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* TTS Test Section */}
        <div className="bg-slate-800/50 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">
            🔊 Test Text-to-Speech
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-slate-300 mb-2">
                Text to speak:
              </label>
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-purple-500"
                rows={3}
                placeholder="Enter text to convert to speech..."
              />
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleTestTTS}
                disabled={!ttsSupported || isSpeaking || voices.length === 0}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
                title={voices.length === 0 ? "Waiting for voices to load..." : ""}
              >
                {isSpeaking ? "🔊 Speaking..." : voices.length === 0 ? "⏳ Loading..." : "▶️ Speak Text"}
              </button>
              <button
                onClick={stopSpeaking}
                disabled={!isSpeaking}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
              >
                ⏹️ Stop
              </button>
            </div>
          </div>
        </div>

        {/* STT Test Section */}
        <div className="bg-slate-800/50 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">
            🎤 Test Speech-to-Text
          </h2>
          <div className="space-y-4">
            {/* Microphone Test Button */}
            <div className="bg-blue-900/30 border border-blue-500 rounded-lg p-4 mb-4">
              <p className="text-blue-200 text-sm mb-2">
                <strong>Step 1:</strong> First, test if your microphone works:
              </p>
              <button
                onClick={testMicrophone}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
              >
                🎙️ Test Microphone Access
              </button>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={handleStartSTT}
                disabled={!sttSupported || isListening}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
              >
                {isListening ? "🎤 Listening..." : "🎙️ Start Listening"}
              </button>
              <button
                onClick={handleStopSTT}
                disabled={!isListening}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
              >
                ⏹️ Stop Listening
              </button>
              <button
                onClick={() => {
                  clearTranscript();
                  setSttResult("");
                }}
                className="px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-semibold transition-colors"
              >
                🧹 Clear
              </button>
            </div>

            {/* Big prominent display for what you're saying */}
            <div className="bg-slate-900 rounded-lg p-6 border-4 border-purple-500 min-h-[150px]">
              <p className="text-slate-400 text-sm mb-2">
                {isListening ? "🎤 Listening... Speak now!" : "⏸️ Not listening"}
              </p>
              
              {isListening && !transcript && !interimTranscript && (
                <p className="text-slate-500 text-xl italic">
                  Waiting for speech... (Try speaking louder)
                </p>
              )}
              
              {/* Live interim transcript (what you're saying RIGHT NOW) */}
              {interimTranscript && (
                <div className="mb-3">
                  <p className="text-yellow-400 text-2xl font-bold animate-pulse">
                    {interimTranscript}
                  </p>
                  <p className="text-yellow-600 text-xs mt-1">↑ Speaking now (interim)</p>
                </div>
              )}
              
              {/* Confirmed transcript */}
              {transcript && (
                <div>
                  <p className="text-white text-2xl font-semibold">
                    {transcript}
                  </p>
                  <p className="text-green-600 text-xs mt-1">↑ Confirmed text</p>
                </div>
              )}
            </div>

            {/* Removed duplicate smaller displays - using big prominent display above */}

            {/* Final result after silence */}
            {sttResult && (
              <div className="p-4 bg-green-900/30 rounded-lg border border-green-500">
                <p className="text-slate-400 text-sm mb-1">
                  ✅ Final result (after silence):
                </p>
                <p className="text-green-300 font-semibold">{sttResult}</p>
              </div>
            )}
          </div>
        </div>

        {/* Combined Test */}
        <div className="bg-slate-800/50 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">
            🔄 Combined Test (TTS → STT)
          </h2>
          <p className="text-slate-300 mb-4">
            This will speak the text above and then immediately start listening.
            The system should recognize its own speech.
          </p>
          <button
            onClick={async () => {
              addLog("🔄 Starting combined test...");
              clearTranscript();
              setSttResult("");
              try {
                await speak(testText);
                addLog("✅ TTS completed, starting STT...");
                setTimeout(() => {
                  startListening();
                }, 500);
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`❌ Combined test error: ${errorMessage}`);
              }
            }}
            disabled={!sttSupported || !ttsSupported || isListening || isSpeaking}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
          >
            🔄 Run Combined Test
          </button>
        </div>

        {/* Logs */}
        <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-white">📋 Activity Logs</h2>
            <button
              onClick={handleClearLogs}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm transition-colors"
            >
              Clear Logs
            </button>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
            {logs.length === 0 ? (
              <p className="text-slate-500">No logs yet...</p>
            ) : (
              logs.map((log, index) => (
                <div
                  key={index}
                  className="text-slate-300 py-1 border-b border-slate-800 last:border-0"
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Browser Info */}
        <div className="mt-6 p-4 bg-slate-800/30 rounded-lg border border-slate-700">
          <p className="text-slate-400 text-sm">
            <strong>Browser:</strong> {userAgent || "Loading..."}
          </p>
          <p className="text-slate-400 text-sm mt-2">
            <strong>Note:</strong> For best results, use Chrome or Edge. Safari
            and Firefox have limited Web Speech API support. Make sure to allow
            microphone permissions when prompted.
          </p>
        </div>
      </div>
    </div>
  );
}
