/**
 * config module
 * -------------
 * Loads all environment variables and validates them at startup.
 *
 * Why this file exists: we want the app to fail loudly at boot if a required
 * env var is missing — not fail silently at runtime when a route is first hit.
 * Every env var the app needs is read from here; no scattered process.env
 * calls throughout the codebase.
 *
 * If requireEnv can't find a variable it logs which one is missing and exits
 * with code 1 so the process manager (Docker, systemd, PM2) knows the start failed.
 */

import dotenv from 'dotenv';
import { logger } from './utils/logger';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  n8nSharedSecret: requireEnv('N8N_SHARED_SECRET'),
  dashboardUser: requireEnv('DASHBOARD_USER'),
  dashboardPassword: requireEnv('DASHBOARD_PASSWORD'),
  sessionSecret: requireEnv('SESSION_SECRET'),

  n8nFlow2WebhookUrl: requireEnv('N8N_FLOW_2_WEBHOOK_URL'),

  dbPath: process.env['DB_PATH'] ?? './data/content-bot.db',

  // CORS — comma-separated list of allowed origins.
  // In dev, default to the Vite dev server. In prod, set this to your dashboard URL.
  corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
