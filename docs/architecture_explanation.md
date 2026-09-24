# MockMentor: Full Architecture Explanation (10-Minute Read)

This document is designed to give you a complete, end-to-end understanding of how MockMentor works. It is structured perfectly for a 10-minute architectural deep dive in an interview setting.

---

## 1. High-Level Overview (The "Elevator Pitch")

MockMentor is a **microservices-based, AI-powered mock interview platform**. 
Instead of building one massive monolithic application, the system is separated into highly specialized parts:

1. **The Core Web Platform:** Built with Next.js 15, handling UI, routing, user management, and the overall flow. Deployed on Vercel.
2. **The Real-Time Voice Engine:** A custom, zero-latency system built entirely using native browser APIs (Web Speech API) instead of relying on expensive third-party tools.
3. **The ML Sidecar:** A completely separate Python service running FastAPI and MediaPipe that tracks user stress, emotions, and body language via WebSockets. Deployed on Render.
4. **The Database & Storage Layer:** MongoDB Atlas handles all structured and unstructured JSON data, while Appwrite handles raw file storage (Resumes).

---

## 2. The Frontend (Next.js 15, TypeScript, Tailwind)

**Why Next.js?**
Next.js was chosen because it provides **Server-Side Rendering (SSR)** and **API Routes** in one package. This allows us to keep sensitive AI API keys securely on the server while delivering a blazing-fast React frontend.

*   **App Router:** We use the modern Next.js App Router (`/app` directory) for clean, layout-based routing.
*   **State Management:** For the complex state of a live interview (managing transcripts, speaking state, camera state), we use custom React Hooks (`useVoiceInterview.ts`, `useFaceTracker.ts`). This keeps the UI components clean and pushes the business logic into reusable hooks.
*   **Authentication:** We use **Clerk**. Clerk acts as a middleware, protecting our routes at the edge. Users can't access the `/interview` routes unless Clerk verifies their JWT (JSON Web Token).

---

## 3. The Voice Architecture (The "Secret Sauce")

*If the interviewer asks about a technical challenge you solved, talk about this.*

Most AI interview tools use expensive services like OpenAI's Whisper (for Speech-to-Text) and ElevenLabs (for Text-to-Speech). This introduces high latency (network round-trips) and high costs. 

**Our Solution:** We built a custom **Browser-Based Voice API**.
*   **Speech-to-Text (STT):** We use the browser's native `window.SpeechRecognition`. It listens to the user's mic and transcribes speech locally in real-time. We built a custom "silence detection" timer—if the user stops speaking for 3 seconds, we assume they are done and trigger the AI.
*   **Text-to-Speech (TTS):** We use `window.speechSynthesis`. The browser natively converts the AI's text response into audio.
*   **Result:** The **only** network request made during the interview is sending text to our AI backend. This results in incredibly low latency, making the conversation feel natural, and costs $0 per minute in voice processing.

---

## 4. The AI Brain (Gemini 2.0 Flash & Groq Fallback)

The intelligence of the platform relies on Large Language Models (LLMs). We don't just use one model; we built a **Multi-Model Fallback System**.

*   **Primary Engine:** Google's **Gemini 2.0 Flash**. It handles parsing the uploaded resume, summarizing the job description, generating the interviewer's questions, and writing the massive final performance report.
*   **Fallback Engine:** **Groq (LLaMA 3.1/3.3)**. If Gemini is rate-limited (HTTP 429) or goes down, the system automatically catches the error and routes the exact same prompt to Groq. Groq uses specialized LPUs (Language Processing Units), making it blazingly fast.
*   **Centralized Prompts:** We don't hardcode prompts in our API routes. We use a central `lib/prompts.json` file. This means we can change the interviewer's personality (e.g., from "Friendly HR" to "Tough Tech Lead") just by editing a JSON config, without changing any application code.

---

## 5. The ML Sidecar (FastAPI & MediaPipe)

This is the computer vision aspect of the project. Running heavy ML models inside a Next.js Node environment is a bad idea—it blocks the main thread and ruins performance.

**Our Solution: A Microservice Architecture.**
We built a completely separate Python application (`model/server.py`).

1.  **FastAPI:** We use FastAPI because it natively supports asynchronous **WebSockets**.
2.  **The Flow:** 
    *   The browser captures the user's webcam at 4 frames per second (to save bandwidth).
    *   It sends these JPEG frames via WebSocket to the Python server.
    *   The server runs the frames through **MediaPipe**, an ML pipeline by Google.
    *   It calculates 468 face landmarks, tracks the iris (gaze), measures the Eye Aspect Ratio (blinks), and maps blendshapes to a 7-class emotion classifier.
    *   It composites all this data into a "Stress Score" and sends it back via WebSocket.
3.  **StressHUD:** The React frontend receives this data and updates the `StressHUD` component seamlessly in real-time, completely independently from the voice conversation loop.

---

## 6. Database & Storage (MongoDB & Appwrite)

**Why MongoDB?**
AI models output highly variable, deeply nested JSON data (e.g., an array of strengths, nested dimension scores, lists of recommendations). MongoDB is a NoSQL document database that stores BSON (Binary JSON). This prevents the "impedance mismatch" of trying to fit complex AI reports into rigid SQL rows and columns. 

**Why Appwrite?**
MongoDB is for text/JSON data, not files. We use Appwrite Cloud Storage (an open-source Firebase alternative) purely as an AWS S3 replacement to store the physical `.pdf` or `.docx` resume files uploaded by the user.

---

## 7. The Complete End-to-End Workflow

To wrap it up, here is exactly what happens when a user clicks "Start Interview":

1.  **Auth:** User logs in via Clerk.
2.  **Upload:** User uploads a Resume -> Saved to Appwrite -> Text sent to Gemini -> Summary saved to MongoDB.
3.  **Context:** User enters a Job Title -> Gemini generates a job summary.
4.  **Session Init:** MongoDB creates a new `InterviewSession` document linking the user, the job, and the chosen mentor persona.
5.  **The Loop:**
    *   `useSpeechToText` transcribes user speech locally.
    *   Text is sent to `/api/ai-chat`.
    *   Gemini reads the transcript history + system prompt, generates a reply.
    *   `useTextToSpeech` speaks the reply locally.
    *   Simultaneously, `useFaceTracker` streams camera frames to the FastAPI sidecar, which streams back stress metrics.
6.  **The Report:** User exits -> Entire transcript + behavioral metrics (pauses, filler words) sent to Gemini -> A massive JSON report is generated scoring the user on 4 dimensions and giving actionable feedback -> Saved to MongoDB -> Displayed on the screen.

---

### Interview Pro-Tips for this Architecture:
*   Emphasize the **separation of concerns** (Next.js for web, FastAPI for ML).
*   Highlight the **cost-saving and low-latency** aspect of using browser-native Voice APIs instead of paid services.
*   Mention the **robustness** of having an AI fallback mechanism (Gemini -> Groq).
