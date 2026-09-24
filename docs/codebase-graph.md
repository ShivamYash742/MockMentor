# MockMentor — Codebase Graph

> Last updated: 2026-05-17 · Model calibrated & live on production

---

## Architecture Overview

```mermaid
graph TD
    %% ─────────────────────────────────────────
    %% ENTRY POINTS
    %% ─────────────────────────────────────────
    subgraph "Next.js App Router"
        ROOT["app/page.tsx\n(Landing Page)"]
        LAYOUT["app/layout.tsx\n(Root Layout)"]
        INT_NEW["app/interview/new/page.tsx\n(New Interview)"]
        INT_ID["app/interview/[id]/page.tsx\n(Live Interview)"]
        RPT_ID["app/report/[id]/page.tsx\n(Report Viewer)"]
        TEST_SPEECH["app/test-speech/page.tsx\n(Speech Debug)"]
    end

    %% ─────────────────────────────────────────
    %% API ROUTES
    %% ─────────────────────────────────────────
    subgraph "API Layer  (app/api/)"
        API_UPLOAD["upload-resume\nroute.ts"]
        API_PROCESS_JOB["process-job\nroute.ts"]
        API_PROCESS_RESUME["process-resume\nroute.ts"]
        API_CREATE["create-interview\nroute.ts"]
        API_INTERVIEW["interview\nroute.ts"]
        API_SESSION["interview-session\nroute.ts"]
        API_AI_CHAT["ai-chat\nroute.ts"]
        API_REPORT["generate-report\nroute.ts"]
        API_USER["user-profile\nroute.ts"]
    end

    %% ─────────────────────────────────────────
    %% PAGE → API CALLS
    %% ─────────────────────────────────────────
    INT_NEW -->|"POST resume"| API_UPLOAD
    INT_NEW -->|"POST job desc"| API_PROCESS_JOB
    INT_NEW -->|"POST resume text"| API_PROCESS_RESUME
    INT_NEW -->|"POST setup"| API_CREATE
    INT_ID  -->|"GET/POST"| API_INTERVIEW
    INT_ID  -->|"GET/PATCH"| API_SESSION
    INT_ID  -->|"POST message"| API_AI_CHAT
    INT_ID  -->|"POST finish"| API_REPORT
    RPT_ID  -->|"GET report"| API_REPORT
    ROOT    -->|"GET profile"| API_USER

    %% ─────────────────────────────────────────
    %% COMPONENTS (Landing Page)
    %% ─────────────────────────────────────────
    subgraph "Landing Components  (components/)"
        NAVBAR["navbar.tsx"]
        HERO["hero-section.tsx"]
        FEATURES["features-section.tsx"]
        DEMOS["demos-section.tsx"]
        MENTORS["mentors.tsx"]
        FOOTER["footer.tsx"]
        MARQUEE["magicui/marquee.tsx"]
        SEC_HEAD["section-heading.tsx"]
    end

    ROOT --> NAVBAR
    ROOT --> HERO
    ROOT --> FEATURES
    ROOT --> DEMOS
    ROOT --> MENTORS
    ROOT --> FOOTER
    DEMOS --> MARQUEE
    FEATURES --> SEC_HEAD
    MENTORS --> SEC_HEAD

    %% ─────────────────────────────────────────
    %% INTERVIEW COMPONENTS
    %% ─────────────────────────────────────────
    subgraph "Interview Components"
        INTERVIEW_UI["interview.tsx\n(main interview shell)"]
        INT_COMPLETE["interview-complete.tsx\n(post-interview CTA)"]
        STRESS_HUD["interview/StressHUD.tsx\n(real-time stress overlay)"]
        LOADING_SK["loading-skeleton.tsx"]
    end

    INT_ID --> INTERVIEW_UI
    INTERVIEW_UI --> INT_COMPLETE
    INTERVIEW_UI --> STRESS_HUD

    %% ─────────────────────────────────────────
    %% REPORT COMPONENTS
    %% ─────────────────────────────────────────
    subgraph "Report Components"
        INTERVIEW_RPT["interview-report.tsx\n(full report renderer)"]
    end

    RPT_ID --> INTERVIEW_RPT

    %% ─────────────────────────────────────────
    %% VOICE LOGIC (components/logic/)
    %% ─────────────────────────────────────────
    subgraph "Voice Logic  (components/logic/)"
        VOICE_CTX["VoiceInterviewContext.tsx\n(React Context)"]
        VOICE_HOOK["useVoiceInterview.ts\n(state machine)"]
        LOGIC_IDX["index.ts\n(barrel)"]
    end

    INTERVIEW_UI --> VOICE_CTX
    VOICE_CTX --> VOICE_HOOK

    %% ─────────────────────────────────────────
    %% BROWSER HOOKS
    %% ─────────────────────────────────────────
    subgraph "Hooks  (hooks/)"
        STT["useSpeechToText.ts\n(Web Speech API)"]
        TTS["useTextToSpeech.ts\n(SpeechSynthesis API)"]
        FACE_HOOK["useFaceTracker.ts\n(WebSocket → ML Sidecar)"]
    end

    VOICE_HOOK --> STT
    VOICE_HOOK --> TTS
    INTERVIEW_UI --> FACE_HOOK
    FACE_HOOK --> STRESS_HUD

    %% ─────────────────────────────────────────
    %% SHARED UI PRIMITIVES
    %% ─────────────────────────────────────────
    subgraph "Shadcn UI Primitives  (components/ui/)"
        BTN["button.tsx"]
        CARD["card.tsx"]
        BADGE["badge.tsx"]
        PROGRESS["progress.tsx"]
        AVATAR["avatar.tsx"]
        INPUT["input.tsx"]
        SCROLL["scroll-area.tsx"]
        SEPARATOR["separator.tsx"]
        ALERT_DLG["alert-dialog.tsx"]
    end

    INTERVIEW_UI --> BTN
    INTERVIEW_UI --> CARD
    INTERVIEW_UI --> BADGE
    INTERVIEW_UI --> PROGRESS
    INTERVIEW_UI --> AVATAR
    INTERVIEW_UI --> SCROLL
    INTERVIEW_UI --> ALERT_DLG
    INTERVIEW_RPT --> CARD
    INTERVIEW_RPT --> BADGE
    INTERVIEW_RPT --> PROGRESS
    INTERVIEW_RPT --> SEPARATOR

    %% ─────────────────────────────────────────
    %% LIB / BACK-END SERVICES
    %% ─────────────────────────────────────────
    subgraph "Lib  (lib/)"
        GEMINI["gemini.ts\n(Gemini AI w/ fallback)"]
        GROQ["groq.ts\n(Groq AI w/ fallback)"]
        APPWRITE["appwrite.ts\n(Auth / Storage)"]
        MONGODB["mongodb.ts\n(DB connection)"]
        PDF_LIB["pdf.ts\n(PDF parsing)"]
        PROMPT_HELPER["promptHelper.ts"]
        PROMPTS_JSON["prompts.json"]
        APP_CFG["appConfig.ts"]
        UTILS["utils.ts"]
        ML_SIDECAR["mlSidecar.ts\n(ML bridge types + config)"]
    end

    subgraph "DB Models  (lib/models/)"
        M_INTERVIEW["Interview.ts"]
        M_REPORT["InterviewReport.ts"]
        M_SESSION["InterviewSession.ts"]
        M_USER["User.ts"]
    end

    %% API → Lib wiring
    API_UPLOAD       --> APPWRITE
    API_UPLOAD       --> PDF_LIB
    API_PROCESS_JOB  --> GEMINI
    API_PROCESS_JOB  --> GROQ
    API_PROCESS_RESUME --> GEMINI
    API_PROCESS_RESUME --> GROQ
    API_CREATE       --> MONGODB
    API_CREATE       --> M_INTERVIEW
    API_INTERVIEW    --> MONGODB
    API_INTERVIEW    --> M_INTERVIEW
    API_SESSION      --> MONGODB
    API_SESSION      --> M_SESSION
    API_AI_CHAT      --> GEMINI
    API_AI_CHAT      --> GROQ
    API_AI_CHAT      --> PROMPT_HELPER
    API_REPORT       --> GEMINI
    API_REPORT       --> GROQ
    API_REPORT       --> MONGODB
    API_REPORT       --> M_REPORT
    API_USER         --> MONGODB
    API_USER         --> M_USER

    PROMPT_HELPER    --> PROMPTS_JSON
    GEMINI           --> APP_CFG
    GROQ             --> APP_CFG
    FACE_HOOK        --> ML_SIDECAR

    %% ─────────────────────────────────────────
    %% PYTHON ML SIDECAR  (model/)
    %% ─────────────────────────────────────────
    subgraph "Python ML Sidecar  (model/) — Deployed on Render"
        PY_SERVER["server.py\n(FastAPI + WebSocket)"]
        PY_SCHEMA["schema.py\n(FrameResult dataclass)"]
        PY_STORAGE["storage.py\n(SessionStorage aggregator)"]
        PY_MAIN["new.py\n(standalone CV script)"]

        subgraph "Tracker Package  (tracker/)"
            TK_INIT["__init__.py\n(Pipeline orchestrator)"]
            TK_FACE["face.py\n(Face landmarks + EAR)"]
            TK_EMOTION["emotion.py\n(7-class classifier)"]
            TK_GAZE["gaze.py\n(Iris gaze offset)"]
            TK_HANDS["hands.py\n(Hand fidget detector)"]
            TK_POSE["pose.py\n(Head pose + posture)"]
            TK_STRESS["stress.py\n(Meta-signal scorer)"]
            TK_SMOOTH["smoothing.py\n(EMA + window filters)"]
        end

        PY_MODELS["models/\n(MediaPipe .task files)"]
        PY_DATA["data/\n(sample stress JSON)"]
        DOCKERFILE["Dockerfile"]
        RENDER_YAML["render.yaml"]
    end

    PY_SERVER --> TK_INIT
    PY_SERVER --> PY_SCHEMA
    PY_SERVER --> PY_STORAGE
    TK_INIT   --> TK_FACE
    TK_INIT   --> TK_EMOTION
    TK_INIT   --> TK_GAZE
    TK_INIT   --> TK_HANDS
    TK_INIT   --> TK_POSE
    TK_INIT   --> TK_STRESS
    TK_INIT   --> TK_SMOOTH
    TK_INIT   --> PY_MODELS
    PY_MAIN   --> PY_DATA
    PY_MAIN   --> PY_MODELS

    %% ─────────────────────────────────────────
    %% BROWSER ↔ ML SIDECAR (WebSocket)
    %% ─────────────────────────────────────────
    FACE_HOOK -.->|"WS /ws/{session_id}\n(JPEG frames → FrameResult JSON)"| PY_SERVER

    %% ─────────────────────────────────────────
    %% MIDDLEWARE / CONFIG
    %% ─────────────────────────────────────────
    subgraph "Config & Infra"
        MIDDLEWARE["middleware.ts\n(Clerk auth guard)"]
        NEXT_CFG["next.config.ts"]
        PKG["package.json"]
        TSCONFIG["tsconfig.json"]
        ENV["env.local / env.example"]
        THEME["components/theme-provider.tsx"]
    end

    LAYOUT --> THEME
    MIDDLEWARE --> APPWRITE
```

