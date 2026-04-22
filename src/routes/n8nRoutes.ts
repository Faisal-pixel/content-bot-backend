/**
 * n8nRoutes
 * ----------
 * Endpoints that n8n talks to directly. All protected by X-API-Secret header.
 *
 * These are the "input" side of the backend — n8n pushes data in and reads the
 * published topics list out. The React dashboard never calls these routes.
 *
 *   POST /api/weekly-topics     — Monday: n8n pushes 5 new topic suggestions
 *   POST /api/drafts-ready      — Flow 2 done: n8n reports which Hootsuite posts were created
 *   GET  /api/published-topics  — n8n reads this for dedup before generating suggestions
 *   POST /api/published-topics  — manual/admin: force-add a topic to the published list
 */

import { Router, Request, Response } from 'express';
import { apiSecretMiddleware } from '../middleware/apiSecret';
import {
  clearWeeklyTopics,
  insertWeeklyTopics,
  getAllPublishedTopics,
  insertPublishedTopic,
  insertTrackedPost,
  getWeeklyTopicById,
  updateWeeklyTopicStatus,
  NewWeeklyTopic,
} from '../db/queries';
import { logger } from '../utils/logger';

const router = Router();
router.use(apiSecretMiddleware);

// POST /api/weekly-topics
// n8n pushes the new week's 5 topics every Monday morning
router.post('/weekly-topics', (req: Request, res: Response): void => {
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

    logger.info(`Inserted ${topics.length} weekly topics for week of ${week_start_date}`);
    res.json({ status: 'ok', inserted: topics.length });
  } catch (err) {
    logger.error('POST /api/weekly-topics failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/drafts-ready
// n8n calls this after Flow 2 finishes — tells us which Hootsuite post IDs were created
// so the 15-minute job can start watching them for approval
router.post('/drafts-ready', (req: Request, res: Response): void => {
  try {
    const { topic_id, hootsuite_post_ids, brand } = req.body as {
      topic_id: number;
      hootsuite_post_ids: string[];
      brand?: string;
    };

    if (!topic_id || !Array.isArray(hootsuite_post_ids) || hootsuite_post_ids.length === 0) {
      res.status(400).json({ error: 'topic_id and hootsuite_post_ids[] are required' });
      return;
    }

    const topic = getWeeklyTopicById(topic_id);
    if (!topic) {
      res.status(404).json({ error: `Topic ${topic_id} not found` });
      return;
    }

    // Update topic status so the dashboard shows "drafts ready"
    updateWeeklyTopicStatus(topic_id, 'drafts_ready');

    // Insert each Hootsuite post ID into the tracker so the cron job can watch them
    for (const postId of hootsuite_post_ids) {
      insertTrackedPost(postId, topic_id, topic.title, brand);
    }

    logger.info(
      `Drafts ready for topic ${topic_id} ("${topic.title}") — tracking ${hootsuite_post_ids.length} post(s)`
    );

    res.json({ status: 'ok', tracked: hootsuite_post_ids.length });
  } catch (err) {
    logger.error('POST /api/drafts-ready failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/published-topics
// n8n reads this before generating suggestions so Claude avoids repeating published topics
router.get('/published-topics', (_req: Request, res: Response): void => {
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
router.post('/published-topics', (req: Request, res: Response): void => {
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
