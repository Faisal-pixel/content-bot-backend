/**
 * index.ts — entry point
 * -----------------------
 * This is where the app boots. Think of it as the wiring diagram:
 * it imports from every other module but contains almost no logic itself.
 *
 * Boot order matters:
 *   1. Config loads first (exits immediately if any required env var is missing)
 *   2. DB connection opens and tables are created
 *   3. Express app is configured with middleware and routes
 *   4. The 15-minute cron job starts (and runs once immediately)
 *   5. HTTP server starts listening
 */

import express from 'express';
import { config } from './config';
import { initSchema } from './db/schema';
import { startApprovalJob } from './jobs/approvalJob';
import healthRoutes from './routes/healthRoutes';
import n8nRoutes from './routes/n8nRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import { logger } from './utils/logger';

const app = express();

// Parse JSON request bodies
app.use(express.json());

// Routes — order matters: health check first (no auth), then guarded routes
app.use('/', healthRoutes);
app.use('/api', n8nRoutes);
app.use('/api', dashboardRoutes);

// Create DB tables if they don't exist yet
initSchema();

// Start the approval detection cron job (also fires once immediately on startup)
startApprovalJob();

// Start the HTTP server
app.listen(config.port, () => {
  logger.info(`Content Bot backend running on port ${config.port} [${config.nodeEnv}]`);
});

export default app;
