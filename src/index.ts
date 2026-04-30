/**
 * index.ts — entry point
 * -----------------------
 * This is where the app boots. Think of it as the wiring diagram:
 * it imports from every other module but contains almost no logic itself.
 *
 * Boot order matters:
 *   1. Config loads first (exits immediately if any required env var is missing)
 *   2. DB connection opens and tables are created
 *   3. Express middleware is set up (CORS, JSON parsing, session cookies)
 *   4. Routes are registered
 *   5. HTTP server starts listening
 */

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import { config } from './config';
import { db } from './db/connection';
import { initSchema } from './db/schema';
import healthRoutes from './routes/healthRoutes';
import authRoutes from './routes/authRoutes';
import n8nRoutes from './routes/n8nRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import draftsRoutes from './routes/draftsRoutes';
import eventsRoutes from './routes/eventsRoutes';
import { logger } from './utils/logger';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// credentials: true is required for the browser to send session cookies cross-origin.
// We can't use origin: '*' with credentials, so we maintain an explicit allow-list.
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Secret'],
  })
);

// Parse JSON request bodies
app.use(express.json());

// ─── Session middleware ────────────────────────────────────────────────────────
// Sessions are stored in the same SQLite database as the rest of the app.
// The SqliteStore creates a 'sessions' table automatically on startup.
const SqliteStore = SqliteStoreFactory({ Store: session.Store });

app.use(
  session({
    store: new SqliteStore({ client: db }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Only mark cookies as Secure in production — localhost doesn't use HTTPS
      secure: process.env.COOKIE_SECURE === 'true', // config.nodeEnv === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────
// Order matters: health check first (no auth), then the rest

app.use('/', healthRoutes);       // GET /health — no auth
app.use('/api', authRoutes);      // POST /api/login, /api/logout, GET /api/me
app.use('/api', n8nRoutes);       // n8n-facing routes (X-API-Secret auth)
app.use('/api', dashboardRoutes); // dashboard-facing routes (session cookie auth)
app.use('/api', draftsRoutes);    // draft management (mixed auth — see file)
app.use('/api', eventsRoutes);    // SSE streams (session cookie auth)

// ─── Boot ─────────────────────────────────────────────────────────────────────

initSchema();

app.listen(config.port, () => {
  logger.info(`Content Bot backend running on port ${config.port} [${config.nodeEnv}]`);
});

export default app;
