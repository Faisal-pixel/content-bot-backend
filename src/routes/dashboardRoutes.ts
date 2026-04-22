/**
 * dashboardRoutes
 * ----------------
 * Endpoints the React frontend calls. All protected by HTTP Basic Auth.
 *
 * These are the "output" side of the backend — the dashboard reads state
 * from here and triggers actions through here. n8n never calls these routes.
 *
 *   GET  /api/topics    — the 5 topic cards for this week
 *   GET  /api/status    — overall pipeline state (idle / generating / drafts_ready)
 *   GET  /api/calendar  — Hootsuite scheduled posts (cached, refreshed if stale)
 *   POST /api/generate  — click handler: starts content generation for a topic
 */

import { Router, Request, Response } from 'express';
import { basicAuthMiddleware } from '../middleware/basicAuth';
import {
  getAllWeeklyTopics,
  getWeeklyTopicById,
  updateWeeklyTopicStatus,
  getCachedCalendar,
} from '../db/queries';
import { triggerN8nFlow2 } from '../services/n8nService';
import { runApprovalDetection } from '../services/approvalDetector';
import { logger } from '../utils/logger';

const router = Router();
router.use(basicAuthMiddleware);

// GET /api/topics
router.get('/topics', (_req: Request, res: Response): void => {
  try {
    const topics = getAllWeeklyTopics();
    res.json({ topics });
  } catch (err) {
    logger.error('GET /api/topics failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/status
// Derives overall pipeline state from the set of topic statuses
router.get('/status', (_req: Request, res: Response): void => {
  try {
    const topics = getAllWeeklyTopics();

    let pipelineStatus: string;

    if (topics.length === 0) {
      pipelineStatus = 'idle';
    } else if (topics.some((t) => t.status === 'generating')) {
      // Any topic generating = the whole pipeline is generating
      pipelineStatus = 'generating';
    } else if (topics.every((t) => t.status === 'drafts_ready')) {
      // All topics have drafts = done for this week
      pipelineStatus = 'drafts_ready';
    } else {
      pipelineStatus = 'idle';
    }

    res.json({ status: pipelineStatus, topic_count: topics.length });
  } catch (err) {
    logger.error('GET /api/status failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/calendar
// Returns cached Hootsuite scheduled-posts data.
// If the cache is older than 15 minutes or doesn't exist yet, triggers a fresh fetch first.
router.get('/calendar', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cached = getCachedCalendar();
    const fifteenMinutesMs = 15 * 60 * 1000;

    // SQLite stores datetime() without timezone — append 'Z' so JS parses it as UTC
    const isStale =
      !cached ||
      Date.now() - new Date(cached.updated_at + 'Z').getTime() > fifteenMinutesMs;

    if (isStale) {
      logger.info('Calendar cache is stale — triggering fresh Hootsuite fetch');
      try {
        await runApprovalDetection();
      } catch (err) {
        // If the refresh fails, fall through and serve whatever stale data we have
        logger.error('Fresh calendar fetch failed — serving stale cache if available', err);
      }
    }

    const freshCache = getCachedCalendar();
    if (!freshCache) {
      res.status(503).json({ error: 'Calendar data not yet available — try again shortly' });
      return;
    }

    res.json(JSON.parse(freshCache.data));
  } catch (err) {
    logger.error('GET /api/calendar failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/generate
// Starts content generation for a topic.
// Returns 202 immediately, fires the n8n webhook in the background.
router.post('/generate', (req: Request, res: Response): void => {
  try {
    const body = req.body as {
      topic_id?: number;
      custom_topic?: {
        title: string;
        rationale?: string;
        tier1_source?: string;
        contrarian_angle?: string;
      };
    };

    if (!body.topic_id && !body.custom_topic) {
      res.status(400).json({ error: 'Provide either topic_id or custom_topic' });
      return;
    }

    if (body.topic_id) {
      // ── DB topic path ──────────────────────────────────────────────────────
      const topic = getWeeklyTopicById(body.topic_id);
      if (!topic) {
        res.status(404).json({ error: `Topic ${body.topic_id} not found` });
        return;
      }

      // Mark generating before responding so the frontend sees the state change immediately
      updateWeeklyTopicStatus(topic.id, 'generating');

      // Return 202 now — do not await the n8n call
      res.status(202).json({ status: 'generation_started', topic_id: topic.id });

      // Fire-and-forget: kick off n8n in the background after the response is sent
      triggerN8nFlow2({
        topic_id: topic.id,
        title: topic.title,
        rationale: topic.rationale,
        tier1_source: topic.tier1_source,
        contrarian_angle: topic.contrarian_angle,
      }).catch((err) => {
        logger.error(
          `n8n trigger failed for topic ${topic.id} ("${topic.title}") — resetting status to pending`,
          err
        );
        // Roll the status back so the user can see the failure and retry
        updateWeeklyTopicStatus(topic.id, 'pending');
      });
    } else {
      // ── Custom topic path ──────────────────────────────────────────────────
      const custom = body.custom_topic!;

      if (!custom.title) {
        res.status(400).json({ error: 'custom_topic.title is required' });
        return;
      }

      // No DB row for custom topics, so no status to update
      res.status(202).json({ status: 'generation_started', topic_id: null });

      triggerN8nFlow2({
        title: custom.title,
        rationale: custom.rationale,
        tier1_source: custom.tier1_source,
        contrarian_angle: custom.contrarian_angle,
      }).catch((err) => {
        logger.error(`n8n trigger failed for custom topic "${custom.title}"`, err);
      });
    }
  } catch (err) {
    logger.error('POST /api/generate failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
