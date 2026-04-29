# Content Bot Backend

## What this is

A small Node.js + TypeScript + Express API that sits between n8n, the DevSpot Content Bot dashboard, and a SQLite database. Its job is to hold state (the week's topic suggestions, published topics for dedup, content drafts), forward webhook triggers to n8n when Sabeen clicks "Generate", receive the finished drafts back from n8n, and push live updates to the dashboard via Server-Sent Events. It does not call Claude directly (n8n does that) and it does not serve any UI (the React frontend does that).

---

## Architecture

```
┌───────────────┐     POST /api/weekly-topics      ┌─────────────────────┐
│               │ ────────────────────────────────▶ │                     │
│     n8n       │     GET  /api/published-topics    │  content-bot-       │
│  (automation) │ ◀──────────────────────────────── │  backend            │
│               │     POST /api/drafts              │  (this service)     │
│               │ ────────────────────────────────▶ │                     │
└───────────────┘                                   │  SQLite DB          │
                                                    │  (./data/)          │
┌───────────────┐     POST /api/login               │                     │
│               │ ────────────────────────────────▶ │                     │
│  React        │     GET  /api/topics              │                     │
│  Dashboard    │ ────────────────────────────────▶ │                     │
│  (frontend)   │     GET  /api/status              │                     │
│               │ ────────────────────────────────▶ │                     │
│               │     GET  /api/calendar            │                     │
│               │ ────────────────────────────────▶ │                     │
│               │     POST /api/generate            │                     │
│               │ ────────────────────────────────▶ │                     │
│               │     GET  /api/drafts              │                     │
│               │ ────────────────────────────────▶ │                     │
│               │     PATCH /api/drafts/:id         │                     │
│               │ ────────────────────────────────▶ │                     │
│               │                                   │                     │
│               │ ◀──────────────────────────────── │                     │
│               │  GET /api/events/topics  (SSE)    │                     │
│               │ ◀──────────────────────────────── │                     │
│               │  GET /api/events/drafts  (SSE)    │                     │
└───────────────┘                                   └─────────────────────┘
```

**Auth model:**
- n8n-facing routes (`/api/weekly-topics`, `/api/drafts`, `/api/published-topics`) → `X-API-Secret` header
- Dashboard-facing routes (`/api/topics`, `/api/status`, `/api/calendar`, `/api/generate`, `/api/drafts/*`, `/api/events/*`) → session cookie (set by `POST /api/login`)
- `/health` → no auth

---

## Prerequisites

- **Node.js 20 LTS** (`node -v` should show `v20.x.x`)
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
#   N8N_FLOW_2_WEBHOOK_URL → your n8n webhook URL
# The generated secrets (N8N_SHARED_SECRET, SESSION_SECRET, DASHBOARD_PASSWORD) are already strong.

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
n8n calls this every Monday to push the week's 5 topic suggestions. Clears the previous week's topics and inserts the new ones atomically. Emits a `weekly_topics_replaced` event on the topics SSE stream.

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

#### `POST /api/drafts`
n8n calls this after Flow 2 finishes generating content. Inserts the drafts into SQLite, updates the topic status to `drafts_ready`, and emits a `drafts_added` event on the drafts SSE stream.

**Request:**
```json
{
  "topic_id": 3,
  "topic_title": "AI in Healthcare",
  "drafts": [
    {
      "platform": "linkedin_devspot",
      "brand": "devspot",
      "content": "Draft content here..."
    },
    {
      "platform": "x_sabeen",
      "brand": "sabeen",
      "content": "Draft content here..."
    }
  ]
}
```

`topic_id` is nullable — custom topics that Sabeen typed in have no `weekly_topics` row. `topic_title` is always required and is stored denormalized so drafts survive the Monday weekly_topics clear.

**Response:**
```json
{ "status": "ok", "inserted": 7 }
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

### Group B — Dashboard-facing (session cookie)

#### Auth endpoints

##### `POST /api/login`
Validates credentials against the `DASHBOARD_USER` and `DASHBOARD_PASSWORD` env vars. On success, creates a server-side session and sets an httpOnly cookie in the browser. The cookie lasts 7 days.

**Request:**
```json
{ "username": "sabeen", "password": "..." }
```

**Response:**
```json
{ "status": "ok", "username": "sabeen" }
```

---

##### `POST /api/logout`
Destroys the server-side session and clears the cookie.

**Response:**
```json
{ "status": "ok" }
```

---

##### `GET /api/me`
Returns 200 if the session cookie is valid, 401 if not. The frontend calls this on page load to decide whether to show the dashboard or redirect to login.

**Response (200):**
```json
{ "username": "sabeen" }
```

---

#### Topic / pipeline endpoints

##### `GET /api/topics`
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

##### `GET /api/status`
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

##### `GET /api/calendar`
Stub endpoint. Returns an empty data set while the publishing integration decision is pending.

**Response:**
```json
{ "data": [], "note": "Calendar feature pending decision on publishing integration" }
```

---

##### `POST /api/generate`
Triggers content generation. Marks the topic as `generating`, returns 202 immediately, then fires the n8n webhook in the background. If the n8n call fails, the topic status resets to `pending` so Sabeen can retry. Emits a `topic_status_changed` event on the topics SSE stream.

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

#### Draft endpoints

##### `GET /api/drafts`
Returns a list of drafts. `original_content` is excluded from list responses to keep payloads light — fetch a single draft to get the full content.

Sorted: `ready_to_publish` drafts appear first, then `draft`, both groups sorted by `updated_at DESC`.

**Optional query params:**
- `?status=draft` or `?status=ready_to_publish` — filter by status
- `?topic_id=42` — filter by topic

**Response:**
```json
{
  "drafts": [
    {
      "id": 1,
      "topic_id": 3,
      "topic_title": "AI in Healthcare",
      "platform": "linkedin_devspot",
      "brand": "devspot",
      "current_content": "...",
      "status": "draft",
      "created_at": "2026-04-20 09:00:00",
      "updated_at": "2026-04-20 09:00:00"
    }
  ]
}
```

---

##### `GET /api/drafts/:id`
Returns a single draft including `original_content` and `current_content`. Returns 404 if the draft does not exist.

---

##### `PATCH /api/drafts/:id`
Updates `current_content` and bumps `updated_at`. Returns the full updated draft. Emits a `draft_updated` event on the drafts SSE stream.

**Request:**
```json
{ "current_content": "Edited content here..." }
```

---

##### `POST /api/drafts/:id/mark-ready`
Promotes the draft to `ready_to_publish` and records the `topic_title` in `published_topics` for dedup. No-op if the draft is already `ready_to_publish`. Emits a `draft_status_changed` event on the drafts SSE stream.

---

##### `POST /api/drafts/:id/mark-draft`
Demotes the draft back to `draft` status. Does NOT remove the entry from `published_topics`. Emits a `draft_status_changed` event on the drafts SSE stream.

---

##### `DELETE /api/drafts/:id`
Hard-deletes the draft. Emits a `draft_deleted` event on the drafts SSE stream.

**Response:**
```json
{ "status": "deleted", "id": 7 }
```

---

#### SSE streams

##### `GET /api/events/topics`
A long-lived Server-Sent Events stream for the topics page. The browser opens this connection once and receives push events whenever topic state changes.

| Event | Payload | When |
|-------|---------|------|
| `weekly_topics_replaced` | `{ count, week_start_date }` | n8n pushes new topics |
| `topic_status_changed` | `{ topic_id, status }` | Generate is triggered or fails |

---

##### `GET /api/events/drafts`
A long-lived Server-Sent Events stream for the drafts page.

| Event | Payload | When |
|-------|---------|------|
| `drafts_added` | `{ topic_id, topic_title, count }` | n8n posts finished drafts |
| `draft_updated` | Full draft object | PATCH is applied |
| `draft_status_changed` | Full draft object | mark-ready or mark-draft |
| `draft_deleted` | `{ id }` | DELETE is called |

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
The dedup list. A topic lands here when Sabeen marks at least one of its drafts as ready to publish.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `title` | TEXT | Original topic title |
| `topic_hash` | TEXT UNIQUE | Normalized lowercase title for dedup |
| `published_at` | TEXT | UTC datetime |
| `brand` | TEXT | `sabeen` / `devspot` / `polaris` / NULL |

### `drafts`
Stores the content drafts produced by n8n. One row per platform per topic.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `topic_id` | INTEGER | Nullable — custom topics have no `weekly_topics` row |
| `topic_title` | TEXT | Denormalized — survives the Monday `weekly_topics` clear |
| `platform` | TEXT | One of: `longform_mirror`, `linkedin_sabeen`, `linkedin_devspot`, `x_sabeen`, `x_devspot`, `x_polaris`, `substack` |
| `brand` | TEXT | `sabeen` / `devspot` / `polaris` / NULL |
| `original_content` | TEXT | What Claude produced. Written once, never changed. |
| `current_content` | TEXT | What Sabeen edits. Starts as a copy of `original_content`. |
| `status` | TEXT | `draft` → `ready_to_publish` |
| `created_at` | TEXT | UTC datetime |
| `updated_at` | TEXT | UTC datetime — updated on every edit |

### `sessions`
Server-side session store for dashboard login. Managed automatically by the session middleware.

| Column | Type | Notes |
|--------|------|-------|
| `sid` | TEXT PK | Session ID (opaque string) |
| `sess` | TEXT | JSON-encoded session data |
| `expired` | TEXT | Expiry datetime — expired rows are pruned automatically |

---

## Real-time updates (SSE)

Server-Sent Events (SSE) is a browser standard where the server pushes updates to the browser over a long-lived HTTP connection, without the browser having to poll.

**Why we use it:** The topics page needs to know immediately when n8n finishes pushing a new batch of topics. The drafts page needs to know when n8n finishes writing drafts, and when another browser tab edits or marks a draft ready. Polling would add unnecessary latency and server load.

**Why two separate streams:** The topics page and the drafts page subscribe to different data. Keeping the streams separate means each page only receives events it cares about, and the connection stays lightweight. It also makes it easier to add stream-specific auth or filtering later.

**What each stream emits:** See the `GET /api/events/topics` and `GET /api/events/drafts` endpoint descriptions in the API reference above.

**Why cookies are needed for SSE:** The browser's `EventSource` API cannot set custom request headers, so the `X-API-Secret` pattern used for n8n routes does not work. Session cookies are sent automatically with every request including SSE connections, which is why dashboard-facing routes use cookie-based auth instead of a header.

**Reconnect behavior:** `EventSource` reconnects automatically after a server restart or network hiccup. Any events emitted during the gap are lost — the browser does not receive a replay. This is acceptable for Phase 1; the dashboard will be slightly stale until the next event arrives, at which point it re-syncs.

---

## Auth

Dashboard authentication uses server-side sessions backed by SQLite.

- `POST /api/login` validates the submitted `username` and `password` against the `DASHBOARD_USER` and `DASHBOARD_PASSWORD` environment variables
- On success, a session record is written to the `sessions` table and the browser receives an httpOnly cookie containing the session ID
- The cookie is `httpOnly` (JavaScript cannot read it), `sameSite=lax`, and `secure=true` in production
- Sessions expire after 7 days of inactivity
- `GET /api/me` lets the frontend check on page load whether the current session is still valid — 200 means logged in, 401 means the session is gone or expired
- Any protected endpoint that returns 401 should be treated by the frontend as a signal to redirect to the login page

n8n-facing routes continue to use the `X-API-Secret` header, unchanged.

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
5. Set up nginx as a reverse proxy pointing to port 3000 (also handles HTTPS via Let's Encrypt — required for secure cookies in production)

**Persistent data:** The SQLite file is at `/opt/content-bot/data/content-bot.db` on the host. Back this up before updates.

---

## Manual testing guide

Run these in order to verify a fresh deployment end-to-end. The cookie jar file (`/tmp/cbot-cookies.txt`) persists the session across commands.

```bash
# 1. Health check — no auth required
curl http://localhost:3000/health

# Expected: { "status": "ok", "timestamp": "..." }

# ──────────────────────────────────────────────────────────────────────────────
# Set up variables for the rest of the tests
SECRET="8a3f1829b4240e2a02483aa2b6e62326aff35d02fa31fe62c53c2be89e490c98"
COOKIES="/tmp/cbot-cookies.txt"

# 2. Login — saves session cookie to file
curl -s -c "$COOKIES" -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "sabeen", "password": "rGmmj99qqWKUr3bn7ZIAj6A" }'

