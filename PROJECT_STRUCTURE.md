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
│   │   └── sessionAuth.ts
│   ├── routes/
│   │   ├── n8nRoutes.ts
│   │   ├── dashboardRoutes.ts
│   │   ├── authRoutes.ts
│   │   ├── draftsRoutes.ts
│   │   ├── eventsRoutes.ts
│   │   └── healthRoutes.ts
│   ├── services/
│   │   ├── n8nService.ts
│   │   └── eventBus.ts
│   ├── types/
│   │   ├── session.d.ts
│   │   └── better-sqlite3-session-store.d.ts
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
The entry point and wiring diagram. It boots the app in a specific order: load config → initialize DB → mount session middleware → mount routes → listen on the port. Contains almost no logic itself — just imports and calls functions defined elsewhere. No cron job startup; approval detection has been removed from the lifecycle.

### `src/config.ts`
Loads every environment variable the app needs via `dotenv` and exports them as a typed `config` object. If any required variable is missing, it logs which one and exits with code 1 before the server starts. This prevents the "works in dev, crashes in prod on the first request" failure mode. Exports `SESSION_SECRET`; no longer exports `HOOTSUITE_API_TOKEN`, `HOOTSUITE_API_BASE`, or `hootsuiteProfiles`.

---

### `src/db/connection.ts`
Opens the SQLite database file using `better-sqlite3` and exports a single shared `db` instance. Also creates the `data/` directory if it doesn't exist. Sets WAL mode (better concurrent reads) and enables foreign key enforcement (SQLite ignores FK constraints by default).

### `src/db/schema.ts`
Runs `CREATE TABLE IF NOT EXISTS` for all tables on startup. No migration framework — just a single `db.exec` call. The `hootsuite_post_tracker` and `calendar_cache` tables are gone; a `drafts` table with three indexes has been added in their place.

### `src/db/queries.ts`
Every SQL query the app uses, exported as named functions. Centralizing all SQL here means: easy to audit what hits the database, no scattered query strings across route files, and a single place to add error handling if needed. All functions are synchronous (better-sqlite3 doesn't use promises). Hootsuite and calendar queries have been removed. Draft CRUD is now here: `insertDrafts`, `getDrafts`, `getDraftById`, `updateDraftContent`, `updateDraftStatus`, `markDraftReady`, `markDraftAsDraft`, `deleteDraft`. Also exports the `ALLOWED_PLATFORMS` constant and the `isAllowedPlatform` helper.

---

### `src/middleware/apiSecret.ts`
Checks the `X-API-Secret` header on every n8n-facing request. If the header matches `N8N_SHARED_SECRET` from the env, the request proceeds. If not, returns 401. Applied as a router-level middleware in `n8nRoutes.ts`.

### `src/middleware/sessionAuth.ts`
Session cookie protection for dashboard-facing routes. Checks `req.session.user` set by the login endpoint — if it is absent, returns 401. Replaces the old `basicAuth.ts` middleware. Applied per-route in `dashboardRoutes.ts`.

---

### `src/routes/healthRoutes.ts`
Single `GET /health` route with no authentication. Returns `{ status: 'ok', timestamp }`. Used by uptime monitors and Docker health checks.

### `src/routes/n8nRoutes.ts`
The endpoints that n8n calls: push weekly topics and read published topics. The `/api/drafts-ready` route has been removed. Emits a `topicsEvents` event after a successful weekly-topics insert so the SSE stream can push updates to connected dashboard clients.

### `src/routes/dashboardRoutes.ts`
The endpoints the React frontend calls: list topics, get pipeline status, get calendar data, and trigger generation. Now protected by `sessionAuthMiddleware` instead of Basic Auth. The `/api/calendar` endpoint is a stub returning `{ data: [], note: "..." }`. The generate handler emits `topicsEvents` events in addition to firing the n8n webhook.

### `src/routes/authRoutes.ts`
Authentication endpoints: `POST /api/login`, `POST /api/logout`, `GET /api/me`. The login endpoint validates credentials and sets `req.session.user`; logout destroys the session. These are the only routes that touch session creation and teardown directly.

### `src/routes/draftsRoutes.ts`
All draft management in one router. Handles both the n8n-facing intake (`POST /api/drafts`) and every dashboard-facing operation (`GET`, `PATCH`, `POST`, `DELETE` under `/api/drafts/*`). Keeping both sides in one file makes it easy to see the full lifecycle of a draft.

### `src/routes/eventsRoutes.ts`
Server-Sent Events streams for the dashboard. `GET /api/events/topics` and `GET /api/events/drafts` keep connections open and forward events from the in-memory event bus. Clients reconnect automatically if the stream drops.

---

### `src/services/n8nService.ts`
Wraps the outbound webhook POST to n8n's Flow 2. Sends the topic payload and the shared secret header. The route handler calls this fire-and-forget style — it `.catch()`es errors rather than `await`ing them, so the client gets its 202 before the n8n call completes.

### `src/services/eventBus.ts`
In-memory pub/sub using Node's built-in `EventEmitter`. Exports two emitters: `topicsEvents` and `draftsEvents`. Route handlers emit on these; the SSE routes subscribe to them. No external broker needed for this workload — if the process restarts, SSE clients reconnect and get fresh state on the next event.

---

### `src/types/session.d.ts`
TypeScript module augmentation that adds `user?: { username: string }` to `express-session`'s `SessionData` interface. Without this, accessing `req.session.user` produces a type error. Nothing to import — the declaration file is picked up automatically by the compiler.

### `src/types/better-sqlite3-session-store.d.ts`
Hand-written type declaration for the `better-sqlite3-session-store` npm package, which ships without types. Declares the module shape so TypeScript does not fall back to `any` when the store is instantiated in `index.ts`.

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
| `axios` | HTTP client for outbound calls to n8n. Chosen over `fetch` for its built-in timeout support and clean error objects. |
| `express-session` | Session middleware. Stores a signed session cookie on the client; session data lives server-side in SQLite via the store below. |
| `better-sqlite3-session-store` | Persists express-session data in the existing SQLite database. No separate Redis or Postgres needed for session storage at this scale. |

### Dev dependencies

| Package | Why it's here |
|---------|--------------|
| `typescript` | The compiler. |
| `tsx` | Runs TypeScript directly without a build step, with file watching. Used only in `npm run dev`. |
| `@types/express` | Type definitions for Express 4.x. |
| `@types/better-sqlite3` | Type definitions for better-sqlite3. |
| `@types/node` | Type definitions for Node.js built-ins (fs, path, etc.). |
| `@types/express-session` | Type definitions for express-session. |
