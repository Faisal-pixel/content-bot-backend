/**
 * authRoutes
 * -----------
 * The three auth endpoints that power the dashboard login flow.
 *
 * How login works now:
 *   1. The login form POSTs { username, password } to /api/login.
 *   2. We check the values against DASHBOARD_USER / DASHBOARD_PASSWORD from the env.
 *   3. If they match: we create a session (server stores it in SQLite, browser gets a cookie).
 *   4. Future requests from that browser automatically include the cookie — the browser
 *      handles this, Sabeen never sees it.
 *   5. POST /api/logout destroys the session and clears the cookie.
 *   6. GET /api/me lets the frontend check on load whether there's still a valid session.
 *
 * Why not Basic Auth any more? The SSE EventSource API in browsers can't send custom
 * headers, so Basic Auth doesn't work for SSE connections. Session cookies travel
 * automatically with every request including SSE, which is why we switched.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config';
import { sessionAuthMiddleware } from '../middleware/sessionAuth';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/login
router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  // Constant-time comparison would be ideal here but for a single-user local tool
  // a direct string comparison is acceptable — no brute-force risk on localhost.
  if (username !== config.dashboardUser || password !== config.dashboardPassword) {
    // Don't reveal which field was wrong
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Attach the user to the session — this is what sessionAuthMiddleware checks
  req.session.user = { username };

  logger.info(`Dashboard login: ${username}`);
  res.json({ status: 'ok', username });
});

// POST /api/logout
router.post('/logout', (req: Request, res: Response): void => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Session destroy failed', err);
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ status: 'ok' });
  });
});

// GET /api/me
// The frontend calls this on load to check if a valid session exists.
// 200 = still logged in, 401 = need to log in again.
router.get('/me', sessionAuthMiddleware, (req: Request, res: Response): void => {
  res.json({ username: req.session.user?.username });
});

export default router;
