/**
 * hootsuiteService
 * -----------------
 * Wraps all outbound calls to the Hootsuite API.
 *
 * Right now there's only one call we care about: fetching the list of
 * SCHEDULED messages. This is used by the 15-minute approval detector
 * (to find newly approved posts) and by the /api/calendar endpoint
 * (to show Sabeen what's queued up).
 *
 * Why a separate file? If Hootsuite changes their API or we need to add
 * token refresh logic later, there's exactly one place to change it.
 */

import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface HootsuiteMessage {
  id: string;
  state: string;
  // The full object has many more fields; we store the whole blob in calendar_cache
  // but only use id and state for approval detection
  [key: string]: unknown;
}

export interface HootsuiteScheduledResponse {
  data: HootsuiteMessage[];
  [key: string]: unknown;
}

export async function fetchScheduledMessages(): Promise<HootsuiteScheduledResponse> {
  logger.info('Fetching scheduled messages from Hootsuite');

  const response = await axios.get<HootsuiteScheduledResponse>(
    `${config.hootsuiteApiBase}/messages`,
    {
      params: { state: 'SCHEDULED' },
      headers: {
        Authorization: `Bearer ${config.hootsuiteApiToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    }
  );

  logger.info(`Hootsuite returned ${response.data.data?.length ?? 0} scheduled message(s)`);
  return response.data;
}
