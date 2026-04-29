/**
 * database queries
 * -----------------
 * Every SQL query the app uses lives here as an exported function.
 *
 * Why centralize: (1) easy to audit what hits the DB, (2) no scattered SQL
 * strings across route and service files, (3) one place to add error handling
 * around DB calls if needed later.
 *
 * All functions are synchronous — better-sqlite3 doesn't use promises.
 */

import { db } from './connection';
import { computeTopicHash } from '../utils/hash';

// ─── Allowed draft platform values ────────────────────────────────────────────

export const ALLOWED_PLATFORMS = [
  'longform_mirror',
  'linkedin_sabeen',
  'linkedin_devspot',
  'x_sabeen',
  'x_devspot',
  'x_polaris',
  'substack',
] as const;

export type DraftPlatform = (typeof ALLOWED_PLATFORMS)[number];

export function isAllowedPlatform(p: string): p is DraftPlatform {
  return (ALLOWED_PLATFORMS as readonly string[]).includes(p);
}

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

/** Full draft row — includes original_content. Returned by single-draft endpoints. */
export interface Draft {
  id: number;
  topic_id: number | null;
  topic_title: string;
  platform: string;
  brand: string | null;
  original_content: string;
  current_content: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Draft row without original_content — returned by the list endpoint to keep responses lean. */
export interface DraftListItem {
  id: number;
  topic_id: number | null;
  topic_title: string;
  platform: string;
  brand: string | null;
  current_content: string;
  status: string;
  created_at: string;
  updated_at: string;
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

/**
 * Insert a single custom topic submitted from the dashboard's Custom Topic input.
 * Status is set to 'generating' immediately because n8n is about to be called.
 * Returns the inserted row (including the auto-generated id) so the caller can
 * pass it to n8n.
 */
export function insertCustomTopic(input: {
  title: string;
  rationale?: string;
  tier1_source?: string;
  contrarian_angle?: string;
  week_start_date: string;
}): WeeklyTopic {
  const stmt = db.prepare(`
    INSERT INTO weekly_topics (week_start_date, title, rationale, tier1_source, contrarian_angle, status)
    VALUES (@week_start_date, @title, @rationale, @tier1_source, @contrarian_angle, 'generating')
  `);

  const result = stmt.run({
    week_start_date: input.week_start_date,
    title:            input.title,
    rationale:        input.rationale ?? '',
    tier1_source:     input.tier1_source ?? 'Custom',
    contrarian_angle: input.contrarian_angle ?? '',
  });

  const id = Number(result.lastInsertRowid);
  const row = getWeeklyTopicById(id);
  if (!row) {
    throw new Error(`insertCustomTopic: row ${id} not found after insert`);
  }
  return row;
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

export function insertPublishedTopic(title: string, brand?: string | null): void {
  const hash = computeTopicHash(title);
  // INSERT OR IGNORE: if this hash already exists, do nothing — no error, no duplicate
  db.prepare(`
    INSERT OR IGNORE INTO published_topics (title, topic_hash, brand)
    VALUES (?, ?, ?)
  `).run(title, hash, brand ?? null);
}

// ─── drafts ──────────────────────────────────────────────────────────────────

export interface NewDraftItem {
  platform: string;
  brand: string | null;
  content: string;
}

/**
 * Inserts all drafts for a generation batch in a single transaction.
 * Both original_content and current_content receive the same value on creation.
 * Returns the full inserted rows.
 */
export function insertDrafts(
  topicId: number | null,
  topicTitle: string,
  items: NewDraftItem[]
): Draft[] {
  const insert = db.prepare(`
    INSERT INTO drafts (topic_id, topic_title, platform, brand, original_content, current_content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const ids = db.transaction(() => {
    const inserted: number[] = [];
    for (const item of items) {
      const result = insert.run(topicId, topicTitle, item.platform, item.brand, item.content, item.content);
      inserted.push(result.lastInsertRowid as number);
    }
    return inserted;
  })();

  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM drafts WHERE id IN (${placeholders}) ORDER BY id`)
    .all(...ids) as Draft[];
}

/**
 * Lists drafts with optional filters.
 * Always sorted: ready_to_publish first, then draft; both sub-sorted by updated_at DESC.
 * Does NOT include original_content — use getDraftById for that.
 */
export function getDrafts(filters: { status?: string; topic_id?: number } = {}): DraftListItem[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters.topic_id !== undefined) {
    conditions.push('topic_id = ?');
    params.push(filters.topic_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT id, topic_id, topic_title, platform, brand, current_content, status, created_at, updated_at
    FROM drafts
    ${where}
    ORDER BY
      CASE status WHEN 'ready_to_publish' THEN 0 ELSE 1 END,
      updated_at DESC
  `).all(...params) as DraftListItem[];
}

/** Returns the full draft row including original_content. */
export function getDraftById(id: number): Draft | undefined {
  return db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as Draft | undefined;
}

/** Updates current_content and bumps updated_at. Returns the updated row. */
export function updateDraftContent(id: number, content: string): Draft | undefined {
  db.prepare(`
    UPDATE drafts SET current_content = ?, updated_at = datetime('now') WHERE id = ?
  `).run(content, id);
  return getDraftById(id);
}

/** Updates status and bumps updated_at. Returns the updated row. */
export function updateDraftStatus(id: number, status: string): Draft | undefined {
  db.prepare(`
    UPDATE drafts SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, id);
  return getDraftById(id);
}

/**
 * Promotes a draft to ready_to_publish and records the topic in published_topics
 * in a single transaction so both happen or neither does.
 */
export function markDraftReady(id: number): Draft | undefined {
  db.transaction(() => {
    const draft = getDraftById(id);
    if (!draft || draft.status === 'ready_to_publish') return;

    db.prepare(`
      UPDATE drafts SET status = 'ready_to_publish', updated_at = datetime('now') WHERE id = ?
    `).run(id);

    // Insert into dedup list so n8n Flow 1 won't re-suggest this topic
    insertPublishedTopic(draft.topic_title, draft.brand);
  })();

  return getDraftById(id);
}

/** Demotes a draft back to 'draft' status. Does NOT remove from published_topics. */
export function markDraftAsDraft(id: number): Draft | undefined {
  db.prepare(`
    UPDATE drafts SET status = 'draft', updated_at = datetime('now') WHERE id = ?
  `).run(id);
  return getDraftById(id);
}

/** Hard-deletes a draft. Returns true if a row was deleted, false if id didn't exist. */
export function deleteDraft(id: number): boolean {
  const result = db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  return result.changes > 0;
}
