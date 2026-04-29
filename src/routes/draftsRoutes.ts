/**
 * draftsRoutes
 * -------------
 * All endpoints for managing content drafts — the core of Phase 1.
 *
 * There are two groups of routes in this file:
 *
 *   Group A — n8n-facing (X-API-Secret header)
 *     POST /api/drafts   — n8n delivers a full batch of 7 generated drafts here
 *                          after Flow 2 finishes. We store them and notify the dashboard.
 *
 *   Group B — dashboard-facing (session cookie auth)
 *     GET    /api/drafts            — list all drafts, with optional filters
 *     GET    /api/drafts/:id        — fetch one draft with full content
 *     PATCH  /api/drafts/:id        — edit the current_content of a draft
 *     POST   /api/drafts/:id/mark-ready  — mark as ready to publish + add to dedup list
 *     POST   /api/drafts/:id/mark-draft  — demote back to draft
 *     DELETE /api/drafts/:id        — permanently delete a draft
 *
 * The two auth middlewares (apiSecretMiddleware vs sessionAuthMiddleware) are applied
 * per-route so they don't interfere with each other.
 */

import { Router, Request, Response } from 'express';
import { apiSecretMiddleware } from '../middleware/apiSecret';
import { sessionAuthMiddleware } from '../middleware/sessionAuth';
import {
  insertDrafts,
  getDrafts,
  getDraftById,
  updateDraftContent,
  markDraftReady,
  markDraftAsDraft,
  deleteDraft,
  getWeeklyTopicById,
  updateWeeklyTopicStatus,
  isAllowedPlatform,
  ALLOWED_PLATFORMS,
} from '../db/queries';
import { draftsEvents, topicsEvents } from '../services/eventBus';
import { logger } from '../utils/logger';

const router = Router();

// ─── Group A: n8n-facing ──────────────────────────────────────────────────────

/**
 * POST /api/drafts
 * n8n calls this once after Flow 2 finishes content generation.
 * Receives all drafts for a topic in one request, inserts them in a transaction,
 * updates the topic status, and broadcasts to connected dashboard clients.
 */
