/**
 * session type augmentation
 * --------------------------
 * Tells TypeScript that req.session can hold a 'user' property.
 * Without this, TypeScript would complain that 'user' doesn't exist on SessionData.
 */

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: { username: string };
  }
}