# Expected: { "status": "ok", "username": "sabeen" }

# 3. Check session is valid
curl -s -b "$COOKIES" http://localhost:3000/api/me

# Expected: { "username": "sabeen" }

# 4. Push weekly topics (as n8n would on Monday)
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

# 5. Fetch topics as the dashboard would
curl -s -b "$COOKIES" http://localhost:3000/api/topics | python3 -m json.tool

# Expected: { "topics": [ ...5 rows with status "pending"... ] }

# 6. Check pipeline status
curl -s -b "$COOKIES" http://localhost:3000/api/status

# Expected: { "status": "idle", "topic_count": 5 }

# 7. Trigger generation for topic 1
curl -s -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -b "$COOKIES" \
  -d '{ "topic_id": 1 }'

# Expected: { "status": "generation_started", "topic_id": 1 }
# (n8n call will fail if N8N_FLOW_2_WEBHOOK_URL isn't real — check server logs)

# 8. Post drafts (as n8n would after Flow 2 finishes)
curl -s -X POST http://localhost:3000/api/drafts \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $SECRET" \
  -d '{
    "topic_id": 1,
    "topic_title": "AI in Healthcare",
    "drafts": [
      { "platform": "linkedin_devspot", "brand": "devspot", "content": "LinkedIn DevSpot draft content..." },
      { "platform": "linkedin_sabeen",  "brand": "sabeen",  "content": "LinkedIn Sabeen draft content..." },
      { "platform": "x_devspot",        "brand": "devspot", "content": "X DevSpot draft content..." },
      { "platform": "x_sabeen",         "brand": "sabeen",  "content": "X Sabeen draft content..." },
      { "platform": "x_polaris",        "brand": "polaris", "content": "X Polaris draft content..." },
      { "platform": "substack",         "brand": "sabeen",  "content": "Substack draft content..." },
      { "platform": "longform_mirror",  "brand": "devspot", "content": "Longform mirror draft content..." }
    ]
  }'

