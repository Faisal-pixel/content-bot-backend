/**
 * apiSecret middleware
 * --------------------
 * This is a bouncer for the endpoints that n8n talks to.
 *
 * n8n sends a secret password in a header called 'X-API-Secret'.
 * We check if the password matches the one in our env file.
 * If it matches: let the request through.
 * If not: send back a 401 "you're not allowed" response.
 *
 * Why? These endpoints modify our database. We don't want random
 * people on the internet POSTing fake topics to us.
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function apiSecretMiddleware(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-api-secret'];

  if (!provided || provided !== config.n8nSharedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
