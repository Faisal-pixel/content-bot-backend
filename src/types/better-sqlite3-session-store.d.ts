/**
 * Ambient type declaration for better-sqlite3-session-store.
 * The package ships no types so we declare just enough for our usage.
 * Imports must be inside the declare block to keep this an ambient module file.
 */

declare module 'better-sqlite3-session-store' {
  import session from 'express-session';
  import { Database } from 'better-sqlite3';

  interface SqliteStoreOptions {
    client: Database;
    expired?: {
      clear?: boolean;
      intervalMs?: number;
    };
  }

  type SqliteStoreClass = new (options: SqliteStoreOptions) => session.Store;

  function factory(opts: { Store: typeof session.Store }): SqliteStoreClass;

  export = factory;
}