---

## ML Sidecar Pipeline (Detail)

```mermaid
flowchart LR
    subgraph Browser
        A["Camera frame\n(JPEG, 4 fps)"]
    end

    A -->|"WebSocket\nbase64 JPEG"| B["server.py\n(FastAPI)"]

    subgraph Pipeline
        B --> C["Face Landmarker\n(468 pts)"]
        B --> D["Hand Landmarker\n(2 hands × 21 pts)"]
        B --> E["Pose Landmarker\n(33 pts)"]
        C --> F["EAR + Blink\n(face.py)"]
        C --> G["Emotions\n(emotion.py)"]
        C --> H["Head Pose\n(pose.py)"]
        C --> I["Gaze\n(gaze.py)"]
        D --> J["Fidget\n(hands.py)"]
        E --> K["Posture\n(pose.py)"]
        F & G & H & I & J & K --> L["Meta-Signals\n(stress.py)"]
        L --> M["EMA Smoothing\n(smoothing.py)"]
    end

    M --> N["FrameResult\n(schema.py)"]
    N -->|"JSON"| O["StressHUD\n(React overlay)"]
    N --> P["SessionStorage\n(aggregate on end)"]
```

---

## Directory Tree

```
MockMentor/
├── app/
│   ├── layout.tsx                  ← Root layout + font + theme + Clerk
│   ├── page.tsx                    ← Landing page
│   ├── globals.css
│   ├── interview/
│   │   ├── new/page.tsx            ← Interview setup wizard
│   │   └── [id]/page.tsx           ← Live interview session
│   ├── report/
│   │   └── [id]/page.tsx           ← Report viewer
│   ├── test-speech/page.tsx        ← Speech API debug page
│   └── api/
│       ├── upload-resume/          ← Appwrite file upload + PDF parse
│       ├── process-job/            ← Gemini/Groq job description analysis
│       ├── process-resume/         ← Gemini/Groq resume analysis
│       ├── create-interview/       ← MongoDB interview record creation
│       ├── interview/              ← Interview fetch/update
│       ├── interview-session/      ← Session state management
│       ├── ai-chat/                ← Real-time AI question generation
│       ├── generate-report/        ← Post-interview report synthesis
│       └── user-profile/           ← User data CRUD
│
├── components/
│   ├── ui/                         ← Shadcn/Radix primitives
│   │   ├── button, card, badge, progress
│   │   ├── avatar, input, scroll-area
│   │   ├── separator, alert-dialog
│   ├── magicui/
│   │   └── marquee.tsx             ← Animated logo marquee
│   ├── logic/                      ← Voice interview state machine
│   │   ├── VoiceInterviewContext.tsx
│   │   ├── useVoiceInterview.ts
│   │   └── index.ts
│   ├── interview/
│   │   └── StressHUD.tsx           ← Real-time stress/emotion overlay
│   ├── navbar.tsx
│   ├── hero-section.tsx
│   ├── features-section.tsx
│   ├── demos-section.tsx
│   ├── mentors.tsx
│   ├── footer.tsx
│   ├── interview.tsx               ← Main interview UI shell
│   ├── interview-complete.tsx      ← Post-interview screen (glassmorphic)
│   ├── interview-report.tsx        ← Full report renderer
│   ├── loading-skeleton.tsx
│   ├── section-heading.tsx
│   └── theme-provider.tsx
│
├── hooks/
│   ├── useSpeechToText.ts          ← Web Speech API (STT)
│   ├── useTextToSpeech.ts          ← SpeechSynthesis API (TTS)
│   └── useFaceTracker.ts           ← WebSocket bridge → ML sidecar
│
├── lib/
│   ├── gemini.ts                   ← Gemini AI client (multi-model fallback)
│   ├── groq.ts                     ← Groq AI client (multi-model fallback)
│   ├── mlSidecar.ts                ← ML sidecar URL config + TS types
│   ├── appwrite.ts                 ← Appwrite auth & storage
│   ├── mongodb.ts                  ← Mongoose connection
│   ├── pdf.ts                      ← PDF text extraction
│   ├── promptHelper.ts             ← Prompt builder utilities
│   ├── prompts.json                ← All AI prompt templates
│   ├── appConfig.ts                ← Global app config
│   ├── utils.ts                    ← Shared utilities
│   └── models/
│       ├── Interview.ts
│       ├── InterviewReport.ts
│       ├── InterviewSession.ts
│       └── User.ts
│
├── model/                          ← Python ML Sidecar (deployed on Render)
│   ├── server.py                   ← FastAPI WebSocket server + debug dashboard
│   ├── schema.py                   ← FrameResult dataclass (canonical output)
│   ├── storage.py                  ← Per-session frame aggregation
│   ├── new.py                      ← Standalone CV stress detection script
│   ├── tracker/                    ← Modular CV pipeline
│   │   ├── __init__.py             ← Pipeline orchestrator
│   │   ├── face.py                 ← Face landmarks + Eye Aspect Ratio
│   │   ├── emotion.py              ← 7-class emotion classifier (blendshapes)
│   │   ├── gaze.py                 ← Iris-based gaze offset
│   │   ├── hands.py                ← Hand fidget detection
│   │   ├── pose.py                 ← Head pose decomposition + posture
│   │   ├── stress.py               ← Composite stress/meta-signal scorer
│   │   └── smoothing.py            ← EMA + windowed smoothing filters
│   ├── models/                     ← MediaPipe .task model files
│   │   ├── face_landmarker.task
│   │   ├── hand_landmarker.task
│   │   └── pose_landmarker_lite.task
│   ├── data/                       ← Sample stress data snapshots
│   ├── Dockerfile                  ← Docker image for Render deployment
│   ├── render.yaml                 ← Render service configuration
│   └── requirements.txt            ← Python dependencies
│
├── middleware.ts                   ← Clerk auth guard (Next.js edge)
├── next.config.ts
├── package.json
├── tsconfig.json
└── render.yaml                     ← Root Render config (ML sidecar service)
```

