# MockMentor: Interview Q&A Guide

This document compiles all the questions and answers we discussed to help you prepare for your MockMentor technical interview.

---

## 1. What is FastAPI and why use it over Flask or Django?

### What is FastAPI?
**FastAPI** is a modern, high-performance web framework used for building APIs with Python. It is built from the ground up on **ASGI** (Asynchronous Server Gateway Interface) using a tool called Starlette, which means it handles concurrent, asynchronous operations incredibly well. It also uses standard Python type hints and **Pydantic** to automatically validate data, serialize it, and generate documentation.

### Why FastAPI over Django?
Django is a "batteries-included" full-stack framework. It comes with a heavy ORM, an admin panel, authentication systems, and an HTML templating engine.
> *"I chose not to use Django because it was massive overkill for the ML sidecar. MockMentor uses a microservices architecture: Next.js handles the front-end, routing, and user authentication. The Python sidecar has exactly one job: receive camera frames, run them through MediaPipe, and return behavioral metrics. It doesn't need an ORM, an admin panel, or templates. FastAPI allowed me to build a lightweight, specialized microservice."*

### Why FastAPI over Flask?
> *"While Flask is a great lightweight framework, I chose FastAPI over Flask for three critical reasons directly related to how the ML sidecar operates:"*
1. **First-Class WebSocket Support:** MockMentor streams camera frames at 4 FPS requiring open WebSockets. FastAPI natively supports WebSockets and asynchronous programming out of the box because it runs on an ASGI server. Flask is fundamentally a synchronous WSGI framework.
2. **Performance:** Because the computer vision pipeline (MediaPipe) runs heavy operations on every frame, minimizing backend latency is critical so the user's `StressHUD` updates instantly. FastAPI is significantly faster than Flask.
3. **Data Validation:** FastAPI uses Pydantic to automatically validate complex nested data structures (like emotion probabilities and stress scores) and serialize them to JSON based on Python type hints safely.

---

## 2. Why MongoDB? Why not MySQL?

### The Short Answer
>"I chose MongoDB because MockMentor handles highly nested, unstructured AI-generated data (like conversation transcripts, variable JSON reports, and arrays of stress metrics). A NoSQL document database allowed me to store this data exactly as it looks in my JavaScript code, whereas MySQL would have required breaking this data apart into dozens of complex, joined tables."

### Detailed Breakdown
1. **Flexible Schema for AI Output:** An interview report contains overall scores, strengths arrays, and detailed feedback for *every single question* asked. In MySQL, storing this would require multiple tables and complex `JOIN` queries. MongoDB stores data as BSON (binary JSON) documents, which is perfectly suited for hierarchical, document-oriented data coming from AI APIs.
2. **No "Impedance Mismatch":** The frontend (React), the backend (Next.js API routes), and the AI responses all speak JSON. By using MongoDB, the entire stack speaks the same language without parsing or running complex ORMs.
3. **Rapid Iteration:** MongoDB is schema-flexible. If I want to start tracking a new metric (like "fidget level"), I simply add that field to the incoming JSON payload and save it, without needing SQL migrations to `ALTER TABLE`.

---

## 3. How did you implement TTS (Text-to-Speech) and STT (Speech-to-Text)?

Instead of paying for third-party APIs (like OpenAI Whisper), I wrapped the **Native HTML5 Web Speech API** into custom React hooks, resulting in $0 API costs and zero-latency.

### Speech-to-Text (STT) implementation (`useSpeechToText.ts`)
* **Real-time Transcribing:** Initializes `window.SpeechRecognition` in `continuous` and `interimResults` mode to capture text as it's spoken.
* **Custom Silence Detection:** I set up a JavaScript timeout (default 3 seconds). Every time the user speaks, the timeout resets. If the user stops speaking for 3 seconds, it triggers an `onSilenceTimeout` callback. This tells the AI, *"The user is finished talking, it's your turn."*
* **Auto-Restart Logic:** If the browser's engine stops unexpectedly (e.g., throwing a `no-speech` event), the hook catches this and automatically calls `.start()` again to keep the interview active.

