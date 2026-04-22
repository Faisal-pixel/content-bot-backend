/**
 * basicAuth middleware
 * --------------------
 * HTTP Basic Auth protection for the dashboard-facing endpoints.
 *
 * The React frontend sends a username + password with every request (base64
 * encoded in the Authorization header — this is the standard Basic Auth spec).
 * express-basic-auth handles the header parsing and comparison; we just pass
 * it the credentials from our env file.
 *
 * Why Basic Auth and not JWT? This dashboard has one user (Sabeen). JWTs add
 * token refresh complexity for zero benefit at this scale. HTTPS — provided
 * by the reverse proxy on Hetzner — makes Basic Auth secure in production.
 */

import expressBasicAuth from 'express-basic-auth';
import { config } from '../config';

export const basicAuthMiddleware = expressBasicAuth({
  users: { [config.dashboardUser]: config.dashboardPassword },
  // challenge: true sends a WWW-Authenticate header so browsers show a native login dialog
  challenge: true,
});