router.post('/drafts', apiSecretMiddleware, (req: Request, res: Response): void => {
  const body = req.body as {
    topic_id?: number | null;
    topic_title?: string;
    drafts?: Array<{ platform?: string; brand?: string | null; content?: string }>;
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  const topicTitle = typeof body.topic_title === 'string' ? body.topic_title.trim() : '';
  if (!topicTitle) {
    res.status(400).json({ error: 'topic_title is required and must be a non-empty string' });
    return;
  }

  if (!Array.isArray(body.drafts) || body.drafts.length === 0) {
    res.status(400).json({ error: 'drafts must be a non-empty array' });
    return;
  }

  // Validate every draft item before touching the DB — reject the whole batch on any failure
  for (let i = 0; i < body.drafts.length; i++) {
    const d = body.drafts[i]!;
    if (!d.platform || !isAllowedPlatform(d.platform)) {
      res.status(400).json({
        error: `drafts[${i}].platform is invalid. Allowed values: ${ALLOWED_PLATFORMS.join(', ')}`,
      });
      return;
    }
    const content = typeof d.content === 'string' ? d.content.trim() : '';
    if (!content) {
      res.status(400).json({ error: `drafts[${i}].content is required and must be non-empty` });
      return;
    }
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const topicId = body.topic_id ?? null;

  try {
    const items = body.drafts.map((d) => ({
      platform: d.platform as string,
      brand: d.brand ?? null,
      content: (d.content as string).trim(),
    }));

    insertDrafts(topicId, topicTitle, items);

    // Update topic status to drafts_ready if a real topic_id was provided
    if (topicId !== null) {
      const topic = getWeeklyTopicById(topicId);
      if (topic) {
        updateWeeklyTopicStatus(topicId, 'drafts_ready');
        // Notify the topics page that this topic's status changed
        topicsEvents.emit('topic_status_changed', { topic_id: topicId, status: 'drafts_ready' });
      }
    }

    // Notify the drafts page that new drafts are available
    draftsEvents.emit('drafts_added', {
      topic_id: topicId,
      topic_title: topicTitle,
      count: items.length,
    });

    logger.info(`Inserted ${items.length} drafts for topic "${topicTitle}" (topic_id: ${topicId ?? 'custom'})`);
    res.json({ status: 'ok', inserted: items.length });
  } catch (err) {
    logger.error('POST /api/drafts failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Group B: dashboard-facing ────────────────────────────────────────────────

/**
 * GET /api/drafts
 * Lists drafts. Optional query params:
 *   ?status=draft|ready_to_publish   — filter by status
 *   ?topic_id=42                     — filter to one topic's drafts
 * Response does NOT include original_content — use GET /api/drafts/:id for that.
 */
router.get('/drafts', sessionAuthMiddleware, (req: Request, res: Response): void => {
  try {
    const filters: { status?: string; topic_id?: number } = {};

    const statusParam = req.query['status'] as string | undefined;
    if (statusParam === 'draft' || statusParam === 'ready_to_publish') {
      filters.status = statusParam;
    }

    const topicIdParam = req.query['topic_id'] as string | undefined;
    if (topicIdParam !== undefined) {
      const parsed = parseInt(topicIdParam, 10);
      if (isNaN(parsed) || parsed <= 0) {
        res.status(400).json({ error: 'topic_id must be a positive integer' });
        return;
      }
      filters.topic_id = parsed;
    }

    const drafts = getDrafts(filters);
    res.json({ drafts });
  } catch (err) {
    logger.error('GET /api/drafts failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/drafts/:id
 * Returns the full draft row including both original_content and current_content.
 * Use this when opening a draft for editing so the UI can show the diff.
 */
router.get('/drafts/:id', sessionAuthMiddleware, (req: Request, res: Response): void => {
  const id = parseDraftId(req.params['id']);
  if (id === null) {
    res.status(400).json({ error: 'Invalid draft id' });
    return;
  }

  try {
    const draft = getDraftById(id);
    if (!draft) {
      res.status(404).json({ error: `Draft ${id} not found` });
      return;
    }
    res.json({ draft });
  } catch (err) {
    logger.error(`GET /api/drafts/${id} failed`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/drafts/:id
 * Updates the current_content of a draft. Does not touch original_content.
 * Body: { current_content: "..." }
 */
router.patch('/drafts/:id', sessionAuthMiddleware, (req: Request, res: Response): void => {
  const id = parseDraftId(req.params['id']);
  if (id === null) {
    res.status(400).json({ error: 'Invalid draft id' });
    return;
  }

  const content = typeof req.body?.current_content === 'string'
    ? req.body.current_content.trim()
    : '';

  if (!content) {
    res.status(400).json({ error: 'current_content is required and must be non-empty' });
    return;
  }

  try {
    const existing = getDraftById(id);
    if (!existing) {
      res.status(404).json({ error: `Draft ${id} not found` });
      return;
    }

    const updated = updateDraftContent(id, content);
    draftsEvents.emit('draft_updated', updated);

    res.json({ draft: updated });
  } catch (err) {
    logger.error(`PATCH /api/drafts/${id} failed`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/drafts/:id/mark-ready
 * Promotes a draft to ready_to_publish.
 * Also records the topic in published_topics so n8n won't re-suggest it.
 * If the draft is already ready_to_publish, this is a no-op.
 */
router.post('/drafts/:id/mark-ready', sessionAuthMiddleware, (req: Request, res: Response): void => {
  const id = parseDraftId(req.params['id']);
  if (id === null) {
    res.status(400).json({ error: 'Invalid draft id' });
    return;
  }

  try {
    const existing = getDraftById(id);
    if (!existing) {
      res.status(404).json({ error: `Draft ${id} not found` });
      return;
    }

    const updated = markDraftReady(id);
    draftsEvents.emit('draft_status_changed', updated);

    res.json({ draft: updated });
  } catch (err) {
    logger.error(`POST /api/drafts/${id}/mark-ready failed`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/drafts/:id/mark-draft
 * Demotes a draft back to 'draft' status.
 * Does NOT remove from published_topics — the dedup is intentionally conservative.
 */
router.post('/drafts/:id/mark-draft', sessionAuthMiddleware, (req: Request, res: Response): void => {
  const id = parseDraftId(req.params['id']);
  if (id === null) {
    res.status(400).json({ error: 'Invalid draft id' });
    return;
  }

  try {
    const existing = getDraftById(id);
    if (!existing) {
      res.status(404).json({ error: `Draft ${id} not found` });
      return;
    }

    const updated = markDraftAsDraft(id);
    draftsEvents.emit('draft_status_changed', updated);

    res.json({ draft: updated });
  } catch (err) {
    logger.error(`POST /api/drafts/${id}/mark-draft failed`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/drafts/:id
 * Hard-deletes a draft. There is no undo. The frontend handles the confirm dialog.
 */
router.delete('/drafts/:id', sessionAuthMiddleware, (req: Request, res: Response): void => {
  const id = parseDraftId(req.params['id']);
  if (id === null) {
    res.status(400).json({ error: 'Invalid draft id' });
    return;
  }

  try {
    const deleted = deleteDraft(id);
    if (!deleted) {
      res.status(404).json({ error: `Draft ${id} not found` });
      return;
    }

    draftsEvents.emit('draft_deleted', { id });

    res.json({ status: 'deleted', id });
  } catch (err) {
    logger.error(`DELETE /api/drafts/${id} failed`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses a route param as a positive integer. Returns null if invalid. */
function parseDraftId(param: string | undefined): number | null {
  if (!param) return null;
  const n = parseInt(param, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

export default router;
