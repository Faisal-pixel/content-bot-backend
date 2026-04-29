/**
 * sessionAuth middleware
 * ----------------------
 * Protects dashboard-facing routes with session cookie auth.
 *
 * When Sabeen logs in via POST /api/login, the server creates a session and
 * sends back a cookie. Every subsequent request from the browser sends that
 * cookie automatically — the browser handles it, Sabeen doesn't see it.
 *
 * This middleware checks that the cookie belongs to a valid session that was
 * created by a successful login. If yes: let the request through. If no: 401.
 *
 * Why cookies instead of Basic Auth? Two reasons:
 *   1. The SSE endpoints (EventSource API) can't set custom headers in the
 *      browser — cookies are the only auth mechanism that works with them.
 *   2. Cookies don't re-send credentials on every request — just a session ID.
 */

import { Request, Response, NextFunction } from 'express';

export function sessionAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
