/**
 * n8nRoutes
 * ----------
 * Endpoints that n8n talks to directly. All protected by X-API-Secret header.
 *
 * These are the "input" side of the backend — n8n pushes data in and reads the
 * published topics list out. The React dashboard never calls these routes.
 *
 *   POST /api/weekly-topics     — Monday: n8n pushes 5 new topic suggestions
 *   GET  /api/published-topics  — n8n reads this for dedup before generating suggestions
 *   POST /api/published-topics  — manual/admin: force-add a topic to the published list
 *
 * Note: POST /api/drafts (the endpoint n8n calls after content generation)
 * lives in draftsRoutes.ts because it shares logic with the dashboard draft endpoints.
 */

import { Router, Request, Response } from 'express';
import { apiSecretMiddleware } from '../middleware/apiSecret';
import {
  clearWeeklyTopics,
  insertWeeklyTopics,
  getAllPublishedTopics,
  insertPublishedTopic,
  NewWeeklyTopic,
} from '../db/queries';
import { topicsEvents } from '../services/eventBus';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/weekly-topics
// n8n pushes the new week's 5 topics every Monday morning
router.post('/weekly-topics', apiSecretMiddleware, (req: Request, res: Response): void => {
  try {
    const { topics, week_start_date } = req.body as {
      topics: NewWeeklyTopic[];
      week_start_date: string;
    };

    if (!Array.isArray(topics) || topics.length === 0) {
      res.status(400).json({ error: 'topics must be a non-empty array' });
      return;
    }

    if (!week_start_date) {
      res.status(400).json({ error: 'week_start_date is required' });
      return;
    }

    const topicsWithDate = topics.map((t) => ({ ...t, week_start_date }));

    // Clear previous week's topics then insert the new ones atomically
    clearWeeklyTopics();
    insertWeeklyTopics(topicsWithDate);

    // Notify the topics page that a fresh batch has arrived
    topicsEvents.emit('weekly_topics_replaced', {
      count: topics.length,
      week_start_date,
    });

    logger.info(`Inserted ${topics.length} weekly topics for week of ${week_start_date}`);
    res.json({ status: 'ok', inserted: topics.length });
  } catch (err) {
    logger.error('POST /api/weekly-topics failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/published-topics
// n8n reads this before generating suggestions so Claude avoids repeating published topics
router.get('/published-topics', apiSecretMiddleware, (_req: Request, res: Response): void => {
  try {
    const topics = getAllPublishedTopics();
    res.json({ topics });
  } catch (err) {
    logger.error('GET /api/published-topics failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/published-topics
// Manual/admin endpoint to force a topic into the published list
router.post('/published-topics', apiSecretMiddleware, (req: Request, res: Response): void => {
  try {
    const { title, brand } = req.body as { title: string; brand?: string };

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    insertPublishedTopic(title, brand);
    logger.info(`Manually published topic: "${title}" (brand: ${brand ?? 'none'})`);

    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('POST /api/published-topics failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
