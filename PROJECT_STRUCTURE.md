# Project Structure

A file-by-file guide to the Content Bot backend. Read this when you're new to the codebase or trying to figure out where something lives.

---

## Directory overview

```
content-bot-backend/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── db/
│   │   ├── connection.ts
│   │   ├── schema.ts
│   │   └── queries.ts
│   ├── middleware/
│   │   ├── apiSecret.ts
│   │   └── basicAuth.ts
│   ├── routes/
│   │   ├── n8nRoutes.ts
│   │   ├── dashboardRoutes.ts
│   │   └── healthRoutes.ts
│   ├── services/
│   │   ├── hootsuiteService.ts
│   │   ├── n8nService.ts
│   │   └── approvalDetector.ts
│   ├── jobs/
│   │   └── approvalJob.ts
│   └── utils/
│       ├── hash.ts
│       └── logger.ts
├── data/                  ← SQLite file lives here (gitignored)
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── package.json
├── tsconfig.json
├── PROJECT_STRUCTURE.md
└── README.md
```

---

## File-by-file reference

### `src/index.ts`
The entry point and wiring diagram. It boots the app in a specific order: load config → initialize DB → mount routes → start the cron job → listen on the port. Contains almost no logic itself — just imports and calls functions defined elsewhere.

### `src/config.ts`
Loads every environment variable the app needs via `dotenv` and exports them as a typed `config` object. If any required variable is missing, it logs which one and exits with code 1 before the server starts. This prevents the "works in dev, crashes in prod on the first request" failure mode.

---

### `src/db/connection.ts`
Opens the SQLite database file using `better-sqlite3` and exports a single shared `db` instance. Also creates the `data/` directory if it doesn't exist. Sets WAL mode (better concurrent reads) and enables foreign key enforcement (SQLite ignores FK constraints by default).

### `src/db/schema.ts`
Runs `CREATE TABLE IF NOT EXISTS` for all four tables on startup. No migration framework — just a single `db.exec` call. If the schema changes in v2, add `ALTER TABLE` statements here.

### `src/db/queries.ts`
Every SQL query the app uses, exported as named functions. Centralizing all SQL here means: easy to audit what hits the database, no scattered query strings across route files, and a single place to add error handling if needed. All functions are synchronous (better-sqlite3 doesn't use promises).

---

### `src/middleware/apiSecret.ts`
Checks the `X-API-Secret` header on every n8n-facing request. If the header matches `N8N_SHARED_SECRET` from the env, the request proceeds. If not, returns 401. Applied as a router-level middleware in `n8nRoutes.ts`.

### `src/middleware/basicAuth.ts`
HTTP Basic Auth protection for dashboard-facing routes. Uses `express-basic-auth` to handle the header parsing. Credentials come from `DASHBOARD_USER` and `DASHBOARD_PASSWORD` in the env.

---

### `src/routes/healthRoutes.ts`
Single `GET /health` route with no authentication. Returns `{ status: 'ok', timestamp }`. Used by uptime monitors and Docker health checks.

### `src/routes/n8nRoutes.ts`
The four endpoints that n8n calls: push weekly topics, report drafts ready, read published topics, and manually add a published topic. All protected by the API secret middleware. These are the "write" side of the backend.

### `src/routes/dashboardRoutes.ts`
The four endpoints the React frontend calls: list topics, get pipeline status, get calendar data, and trigger generation. All protected by Basic Auth. The `/api/generate` handler is the most complex — it returns 202 immediately and fires the n8n webhook in the background.

---

### `src/services/hootsuiteService.ts`
Wraps the one Hootsuite API call we make: `GET /v1/messages?state=SCHEDULED`. Returns typed response data. Keeping this isolated means if Hootsuite changes their auth or endpoint structure, there's exactly one file to update.

### `src/services/n8nService.ts`
Wraps the outbound webhook POST to n8n's Flow 2. Sends the topic payload and the shared secret header. The route handler calls this fire-and-forget style — it `.catch()`es errors rather than `await`ing them, so the client gets its 202 before the n8n call completes.

### `src/services/approvalDetector.ts`
The detection logic for the 15-minute job. Reads pending tracked posts from the DB, calls Hootsuite, updates the calendar cache, finds posts that moved to SCHEDULED (= approved by Sabeen), and inserts those topics into `published_topics`. Does not handle the cron scheduling itself.

---

### `src/jobs/approvalJob.ts`
The cron scheduler wrapper. Uses `node-cron` to run `runApprovalDetection()` every 15 minutes and once immediately on startup. Separation of concerns: the job file handles when to run; the service file handles what to do.

---

### `src/utils/hash.ts`
Exports `computeTopicHash(title)` — lowercases a topic title and strips non-alphanumeric characters to produce a stable dedup key. Stored as `topic_hash` in `published_topics`. The `INSERT OR IGNORE` pattern in `queries.ts` relies on this being deterministic.

### `src/utils/logger.ts`
A three-method wrapper (`info`, `warn`, `error`) that prepends an ISO timestamp to every `console.log` / `console.error` / `console.warn` call. Not a logging library — just consistent timestamps in one place.

---

## npm packages

### Production dependencies

| Package | Why it's here |
|---------|--------------|
| `express` | HTTP framework. Chosen because it's the industry standard for small Node.js APIs and has no unnecessary abstractions. |
| `better-sqlite3` | Synchronous SQLite driver. Synchronous is simpler and correct for this workload — no connection pool, no async/await ceremony. |
| `dotenv` | Loads `.env` file into `process.env` before the rest of the app runs. |
| `axios` | HTTP client for outbound calls to Hootsuite and n8n. Chosen over `fetch` for its built-in timeout support and clean error objects. |
| `express-basic-auth` | Handles the HTTP Basic Auth header parsing and comparison for dashboard routes. Saves writing that parsing manually. |
| `node-cron` | Cron scheduler for the 15-minute approval detection job. Lightweight, no external dependencies. |

### Dev dependencies

| Package | Why it's here |
|---------|--------------|
| `typescript` | The compiler. |
| `tsx` | Runs TypeScript directly without a build step, with file watching. Used only in `npm run dev`. |
| `@types/express` | Type definitions for Express 4.x. |
| `@types/better-sqlite3` | Type definitions for better-sqlite3. |
| `@types/node` | Type definitions for Node.js built-ins (fs, path, etc.). |
| `@types/node-cron` | Type definitions for node-cron. |
