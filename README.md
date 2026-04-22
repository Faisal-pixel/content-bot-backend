# Content Bot Backend

## What this is

A small Node.js + TypeScript + Express API that sits between n8n, the DevSpot Content Bot dashboard, and Hootsuite. Its job is to hold state (the week's topic suggestions, published topics for dedup, tracked Hootsuite posts), forward webhook triggers to n8n when Sabeen clicks "Generate", and detect when posts get approved in Hootsuite via a 15-minute polling job. It does not call Claude directly (n8n does that) and it does not serve any UI (the React frontend does that).

---

## Architecture

```
┌───────────────┐     POST /api/weekly-topics      ┌─────────────────────┐
│               │ ────────────────────────────────▶ │                     │
│     n8n       │     GET  /api/published-topics    │  content-bot-       │
│  (automation) │ ◀──────────────────────────────── │  backend            │
│               │     POST /api/drafts-ready        │  (this service)     │
│               │ ────────────────────────────────▶ │                     │
└───────────────┘                                   │  SQLite DB          │
                                                    │  (./data/)          │
┌───────────────┐     GET  /api/topics              │                     │
│               │ ────────────────────────────────▶ │                     │
│  React        │     GET  /api/status              │                     │
│  Dashboard    │ ────────────────────────────────▶ │                     │
│  (frontend)   │     GET  /api/calendar            │                     │
│               │ ────────────────────────────────▶ │                     │
│               │     POST /api/generate            │                     │
│               │ ────────────────────────────────▶ │                     │
└───────────────┘                                   └──────────┬──────────┘
                                                               │
                                          GET /v1/messages     │  every 15 min
                                          (approval polling)   │
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │      Hootsuite      │
                                                    │  (social scheduler) │
                                                    └─────────────────────┘
```

**Auth model:**
- n8n-facing routes (`/api/weekly-topics`, `/api/drafts-ready`, `/api/published-topics`) → `X-API-Secret` header
- Dashboard-facing routes (`/api/topics`, `/api/status`, `/api/calendar`, `/api/generate`) → HTTP Basic Auth
- `/health` → no auth

---

## Prerequisites

- **Node.js 20 LTS** (`node -v` should show `v20.x.x`)
- A **Hootsuite API bearer token** with permission to read scheduled messages
- A running **n8n instance** with a Flow 2 webhook configured at the URL you'll put in `N8N_FLOW_2_WEBHOOK_URL`
- Docker (optional — for containerized deployment)

---

## Setup

```bash
# Clone and enter the project
git clone <repo-url>
cd content-bot-backend

# Install dependencies
npm install

# Create your env file
cp .env.example .env

# Edit .env — the only values you MUST change are:
#   HOOTSUITE_API_TOKEN   → your real Hootsuite bearer token
#   N8N_FLOW_2_WEBHOOK_URL → your n8n webhook URL
# The generated secrets (N8N_SHARED_SECRET, DASHBOARD_PASSWORD) are already strong.

# Start in development mode (hot reload)
npm run dev
```

The server will log which port it's listening on. Hit `GET /health` to confirm it's up.

---

## Scripts

| Script | Command | What it does |
|--------|---------|-------------|
| `dev` | `tsx watch src/index.ts` | Starts the server with hot reload. No build step needed. |
| `build` | `tsc` | Compiles TypeScript to `./dist`. Run this before deploying. |
| `start` | `node dist/index.js` | Runs the compiled output. Used in production and Docker. |
| `typecheck` | `tsc --noEmit` | Type-checks without emitting files. Good for CI. |

---

## API reference

### Group A — n8n-facing (header: `X-API-Secret: <your-secret>`)

#### `POST /api/weekly-topics`
n8n calls this every Monday to push the week's 5 topic suggestions. Clears the previous week's topics and inserts the new ones atomically.

**Request:**
```json
{
  "week_start_date": "2026-04-20",
  "topics": [
    {
      "title": "AI in Healthcare",
      "rationale": "Growing adoption of LLMs in clinical settings",
      "tier1_source": "https://example.com/source",
      "contrarian_angle": "Most implementations are vaporware"
    }
  ]
}
```

**Response:**
```json
{ "status": "ok", "inserted": 5 }
```

---

#### `POST /api/drafts-ready`
n8n calls this after Flow 2 finishes creating Hootsuite drafts. Updates the topic status to `drafts_ready` and starts tracking the post IDs for approval detection.

**Request:**
```json
{
  "topic_id": 3,
  "hootsuite_post_ids": ["hs_abc123", "hs_def456"],
  "brand": "devspot"
}
```

**Response:**
```json
{ "status": "ok", "tracked": 2 }
```

---

#### `GET /api/published-topics`
Returns all topics in the dedup list. n8n reads this before generating suggestions.

**Response:**
```json
{
  "topics": [
    {
      "id": 1,
      "title": "AI in Healthcare",
      "topic_hash": "ai in healthcare",
      "published_at": "2026-04-15 10:30:00",
      "brand": "devspot"
    }
  ]
}
```

---

#### `POST /api/published-topics`
Manually add a topic to the published list (admin use).

**Request:**
```json
{ "title": "Prompt Engineering Tips", "brand": "sabeen" }
```

**Response:**
```json
{ "status": "ok" }
```

---

### Group B — Dashboard-facing (HTTP Basic Auth)

#### `GET /api/topics`
Returns the current week's topic cards.

**Response:**
```json
{
  "topics": [
    {
      "id": 1,
      "week_start_date": "2026-04-20",
      "title": "AI in Healthcare",
      "rationale": "...",
      "tier1_source": "https://...",
      "contrarian_angle": "...",
      "status": "pending",
      "created_at": "2026-04-20 09:00:00"
    }
  ]
}
```

---

#### `GET /api/status`
Returns the overall pipeline state derived from topic statuses.

| Condition | `status` value |
|-----------|----------------|
| No topics this week | `idle` |
| Any topic is `generating` | `generating` |
| All topics are `drafts_ready` | `drafts_ready` |
| Otherwise | `idle` |

**Response:**
```json
{ "status": "idle", "topic_count": 5 }
```

---

#### `GET /api/calendar`
Returns the cached Hootsuite scheduled-posts response. If the cache is older than 15 minutes (or doesn't exist), triggers a fresh Hootsuite fetch before responding.

**Response:** The raw Hootsuite `/v1/messages` response, as JSON.

---

#### `POST /api/generate`
Triggers content generation. Marks the topic as `generating`, returns 202 immediately, then fires the n8n webhook in the background. If the n8n call fails, the topic status resets to `pending` so the user can retry.

**Request (from a weekly topic):**
```json
{ "topic_id": 3 }
```

**Request (custom topic):**
```json
{
  "custom_topic": {
    "title": "The Future of Remote Work",
    "rationale": "Optional context",
    "tier1_source": "Optional source URL",
    "contrarian_angle": "Optional angle"
  }
}
```

**Response:**
```json
{ "status": "generation_started", "topic_id": 3 }
```

---

### Group C — Health check (no auth)

#### `GET /health`
```json
{ "status": "ok", "timestamp": "2026-04-22T10:00:00.000Z" }
```

---

## Database schema

### `weekly_topics`
Holds this week's 5 suggestions. Cleared and replaced every Monday when n8n pushes new topics.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `week_start_date` | TEXT | ISO date, e.g. `2026-04-20` |
| `title` | TEXT | Topic title |
| `rationale` | TEXT | Why this topic now |
| `tier1_source` | TEXT | Source URL |
| `contrarian_angle` | TEXT | The hook |
| `status` | TEXT | `pending` → `generating` → `drafts_ready` |
| `created_at` | TEXT | UTC datetime |

### `published_topics`
The dedup list. A topic lands here when at least one of its Hootsuite posts gets approved by Sabeen.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `title` | TEXT | Original topic title |
| `topic_hash` | TEXT UNIQUE | Normalized lowercase title for dedup |
| `published_at` | TEXT | UTC datetime |
| `brand` | TEXT | `sabeen` / `devspot` / `polaris` / NULL |

### `hootsuite_post_tracker`
Links Hootsuite post IDs back to the topic that created them. The approval detection job reads this table every 15 minutes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `hootsuite_post_id` | TEXT UNIQUE | Hootsuite's own ID for the post |
| `topic_id` | INTEGER | FK to weekly_topics.id |
| `topic_title` | TEXT | Denormalized — survives weekly_topics being cleared |
| `brand` | TEXT | `sabeen` / `devspot` / `polaris` / NULL |
| `last_known_status` | TEXT | `pending` → `approved` |
| `created_at` | TEXT | UTC datetime |

### `calendar_cache`
Single-row table. Stores the latest full Hootsuite `/v1/messages` response as a JSON blob.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Always 1 (enforced by CHECK constraint) |
| `data` | TEXT | Full Hootsuite response as JSON string |
| `updated_at` | TEXT | When this row was last written |

---

## The 15-minute job

Every 15 minutes (and once on startup), the backend:

1. Reads all rows from `hootsuite_post_tracker` where `last_known_status != 'approved'`
2. Calls `GET https://platform.hootsuite.com/v1/messages?state=SCHEDULED`
3. Stores the full response in `calendar_cache`
4. Finds any tracked post IDs that appear in the scheduled list — those are posts Sabeen approved
5. Marks those tracker rows as `approved`
6. For every topic that had at least one approved post: inserts it into `published_topics`

**Why poll instead of webhooks?** Hootsuite doesn't support outbound webhooks for post approval events on their standard plan. Polling every 15 minutes is the simplest reliable alternative.

---

## Deployment

### Build and run with Docker

```bash
# Build the image
docker build -t content-bot-backend .

# Run with the data directory mounted so SQLite survives restarts
docker run -d \
  --name content-bot \
  -p 3000:3000 \
  -v /opt/content-bot/data:/app/data \
  --env-file .env \
  content-bot-backend
```

### On Hetzner

1. SSH into your Hetzner server
2. Clone the repo to `/opt/content-bot-backend`
3. Copy `.env.example` to `.env` and fill in real values
4. Run the Docker commands above
5. Set up nginx as a reverse proxy pointing to port 3000 (also handles HTTPS via Let's Encrypt — required for Basic Auth to be secure)

**Persistent data:** The SQLite file is at `/opt/content-bot/data/content-bot.db` on the host. Back this up before updates.

---

## Manual testing guide

Run these in order to verify a fresh deployment end-to-end.

```bash
# 1. Health check — no auth required
curl http://localhost:3000/health

# Expected: { "status": "ok", "timestamp": "..." }

# ──────────────────────────────────────────────────────────────────────────────
# Set up variables for the rest of the tests
SECRET="8a3f1829b4240e2a02483aa2b6e62326aff35d02fa31fe62c53c2be89e490c98"
BASIC="sabeen:rGmmj99qqWKUr3bn7ZIAj6A"

# 2. Push weekly topics (as n8n would on Monday)
curl -s -X POST http://localhost:3000/api/weekly-topics \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $SECRET" \
  -d '{
    "week_start_date": "2026-04-20",
    "topics": [
      {
        "title": "AI in Healthcare",
        "rationale": "LLMs entering clinical settings fast",
        "tier1_source": "https://example.com/source1",
        "contrarian_angle": "Most implementations are vaporware"
      },
      {
        "title": "The Death of the Junior Developer",
        "rationale": "AI coding tools displacing entry-level roles",
        "tier1_source": "https://example.com/source2",
        "contrarian_angle": "Actually raises the floor, not the ceiling"
      },
      {
        "title": "Prompt Engineering is Dead",
        "rationale": "Models are getting better at understanding intent",
        "tier1_source": "https://example.com/source3",
        "contrarian_angle": "Prompt craft still separates good from great outputs"
      },
      {
        "title": "Open Source AI vs. Closed Models",
        "rationale": "Llama 4 catching up to GPT-4 class performance",
        "tier1_source": "https://example.com/source4",
        "contrarian_angle": "Open weights without RLHF is a liability"
      },
      {
        "title": "AI Agents: Hype or Reality?",
        "rationale": "Agentic frameworks everywhere but few ship",
        "tier1_source": "https://example.com/source5",
        "contrarian_angle": "Reliability bar is nowhere near production-ready"
      }
    ]
  }'

# Expected: { "status": "ok", "inserted": 5 }

# 3. Fetch topics as the dashboard would
curl -s -u "$BASIC" http://localhost:3000/api/topics | python3 -m json.tool

# Expected: { "topics": [ ...5 rows with status "pending"... ] }

# 4. Check pipeline status
curl -s -u "$BASIC" http://localhost:3000/api/status

# Expected: { "status": "idle", "topic_count": 5 }

# 5. Trigger generation for topic 1
curl -s -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -u "$BASIC" \
  -d '{ "topic_id": 1 }'

# Expected: { "status": "generation_started", "topic_id": 1 }
# (n8n call will fail if N8N_FLOW_2_WEBHOOK_URL isn't real — check server logs)

# 5b. Check status again — should show "generating"
curl -s -u "$BASIC" http://localhost:3000/api/status

# 6. Simulate Flow 2 callback (as n8n would after creating Hootsuite drafts)
curl -s -X POST http://localhost:3000/api/drafts-ready \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $SECRET" \
  -d '{
    "topic_id": 1,
    "hootsuite_post_ids": ["fake-hs-id-001", "fake-hs-id-002"],
    "brand": "devspot"
  }'

# Expected: { "status": "ok", "tracked": 2 }

# 7. Check status — topic 1 is now drafts_ready, others still pending
curl -s -u "$BASIC" http://localhost:3000/api/status

# 8. Check the calendar cache (will trigger a Hootsuite fetch if cache is empty)
curl -s -u "$BASIC" http://localhost:3000/api/calendar

# 9. Read the published topics list (as n8n would for dedup)
curl -s -H "X-API-Secret: $SECRET" http://localhost:3000/api/published-topics

# 10. Manually add a published topic
curl -s -X POST http://localhost:3000/api/published-topics \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $SECRET" \
  -d '{ "title": "Old Topic We Already Covered", "brand": "devspot" }'

# Expected: { "status": "ok" }

# 11. Verify the 401 guard on n8n routes
curl -s -X GET http://localhost:3000/api/published-topics

# Expected: { "error": "Unauthorized" } with HTTP 401

# 12. Verify Basic Auth guard on dashboard routes
curl -s http://localhost:3000/api/topics

# Expected: HTTP 401 with WWW-Authenticate header
```

---

## Troubleshooting

### SQLite "unable to open database file"
The `data/` directory doesn't exist or the process doesn't have write permission.
- Fix: `mkdir -p ./data && chmod 755 ./data`
- In Docker: ensure the host directory exists before mounting: `mkdir -p /opt/content-bot/data`

### Hootsuite returns 401
Your `HOOTSUITE_API_TOKEN` is invalid or expired.
- Fix: regenerate the token in Hootsuite Developer portal and update your `.env`
- The approval job will log `Hootsuite fetch failed` every 15 minutes until fixed

### Hootsuite returns 403
The token doesn't have permission to read messages. Ensure the OAuth scope includes `hs.messages.read`.

### n8n webhook unreachable (ECONNREFUSED or ETIMEDOUT)
The `N8N_FLOW_2_WEBHOOK_URL` is wrong or n8n is down.
- The generate endpoint already returned 202, so the client won't see the error
- The topic status will be reset to `pending` automatically — Sabeen can click Generate again
- Check server logs for the full error. Look for `n8n trigger failed`

### Topics show up as "pending" after clicking Generate
Almost always means the n8n webhook call failed (see above). Check logs.

### Calendar shows stale data
The Hootsuite API call in the last polling cycle failed. Check logs for `Hootsuite fetch failed`. The cache will be updated on the next successful cycle.

### Server won't start — "Missing required environment variable"
The log will tell you exactly which variable is missing. Copy `.env.example` to `.env` and fill in every value.