---

## Data Flow Summary

| Phase | User Action | Client | API Route / Service | Backend |
|---|---|---|---|---|
| **Setup** | Upload resume | `interview/new` | `upload-resume` | Appwrite + PDF parser |
| **Setup** | Paste job URL/desc | `interview/new` | `process-job` | Gemini → Groq fallback |
| **Setup** | Submit form | `interview/new` | `process-resume` + `create-interview` | Gemini → Groq, MongoDB |
| **Interview** | Session start | `interview/[id]` | `interview-session` | MongoDB |
| **Interview** | Speak answer | `useVoiceInterview` → STT hook | `ai-chat` | Gemini → Groq fallback |
| **Interview** | Hear question | TTS hook | — | SpeechSynthesis API |
| **Interview** | Camera frames | `useFaceTracker` → WebSocket | ML Sidecar `/ws/{id}` | MediaPipe Pipeline |
| **Interview** | See stress overlay | `StressHUD` component | — | FrameResult from sidecar |
| **Finish** | End interview | `interview/[id]` | `generate-report` | Gemini → Groq, MongoDB |
| **Finish** | ML summary | `useFaceTracker.requestSummary()` | ML Sidecar `cmd:summary` | SessionStorage aggregate |
| **Review** | View report | `report/[id]` | `generate-report GET` | MongoDB |