# Expected: { "status": "ok", "inserted": 7 }

# 9. List all drafts
curl -s -b "$COOKIES" http://localhost:3000/api/drafts | python3 -m json.tool

# Expected: { "drafts": [ ...7 rows... ] }

# 9b. List drafts filtered by status
curl -s -b "$COOKIES" "http://localhost:3000/api/drafts?status=draft"

# 9c. List drafts for a specific topic
curl -s -b "$COOKIES" "http://localhost:3000/api/drafts?topic_id=1"

# 10. Fetch one draft (includes original_content)
curl -s -b "$COOKIES" http://localhost:3000/api/drafts/1 | python3 -m json.tool

# 11. Edit a draft
curl -s -X PATCH http://localhost:3000/api/drafts/1 \
  -H "Content-Type: application/json" \
  -b "$COOKIES" \
  -d '{ "current_content": "Edited content that Sabeen improved..." }'

# Expected: full updated draft object

# 12. Mark as ready to publish
curl -s -X POST http://localhost:3000/api/drafts/1/mark-ready \
  -b "$COOKIES"

# Expected: updated draft with status "ready_to_publish"

# 13. Mark back as draft
curl -s -X POST http://localhost:3000/api/drafts/1/mark-draft \
  -b "$COOKIES"

# Expected: updated draft with status "draft"

