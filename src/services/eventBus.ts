/**
 * eventBus
 * ---------
 * A tiny in-memory pub/sub system for real-time updates.
 *
 * Think of it like a walkie-talkie channel: routes that change data "broadcast"
 * a message, and the SSE endpoints "listen" and forward those messages to any
 * browser that has an open connection.
 *
 * We use Node's built-in EventEmitter — no Redis, no queue, no extra packages.
 * Two separate emitters keep the topic-page events separate from draft-page events
 * so each SSE connection only receives the events it cares about.
 *
 * Important: this is in-memory only. If the server restarts, all connected
 * clients drop their EventSource connections and reconnect automatically (that's
 * how EventSource works in the browser). Any events fired during the restart
 * window are lost — that's intentional for Phase 1.
 */

import { EventEmitter } from 'events';

/** Events for the topics page. */
export const topicsEvents = new EventEmitter();

/** Events for the drafts page. */
export const draftsEvents = new EventEmitter();
