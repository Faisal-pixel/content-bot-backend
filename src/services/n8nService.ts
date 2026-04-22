/**
 * n8nService
 * -----------
 * Handles the outbound webhook call that triggers content generation in n8n.
 *
 * When the dashboard user clicks "Generate" on a topic, we need to tell n8n
 * to kick off Flow 2 (the content generation workflow). This file does that.
 *
 * The call is fire-and-forget from the route handler's perspective — the route
 * returns 202 to the client immediately, then this function runs in the background.
 * If it fails, the caller is responsible for logging and rolling back topic status.
 */

import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface TopicPayload {
  topic_id?: number;
  title: string;
  rationale?: string;
  tier1_source?: string;
  contrarian_angle?: string;
}

export async function triggerN8nFlow2(payload: TopicPayload): Promise<void> {
  logger.info(`Triggering n8n Flow 2 for topic: "${payload.title}"`);

  await axios.post(config.n8nFlow2WebhookUrl, payload, {
    headers: {
      // n8n's webhook validates this same secret so it knows the request is from us
      'X-API-Secret': config.n8nSharedSecret,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });

  logger.info(`n8n Flow 2 triggered successfully for topic: "${payload.title}"`);
}
