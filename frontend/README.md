# KickClip

KickClip is an AI-powered football highlight editor that helps users turn full match videos into short-form clips. Users can upload a match video, let the AI detect key moments, refine highlights through filters or agent prompts, and prepare the final clip for export.

## What It Does

- Upload football match videos in common formats such as MP4, MOV, and WebM.
- Analyze match footage to detect scenes, events, players, and highlight-worthy moments.
- Edit highlights by event type, such as goals, shots, fouls, cards, free kicks, and corner kicks.
- Create player-focused highlights from tracked player appearances.
- Use an AI assistant to request clips with natural prompts like "show only goals" or "make a 30-second short."
- Preview and configure the final export with aspect ratio, captions, and background music.

## Product Flow

1. Upload a match video and create a Match.
2. Choose or create a Project under that Match.
3. Run or reuse Match-level analysis for scene and event detection.
4. Refine the Project's ClipPlan manually or with the AI assistant.
5. Render and download Project-specific output.

## Tech Stack

- React
- Vite
- CSS
- FastAPI access/refresh token authentication
- Browser local storage for the backend-issued development session

## Getting Started

The frontend and backend live as sibling applications:

```text
프로메테우스/
├── front/
└── KickClip-backend/
```

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Run the backend in a second terminal on Apple Silicon macOS:

```bash
cd ../KickClip-backend
source .venv/bin/activate
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

For a fresh backend environment, install the macOS dependency set with
`python -m pip install -r requirements-macos.txt`. The frontend continues to
call the backend at `http://127.0.0.1:8000`; moving the folder does not change
the API URL.

The login and signup screens use the backend `/api/v1/auth` API. Create a new
account from the signup screen after applying the database migration. Passwords
must be at least eight characters and include both a letter and a number. The
frontend stores only the backend-issued session tokens and user profile; the
previous local demo-account list is no longer used.

Set `VITE_API_BASE_URL` if your backend is not running at `http://127.0.0.1:8000`.

Run the frontend unit tests:

```bash
npm test
```

Run lint and API-contract type checks:

```bash
npm run lint
npm run typecheck
```

Build for production:

```bash
npm run build
```

## Project Goal

KickClip is designed to make sports video editing faster and more approachable. Instead of manually scrubbing through a full match, users can rely on AI-assisted detection and simple editing controls to create polished football highlight clips.