---

## AI Service Mapping

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           AI / ML SERVICE MAPPING                               │
├──────────────────────────┬──────────────────────────────────────────────────────┤
│  Gemini 2.0 Flash        │  Primary AI: resume summary, job analysis,          │
│  (→ 1.5 Flash → 1.5 Pro) │  interview Q&A, welcome message, report generation  │
├──────────────────────────┼──────────────────────────────────────────────────────┤
│  Groq (LLaMA 3.1 8B      │  Fallback AI: all the same tasks when Gemini       │
│  → LLaMA 3.3 70B)        │  is rate-limited or unavailable                     │
├──────────────────────────┼──────────────────────────────────────────────────────┤
│  Browser Web Speech API  │  Speech-to-Text (STT): zero-latency transcription  │
│                          │  Text-to-Speech (TTS): AI voice output              │
├──────────────────────────┼──────────────────────────────────────────────────────┤
│  MediaPipe (ML Sidecar)  │  Face landmarks (468 pts), hand tracking (21 pts),  │
│  Python / FastAPI        │  pose estimation (33 pts), emotion classification,  │
│  Deployed on Render      │  blink detection, gaze tracking, stress scoring     │
└──────────────────────────┴──────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

```mermaid
graph LR
    subgraph "Vercel / Next.js"
        A["Next.js 15\n(App Router)"]
    end

    subgraph "Render (Docker)"
        B["ML Sidecar\n(FastAPI + MediaPipe)"]
    end

    subgraph "External Services"
        C["MongoDB Atlas"]
        D["Appwrite Cloud"]
        E["Clerk Auth"]
        F["Gemini API"]
        G["Groq API"]
    end

    A -->|"HTTPS"| C
    A -->|"HTTPS"| D
    A -->|"HTTPS"| E
    A -->|"HTTPS"| F
    A -->|"HTTPS"| G
    A -.->|"WebSocket\n(browser → Render)"| B
```

---

> **Ignored:** `node_modules/`, `.next/`, `.git/`, `__pycache__/`, `*.generated.py`
