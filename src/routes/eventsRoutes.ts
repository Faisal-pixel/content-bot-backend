/**
 * eventsRoutes — Server-Sent Events (SSE) streams
 * -------------------------------------------------
 * SSE is a way for the server to push updates to the browser without the
 * browser having to ask repeatedly. Think of it like a radio station: the
 * server broadcasts, the browser listens. The connection stays open until
 * the browser closes it or navigates away.
 *
 * We have two streams — one for the topics page and one for the drafts page.
 * Each stream only sends events relevant to that page. The browser's built-in
 * EventSource API reconnects automatically if the server restarts.
 *
 * Why two streams instead of one? The topics page doesn't care about draft
 * content and the drafts page doesn't care about topic status. Keeping them
 * separate makes each connection lighter and easier to evolve independently.
 *
 * Both endpoints require a valid session cookie — EventSource can't set custom
 * headers, but cookies travel automatically, which is the whole reason we
 * switched from Basic Auth to session cookies.
 */

import { Router, Request, Response } from 'express';
import { sessionAuthMiddleware } from '../middleware/sessionAuth';
import { topicsEvents, draftsEvents } from '../services/eventBus';
import { EventEmitter } from 'events';

const router = Router();

// ─── Shared SSE helper ────────────────────────────────────────────────────────

/**
 * Opens an SSE connection, subscribes to the given EventEmitter, and wires up
 * a heartbeat ping every 25 seconds to keep proxies from killing the connection.
 *
 * @param emitter  Which EventEmitter to subscribe to (topicsEvents or draftsEvents)
 * @param eventNames  The event names to listen for
 */
function openSseStream(
  req: Request,
  res: Response,
  emitter: EventEmitter,
  eventNames: string[]
): void {
  // Required headers for SSE — X-Accel-Buffering stops Nginx from buffering the stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Helper that formats and sends one SSE event to this client
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // One listener per event name so we can remove them cleanly on disconnect
  const listeners: Record<string, (data: unknown) => void> = {};
  for (const name of eventNames) {
    const fn = (data: unknown) => send(name, data);
    listeners[name] = fn;
    emitter.on(name, fn);
  }

  // Keep the connection alive — proxies and load balancers drop idle connections
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  // Clean up when the browser closes the tab or navigates away
  req.on('close', () => {
    clearInterval(heartbeat);
    for (const [name, fn] of Object.entries(listeners)) {
      emitter.off(name, fn);
    }
    res.end();
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/events/topics
 * SSE stream for the topics page.
 * Emits: weekly_topics_replaced, topic_status_changed
 */
router.get('/events/topics', sessionAuthMiddleware, (req: Request, res: Response): void => {
  openSseStream(req, res, topicsEvents, [
    'weekly_topics_replaced',
    'topic_status_changed',
  ]);
});

/**
 * GET /api/events/drafts
 * SSE stream for the drafts page.
 * Emits: drafts_added, draft_updated, draft_status_changed, draft_deleted
 */
router.get('/events/drafts', sessionAuthMiddleware, (req: Request, res: Response): void => {
  openSseStream(req, res, draftsEvents, [
    'drafts_added',
    'draft_updated',
    'draft_status_changed',
    'draft_deleted',
  ]);
});

export default router;
