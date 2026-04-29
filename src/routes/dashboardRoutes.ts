/**
 * dashboardRoutes
 * ----------------
 * Endpoints the React frontend calls. All protected by session cookie auth.
 *
 * These are the "output" side of the backend — the dashboard reads state
 * from here and triggers actions through here. n8n never calls these routes.
 *
 *   GET  /api/topics          — the 5 topic cards for this week
 *   GET  /api/status          — overall pipeline state (idle / generating / drafts_ready)
 *   GET  /api/calendar        — stub (publishing integration TBD)
 *   POST /api/generate        — click handler: starts content generation for a topic
 */

import { Router, Request, Response } from 'express';
import { sessionAuthMiddleware } from '../middleware/sessionAuth';
import {
  getAllWeeklyTopics,
  getWeeklyTopicById,
  updateWeeklyTopicStatus,
  insertCustomTopic,
} from '../db/queries';
import { triggerN8nFlow2 } from '../services/n8nService';
import { topicsEvents } from '../services/eventBus';
import { logger } from '../utils/logger';

const router = Router();

/** ISO date string (YYYY-MM-DD) for the Monday of the current week, in UTC. */
function getMondayIso(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();           // 0=Sun … 6=Sat
  const offsetToMonday = (dayOfWeek + 6) % 7;  // Mon=0, Tue=1 … Sun=6
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - offsetToMonday
  ));
  return monday.toISOString().slice(0, 10);
}

// GET /api/topics
router.get('/topics', sessionAuthMiddleware, (_req: Request, res: Response): void => {
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
router.get('/status', sessionAuthMiddleware, (_req: Request, res: Response): void => {
  try {
    const topics = getAllWeeklyTopics();

    let pipelineStatus: string;

    if (topics.length === 0) {
      pipelineStatus = 'idle';
    } else if (topics.some((t) => t.status === 'generating')) {
      pipelineStatus = 'generating';
    } else if (topics.every((t) => t.status === 'drafts_ready')) {
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
// Stub — publishing integration is pending a decision on which platform to use.
// Returning an empty array keeps the frontend from crashing while the decision is made.
router.get('/calendar', sessionAuthMiddleware, (_req: Request, res: Response): void => {
  res.json({ data: [], note: 'Calendar feature pending decision on publishing integration' });
});

// POST /api/generate
// Starts content generation for a topic.
// Returns 202 immediately, fires the n8n webhook in the background.
router.post('/generate', sessionAuthMiddleware, (req: Request, res: Response): void => {
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

      updateWeeklyTopicStatus(topic.id, 'generating');

      // Notify the topics page immediately so the UI reflects the new status
      topicsEvents.emit('topic_status_changed', { topic_id: topic.id, status: 'generating' });

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
        updateWeeklyTopicStatus(topic.id, 'pending');
        topicsEvents.emit('topic_status_changed', { topic_id: topic.id, status: 'pending' });
      });
    } else {
      // ── Custom topic path ──────────────────────────────────────────────────
      const custom = body.custom_topic!;

      if (!custom.title) {
        res.status(400).json({ error: 'custom_topic.title is required' });
        return;
      }

      // Persist the custom topic so it has a real id n8n's validator will accept.
      // week_start_date = the Monday of the current week (matches the schema's
      // expectation that every topic belongs to a week).
      const newTopic = insertCustomTopic({
        title:            custom.title,
        rationale:        custom.rationale,
        tier1_source:     custom.tier1_source,
        contrarian_angle: custom.contrarian_angle,
        week_start_date:  getMondayIso(),
      });

      // Push the updated topic list to all connected dashboards so the new
      // card shows up live without a manual refresh.
      topicsEvents.emit('weekly_topics_replaced', { topics: getAllWeeklyTopics() });

      res.status(202).json({ status: 'generation_started', topic_id: newTopic.id });

      // Fire-and-forget: kick off n8n in the background after the response is sent
      triggerN8nFlow2({
        topic_id:         newTopic.id,
        title:            newTopic.title,
        rationale:        newTopic.rationale,
        tier1_source:     newTopic.tier1_source,
        contrarian_angle: newTopic.contrarian_angle,
      }).catch((err) => {
        logger.error(
          `n8n trigger failed for custom topic ${newTopic.id} ("${newTopic.title}") — resetting status to pending`,
          err
        );
        updateWeeklyTopicStatus(newTopic.id, 'pending');
        topicsEvents.emit('topic_status_changed', { topic_id: newTopic.id, status: 'pending' });
      });
    }
  } catch (err) {
    logger.error('POST /api/generate failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/topics/:id/reset
// Resets a topic stuck in 'generating' back to 'pending' so the user can retry.
// Only valid for topics currently in 'generating' state — drafts_ready topics aren't reset here.
router.post('/topics/:id/reset', sessionAuthMiddleware, (req: Request, res: Response): void => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid topic id' });
      return;
    }

    const topic = getWeeklyTopicById(id);
    if (!topic) {
      res.status(404).json({ error: `Topic ${id} not found` });
      return;
    }

    if (topic.status !== 'generating') {
      res.status(409).json({
        error: `Topic ${id} is in '${topic.status}' state — only 'generating' topics can be reset`,
      });
      return;
    }

    updateWeeklyTopicStatus(id, 'pending');
    topicsEvents.emit('topic_status_changed', { topic_id: id, status: 'pending' });

    res.json({ status: 'reset', topic_id: id });
  } catch (err) {
    logger.error('POST /api/topics/:id/reset failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
