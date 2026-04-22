// approvalJob
// ------------
// Sets up the cron schedule for the approval detection job.
//
// The job runs every 15 minutes ("* /15 * * * *" without the space) and also
// once immediately on startup — so you don't wait 15 minutes for the first
// calendar fetch after deploying or restarting the service.
//
// The actual detection logic lives in approvalDetector.ts. This file is just
// the scheduler wrapper — keeping scheduling separate from logic makes both
// easier to reason about.

import cron from 'node-cron';
import { runApprovalDetection } from '../services/approvalDetector';
import { logger } from '../utils/logger';

async function runJob(): Promise<void> {
  try {
    await runApprovalDetection();
  } catch (err) {
    // Safety net — approvalDetector handles most errors internally, but if
    // something truly unexpected throws we log and don't crash the process
    logger.error('Unhandled error in approval job', err);
  }
}

export function startApprovalJob(): void {
  // Run once immediately so the calendar cache is warm before the first cron tick
  logger.info('Running approval detection job on startup');
  void runJob();

  // Then run on the 15-minute mark of every hour (e.g. :00, :15, :30, :45)
  cron.schedule('*/15 * * * *', () => {
    logger.info('Cron tick: running approval detection job');
    void runJob();
  });

  logger.info('Approval detection cron job scheduled (*/15 * * * *)');
}
