/**
 * healthRoutes
 * -------------
 * A single GET /health endpoint with no authentication.
 *
 * Used by uptime monitors (UptimeRobot, Hetzner health checks, Docker HEALTHCHECK)
 * to verify the service is alive. Returns a timestamp so you can confirm the
 * response is fresh and not a cached 200 from a proxy.
 */

import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
