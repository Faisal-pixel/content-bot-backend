/**
 * database connection
 * --------------------
 * Opens (or creates) the SQLite database file and exports a single shared
 * connection object that the rest of the app uses.
 *
 * better-sqlite3 is synchronous — no callbacks, no promises. That's fine here
 * because SQLite on a local file is fast enough that sync access is simpler
 * and safer than async would be. We're not serving thousands of concurrent users.
 *
 * The data/ directory is created here if it doesn't exist yet, so the app
 * works on a fresh machine with no manual setup.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

const dbDir = path.dirname(path.resolve(config.dbPath));

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  logger.info(`Created database directory: ${dbDir}`);
}

export const db = new Database(config.dbPath);

// WAL mode gives better concurrent read performance with no extra process overhead
db.pragma('journal_mode = WAL');
// Enforce foreign key constraints — SQLite ignores them by default
db.pragma('foreign_keys = ON');

logger.info(`SQLite database opened at ${config.dbPath}`);