### Text-to-Speech (TTS) implementation (`useTextToSpeech.ts`)
* **Smart Voice Selection:** Uses `window.speechSynthesis.getVoices()` to load system voices, filtering for English voices and prioritizing high-quality ones (like "Google US" or "Premium") to make the AI sound human.
* **Promise-Based Orchestration:** The `speak()` function returns a **Promise**. It sets up an `onend` event listener and resolves only when the AI has completely finished speaking. This ensures the AI doesn't talk over itself and the mic isn't turned back on too early.

---

## 4. How does the LLM generate questions and how does the feedback system work?

The system is split into two LLM processes: **The Live Conversation Engine** and **The Final Evaluation Engine**.

### The Live Loop (Question Generation)
*   **The Context:** Every time the user speaks, their text is sent to `/api/ai-chat`. The backend builds a massive context window containing the AI's persona, the candidate's resume summary, the job description, the entire conversation history, and the user's latest message.
*   **The Prompt:** The AI is strictly instructed to reply directly to what the user said and *always* ask a relevant follow-up question.
*   **Fallback:** If the Groq/LLaMA API hits a rate limit, a graceful fallback randomly returns generic interview questions so the session doesn't crash.

### The Report Generator (Feedback System)
*   **The Inputs:** When the session ends, the *entire transcript* and behavioral metrics (Speaking Time, WPM, Filler Words, Confidence Score) are sent to `/api/generate-report`.
*   **The Prompt:** A highly complex JSON Schema prompt instructs the AI to act as a "brutally honest senior hiring manager." It enforces hard rules (e.g., "If filler words > 10, deduct 8 points").
*   **The Output:** The LLM returns a strict JSON object containing scores, strengths, weaknesses, and specific Q&A feedback.
*   **Heuristic Fallback:** If the AI model fails completely, the code mathematically calculates a "fallback report" based purely on word counts and speech metrics so the user always gets a report.

---

## 5. What MongoDB collections exist?

1.  **Users:** Stores the user's Clerk ID, their uploaded resume Appwrite URL, and the AI-generated resume summary.
2.  **Interviews:** The metadata for an interview attempt (Target Job Title, Job Description summary, and Mentor Persona).
3.  **InterviewSessions:** The live, real-time data. Stores the `messages` transcript array, timestamps, and raw speech metrics.
4.  **InterviewReports:** The final generated artifact containing the massive nested JSON structure with AI performance analysis, scores, and feedback.

*(This separation of concerns ensures that if a user drops out mid-interview, you have an `InterviewSession` but no `InterviewReport`, preventing database errors.)*

---

## 6. How would you scale to 10,000 concurrent users?

*   **Frontend (Next.js):** Deployed on Vercel, it scales almost infinitely out of the box via Vercel's Edge Network/CDN.
*   **Database (MongoDB):** Add **Indexes** on `userId` and `interviewId` across all collections to ensure profile and report queries remain incredibly fast.
*   **AI Bottleneck:** Sending 10k requests to Groq/Gemini would hit rate limits. To scale, I would use an API Gateway to load-balance requests across multiple API keys or enterprise tiers.
*   **ML Sidecar (Biggest bottleneck):** Maintaining 10k open WebSockets streaming 4 video frames per second to a single Python server would crash it. To scale, I would containerize the FastAPI app with Docker and deploy it to Kubernetes with auto-scaling groups based on CPU utilization.

---

## 7. What is the biggest limitation or tradeoff in your architecture?

*You should pick one of these to discuss during the interview:*

**Tradeoff A: Native Browser APIs vs. Third-Party Paid APIs**
> *"The biggest tradeoff I made was using the native Web Speech API for voice instead of a paid service like OpenAI Whisper or ElevenLabs. The massive benefit is that latency is virtually zero and it costs $0. The limitation is that the API behaves differently across browsers (Chrome uses Google, Safari uses Apple). I sacrificed strict control over exact cross-browser voice quality in exchange for speed and cost-efficiency."*

**Tradeoff B: Server-Side Computer Vision vs. Client-Side (WASM)**
> *"Currently, the system captures webcam frames and streams them over WebSockets to a Python sidecar. The tradeoff here is bandwidth and server compute. If I had another month, my biggest architectural shift would be moving the MediaPipe CV pipeline directly into the browser using WebAssembly (WASM). This would do the tracking entirely on the user's local machine—eliminating network latency, reducing server costs to zero, and drastically improving privacy."*
