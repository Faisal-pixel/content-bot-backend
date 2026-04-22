/**
 * database queries
 * -----------------
 * Every SQL query the app uses lives here as an exported function.
 *
 * Why centralize: (1) easy to audit what hits the DB, (2) no scattered SQL
 * strings across route and service files, (3) one place to add logging or
 * error handling around DB calls if needed later.
 *
 * All functions are synchronous — better-sqlite3 doesn't use promises.
 */

import { db } from './connection';
import { computeTopicHash } from '../utils/hash';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface WeeklyTopic {
  id: number;
  week_start_date: string;
  title: string;
  rationale: string;
  tier1_source: string;
  contrarian_angle: string;
  status: string;
  created_at: string;
}

export interface PublishedTopic {
  id: number;
  title: string;
  topic_hash: string;
  published_at: string;
  brand: string | null;
}

export interface HootsuitePostTracker {
  id: number;
  hootsuite_post_id: string;
  topic_id: number;
  topic_title: string;
  brand: string | null;
  last_known_status: string;
  created_at: string;
}

// ─── weekly_topics ────────────────────────────────────────────────────────────

export interface NewWeeklyTopic {
  week_start_date: string;
  title: string;
  rationale: string;
  tier1_source: string;
  contrarian_angle: string;
}

export function clearWeeklyTopics(): void {
  db.prepare('DELETE FROM weekly_topics').run();
}

export function insertWeeklyTopics(topics: NewWeeklyTopic[]): void {
  const insert = db.prepare(`
    INSERT INTO weekly_topics (week_start_date, title, rationale, tier1_source, contrarian_angle)
    VALUES (@week_start_date, @title, @rationale, @tier1_source, @contrarian_angle)
  `);

  // Transaction: all 5 insert atomically — either all succeed or none do
  const insertAll = db.transaction((rows: NewWeeklyTopic[]) => {
    for (const row of rows) {
      insert.run(row);
    }
  });

  insertAll(topics);
}

export function getAllWeeklyTopics(): WeeklyTopic[] {
  return db.prepare('SELECT * FROM weekly_topics ORDER BY id').all() as WeeklyTopic[];
}

export function getWeeklyTopicById(id: number): WeeklyTopic | undefined {
  return db.prepare('SELECT * FROM weekly_topics WHERE id = ?').get(id) as
    | WeeklyTopic
    | undefined;
}

export function updateWeeklyTopicStatus(id: number, status: string): void {
  db.prepare('UPDATE weekly_topics SET status = ? WHERE id = ?').run(status, id);
}

// ─── published_topics ─────────────────────────────────────────────────────────

export function getAllPublishedTopics(): PublishedTopic[] {
  return db
    .prepare('SELECT * FROM published_topics ORDER BY published_at DESC')
    .all() as PublishedTopic[];
}

export function insertPublishedTopic(title: string, brand?: string): void {
  const hash = computeTopicHash(title);
  // INSERT OR IGNORE: if this hash already exists, do nothing — no error, no duplicate
  db.prepare(`
    INSERT OR IGNORE INTO published_topics (title, topic_hash, brand)
    VALUES (?, ?, ?)
  `).run(title, hash, brand ?? null);
}

// ─── hootsuite_post_tracker ───────────────────────────────────────────────────

export function insertTrackedPost(
  hootsuite_post_id: string,
  topic_id: number,
  topic_title: string,
  brand?: string
): void {
  // INSERT OR IGNORE: safe to call even if this post ID was somehow already tracked
  db.prepare(`
    INSERT OR IGNORE INTO hootsuite_post_tracker
      (hootsuite_post_id, topic_id, topic_title, brand)
    VALUES (?, ?, ?, ?)
  `).run(hootsuite_post_id, topic_id, topic_title, brand ?? null);
}

export function getPendingTrackedPosts(): HootsuitePostTracker[] {
  // "not approved" means we haven't yet confirmed Sabeen approved this post
  return db
    .prepare(`SELECT * FROM hootsuite_post_tracker WHERE last_known_status != 'approved'`)
    .all() as HootsuitePostTracker[];
}

export function updateTrackerStatus(hootsuite_post_id: string, status: string): void {
  db.prepare(
    `UPDATE hootsuite_post_tracker SET last_known_status = ? WHERE hootsuite_post_id = ?`
  ).run(status, hootsuite_post_id);
}

// ─── calendar_cache ───────────────────────────────────────────────────────────

export function getCachedCalendar(): { data: string; updated_at: string } | undefined {
  return db.prepare('SELECT data, updated_at FROM calendar_cache WHERE id = 1').get() as
    | { data: string; updated_at: string }
    | undefined;
}

export function upsertCalendarCache(data: string): void {
  db.prepare(`
    INSERT INTO calendar_cache (id, data, updated_at) VALUES (1, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(data);
}
