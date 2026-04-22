/**
 * database schema
 * ----------------
 * Runs CREATE TABLE IF NOT EXISTS for every table on app startup.
 *
 * We're not using a migration framework (like Flyway or knex migrate) because
 * this is v1 and the schema is stable. If the schema needs to change in v2,
 * add an ALTER TABLE step here rather than pulling in a full migration library.
 *
 * All four tables are created in a single db.exec call so they're applied
 * atomically — either all exist or none do.
 */

import { db } from './connection';
import { logger } from '../utils/logger';

export function initSchema(): void {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS hootsuite_post_tracker (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      hootsuite_post_id TEXT NOT NULL UNIQUE,
      topic_id          INTEGER NOT NULL,
      topic_title       TEXT NOT NULL,
      brand             TEXT,
      last_known_status TEXT NOT NULL DEFAULT 'pending',
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Single-row cache: id is always 1, enforced by the CHECK constraint
    CREATE TABLE IF NOT EXISTS calendar_cache (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  logger.info('Database schema initialized');
}
