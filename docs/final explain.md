# MockMentor: How It Actually Works

MockMentor is an AI-powered mock interview platform built using **Next.js 15 (App Router)**, **TypeScript**, **Tailwind CSS**, and **MongoDB**. The platform uses **Groq AI (LLaMA 3.1 8B)** for extremely fast natural language generation and the browser's native **Web Speech API** for real-time voice interactions.

Below is a detailed breakdown of the complete application flow, every single path involved, and an in-depth explanation of the browser-based voice API you built.

---

## 1. Application Flow & Key Paths

Here is the step-by-step journey of a user through the application, matched with the corresponding files and API routes:

### Step 1: Authentication & Landing
* **Path:** `/app/page.tsx`
* **Flow:** The user arrives at the landing page and signs in using **Clerk**. Clerk handles session management and user identity.

### Step 2: Resume Upload
* **Path:** `/app/interview/new/page.tsx`
* **API Paths:** `/api/upload-resume`, `/api/process-resume`
* **Flow:** 
  1. The user uploads their resume.
  2. The file is stored in **Appwrite Storage**.
  3. The text is extracted from the resume and sent to the **Groq AI**.
  4. Groq generates a concise professional summary of the candidate, which is then saved to the user's profile in **MongoDB**.

### Step 3: Job Description Analysis
* **Path:** `/app/interview/new/page.tsx`
* **API Path:** `/api/process-job`
* **Flow:** The user enters the target job title and description. This text is sent to Groq AI to extract and summarize the key skills and requirements for the job role.

### Step 4: Interview Initialization
* **API Path:** `/api/create-interview`
* **Flow:** After selecting an AI mentor persona (e.g., tough technical interviewer or friendly HR), an interview session record is created in **MongoDB**. This record tracks the session context, the chosen persona, and the start time.

### Step 5: The Live Voice Interview
* **Path:** `/app/interview/[id]/page.tsx`
* **API Path:** `/api/ai-chat`
* **Flow:** This is the core voice-only session. It entirely relies on the **Browser-Based Voice API** hooks (`useSpeechToText`, `useTextToSpeech`, and `useVoiceInterview`) to manage the real-time conversation. User speech is transcribed locally in the browser, sent to the `/api/ai-chat` endpoint where Groq AI generates the interviewer's reply, and then spoken back to the user locally. *(See section 2 for a deep dive)*.

### Step 6: Generating the Performance Report
* **API Path:** `/api/generate-report`
* **Flow:** Once the interview session ends (either manually exited or the timer expires), the entire transcript of the conversation, along with behavioral metrics (like pauses and filler words), is sent to Groq AI. Groq evaluates the transcript based on a comprehensive prompt (stored centrally in `lib/prompts.json`) and scores the user across dimensions like Communication, Problem Solving, and Confidence.

### Step 7: Viewing the Report
* **Path:** `/app/report/[id]/page.tsx`
* **Flow:** The user views the detailed evaluation, including strengths, areas for improvement, and actionable feedback based on their mock interview.

---

## 2. The Browser-Based Voice API (Deep Dive)

The real-time voice interview is the most complex part of the system. Instead of relying on expensive external services for transcribing audio and synthesizing speech, you built a custom **Browser-Based Voice API** utilizing the native HTML5 Web Speech API. 

This system is orchestrated by three main custom hooks:

### A. Speech-to-Text: `hooks/useSpeechToText.ts`
This hook is responsible for listening to the user's microphone and converting it to text in real-time.
* **Core Technology:** `window.SpeechRecognition` (or `webkitSpeechRecognition`).
* **How It Works:**
  * When `startListening()` is called, the browser asks for microphone permissions and begins capturing audio.
  * The `onresult` event fires continuously as the user speaks. It provides both **interim results** (yellow text that updates live) and **final results** (confirmed text).
  * **Silence Detection Magic:** A timeout (default 3 seconds) is reset every time a new speech result is received. If the user stops speaking for 3 seconds, the timeout triggers the `onSilenceTimeout` callback. This is how the system knows the user has finished their thought and it's time for the AI to reply.
  * It gracefully handles expected errors like `'no-speech'` (when the user is just quiet) and auto-restarts listening if it stops unexpectedly but the session is still active.

### B. Text-to-Speech: `hooks/useTextToSpeech.ts`
This hook gives the AI a voice, converting text back into spoken audio.
* **Core Technology:** `window.speechSynthesis` and `SpeechSynthesisUtterance`.
* **How It Works:**
  * On load, it fetches all available browser voices via `window.speechSynthesis.getVoices()`. It intelligently tries to select high-quality English voices (like "Google US" or voices labeled "Premium/Enhanced").
  * The `speak(text)` function creates a new `SpeechSynthesisUtterance` with the text.
  * It sets up `onstart`, `onend`, and `onerror` event listeners. Crucially, it returns a Promise that only resolves when the `onend` event fires, meaning the AI has completely finished speaking its line.
  * It has safety mechanisms built-in: it calls `window.speechSynthesis.cancel()` before starting a new utterance to ensure previous audio is fully cleared.

### C. The Orchestrator: `components/logic/useVoiceInterview.ts`
This hook acts as the brain that connects STT, TTS, and the Groq AI backend. It manages the turn-based logic of the interview.
* **Flow of a Single Turn:**
  1. The user speaks. `useSpeechToText` captures it.
  2. The user pauses for 3 seconds. The `onSilenceTimeout` triggers, calling `handleUserSpeech()`.
  3. `handleUserSpeech` immediately calls `stopListening()` to mute the mic so it doesn't pick up the AI's response.
  4. The user's text and the past conversation history are packaged and sent to `POST /api/ai-chat`.
  5. Groq AI generates the interviewer's next response and returns it.
  6. `speakMessage()` is called with the AI's response. 
  7. It calls the `speak()` function from `useTextToSpeech`.
  8. **The Loop Restarts:** Once the `speak()` promise resolves (the AI finishes talking), a `setTimeout` of 200ms triggers `startListening()` again, turning the user's microphone back on for their next turn.

---

## 3. Why This Architecture is Brilliant

1. **Incredibly Cost-Effective:** By using the native Web Speech API for both STT and TTS, you completely eliminated the per-minute costs associated with traditional voice APIs (like OpenAI Whisper or HeyGen).
2. **Extremely Low Latency:** STT and TTS happen directly on the user's device. The only network call made during the interview loop is sending text to Groq AI. Because Groq uses specialized LPUs (Language Processing Units), inference is nearly instantaneous, resulting in a completely fluid, real-time conversational experience without awkward loading pauses.
3. **Centralized Prompt Control:** The entire AI behavior is governed by `lib/prompts.json`. If the AI acts out of character, you don't need to hunt through code; you just tweak the JSON file and the interview personality changes immediately.
4. **Independent Python Module:** You kept the heavy computer-vision stress tracker (`model/new.py`) entirely separate from the web app. This ensures the Next.js platform remains lightweight and performant, while still providing a path for advanced computer vision analytics when run locally.
