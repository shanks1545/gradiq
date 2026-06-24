# GradiQ

Smart test management and AI-powered grading for educators. Teachers create MCQ tests, set answer keys, then upload photos of student answer sheets — Claude AI extracts answers and grades them automatically.

## Features

- JWT-authenticated teacher accounts
- Create tests with configurable questions and marks
- Visual answer key editor (A/B/C/D grid)
- AI-powered grading via photo upload (Claude vision)
- Results dashboard with class statistics, ranking, and grade pills
- Inline score override for manual mark adjustments
- PDF report generation per student
- WhatsApp result sharing
- Fully mobile responsive

## Local Development

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
GRADIQ_SECRET_KEY=your-secret-key
```

Run the server:

```bash
python main.py
```

Open http://localhost:8000 in your browser.

## Deploy to Render

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) and create a **New Web Service**.
3. Connect your GitHub repo.
4. Render will auto-detect `render.yaml`. If not, use these settings:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add the environment variable `ANTHROPIC_API_KEY` with your API key.
6. `GRADIQ_SECRET_KEY` is auto-generated via `render.yaml`.
7. Deploy.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI grading |
| `GRADIQ_SECRET_KEY` | No | JWT signing secret (auto-generated on Render, defaults to dev value locally) |
| `PORT` | No | Server port (default: 8000, set automatically by Render) |
| `DB_PATH` | No | SQLite database path (default: `gradiq.db`) |

## Tech Stack

- **Backend:** FastAPI + SQLite + Anthropic Claude API
- **Frontend:** Vanilla HTML/CSS/JS (single-page app)
- **Auth:** JWT with bcrypt password hashing
- **PDF:** ReportLab