# 14. Delete a draft
curl -s -X DELETE http://localhost:3000/api/drafts/1 \
  -b "$COOKIES"

# Expected: { "status": "deleted", "id": 1 }

# 15. Open SSE stream — Ctrl+C to stop
curl -N -b "$COOKIES" http://localhost:3000/api/events/topics
# In another terminal, push new topics or trigger generate to see events arrive

curl -N -b "$COOKIES" http://localhost:3000/api/events/drafts
# In another terminal, post drafts or edit one to see events arrive

# 16. Logout
curl -s -X POST http://localhost:3000/api/logout \
  -b "$COOKIES" -c "$COOKIES"

# Expected: { "status": "ok" }

# 17. Verify 401 after logout
curl -s -b "$COOKIES" http://localhost:3000/api/topics

# Expected: HTTP 401 — session is gone

# 18. Verify n8n secret guard still works (no secret header)
curl -s -X GET http://localhost:3000/api/published-topics

# Expected: { "error": "Unauthorized" } with HTTP 401

# 18b. With the correct secret header
curl -s -H "X-API-Secret: $SECRET" http://localhost:3000/api/published-topics

# Expected: { "topics": [ ... ] }
```

---

## Troubleshooting

### SQLite "unable to open database file"
The `data/` directory doesn't exist or the process doesn't have write permission.
- Fix: `mkdir -p ./data && chmod 755 ./data`
- In Docker: ensure the host directory exists before mounting: `mkdir -p /opt/content-bot/data`

### SSE connection drops immediately
The browser is not sending a valid session cookie. Make sure you are logged in via `POST /api/login` before opening the SSE stream. In curl, pass `-b "$COOKIES"` with the cookie jar file.

### SSE not receiving events in production
If you are running behind Nginx, check that response buffering is disabled for the SSE routes. Nginx buffers responses by default, which breaks streaming. Add these directives to the relevant Nginx location block:
```
proxy_buffering off;
add_header X-Accel-Buffering no;
```

### EventSource reconnects on every server restart — events during restart are lost
This is expected behavior for Phase 1. `EventSource` reconnects automatically, but events emitted while the connection was down are not replayed. The dashboard will be slightly stale until the next event arrives and re-syncs the UI. This is an acceptable tradeoff for the current phase.

### n8n webhook unreachable (ECONNREFUSED or ETIMEDOUT)
The `N8N_FLOW_2_WEBHOOK_URL` is wrong or n8n is down.
- The generate endpoint already returned 202, so the client won't see the error
- The topic status will be reset to `pending` automatically — Sabeen can click Generate again
- Check server logs for the full error. Look for `n8n trigger failed`

### Topics show up as "pending" after clicking Generate
Almost always means the n8n webhook call failed (see above). Check logs.

### Server won't start — "Missing required environment variable"
The log will tell you exactly which variable is missing. Copy `.env.example` to `.env` and fill in every value. Make sure `SESSION_SECRET` is set — it is required for the session middleware to initialize.
