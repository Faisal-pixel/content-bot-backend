/**
 * database schema
 * ----------------
 * Runs CREATE TABLE IF NOT EXISTS for every table on app startup.
 *
 * We're not using a migration framework (like Flyway or knex migrate) because
 * the schema is intentionally simple. If the schema needs to change, add
 * ALTER TABLE statements here rather than pulling in a full migration library.
 *
 * The DROP TABLE statements at the top are a one-time cleanup for tables that
 * existed in Phase 0 but are no longer used. They're safe to run repeatedly —
 * IF EXISTS means they do nothing on a fresh database.
 */

import { db } from './connection';
import { logger } from '../utils/logger';

export function initSchema(): void {
  db.exec(`
    -- Phase 0 tables removed in Phase 1: clean them up on existing deployments.
    DROP TABLE IF EXISTS hootsuite_post_tracker;
    DROP TABLE IF EXISTS calendar_cache;

    CREATE TABLE IF NOT EXISTS weekly_topics (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start_date  TEXT NOT NULL,
      title            TEXT NOT NULL,
      rationale        TEXT NOT NULL,
      tier1_source     TEXT NOT NULL,
      contrarian_angle TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS published_topics (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      topic_hash   TEXT NOT NULL UNIQUE,
      published_at TEXT NOT NULL DEFAULT (datetime('now')),
      brand        TEXT
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id          INTEGER,
      topic_title       TEXT NOT NULL,
      platform          TEXT NOT NULL,
      brand             TEXT,
      original_content  TEXT NOT NULL,
      current_content   TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'draft',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_drafts_status     ON drafts(status);
    CREATE INDEX IF NOT EXISTS idx_drafts_topic_id   ON drafts(topic_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_created_at ON drafts(created_at DESC);
  `);

  logger.info('Database schema initialized');
}
