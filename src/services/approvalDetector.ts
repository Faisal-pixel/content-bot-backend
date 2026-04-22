/**
 * approvalDetector
 * -----------------
 * The brain of the 15-minute background job.
 *
 * The problem it solves: when Sabeen approves a post in Hootsuite, the post
 * moves from PENDING_APPROVAL to SCHEDULED. We can't receive a webhook from
 * Hootsuite (we don't control their platform), so we poll every 15 minutes
 * and compare what we're tracking against what Hootsuite says is scheduled.
 *
 * If a post we're tracking shows up in the SCHEDULED list, Sabeen approved it.
 * When that happens, we mark the originating topic as "published" so Claude
 * won't suggest it again next Monday.
 *
 * Per the spec: as soon as ONE post from a topic is approved, the whole topic
 * is considered published. We don't wait for all posts to be approved.
 */

import { fetchScheduledMessages } from './hootsuiteService';
import {
  getPendingTrackedPosts,
  updateTrackerStatus,
  insertPublishedTopic,
  upsertCalendarCache,
} from '../db/queries';
import { logger } from '../utils/logger';

export async function runApprovalDetection(): Promise<void> {
  logger.info('--- Approval detection job starting ---');

  // Step 1: grab all posts we're still tracking (haven't been confirmed approved yet)
  const trackedPosts = getPendingTrackedPosts();
  logger.info(`Tracking ${trackedPosts.length} unresolved post(s)`);

  // Step 2: ask Hootsuite what's currently scheduled
  let scheduledResponse;
  try {
    scheduledResponse = await fetchScheduledMessages();
  } catch (err) {
    logger.error('Hootsuite fetch failed — skipping this detection cycle', err);
    return; // Don't crash; try again next cycle
  }

  // Step 3: cache the full Hootsuite response so /api/calendar can serve it instantly
  upsertCalendarCache(JSON.stringify(scheduledResponse));
  logger.info('Calendar cache updated');

  if (trackedPosts.length === 0) {
    logger.info('No posts to check — job done');
    return;
  }

  // Build a Set of scheduled Hootsuite post IDs for O(1) lookup
  const scheduledIds = new Set<string>(
    (scheduledResponse.data ?? []).map((msg) => msg.id)
  );

  // Step 4: find tracked posts that now appear in the SCHEDULED list —
  // those are the ones Sabeen just approved
  // Map of topic_id → { title, brand } for every topic that had ≥1 approval
  const approvedTopics = new Map<number, { title: string; brand: string | null }>();

  for (const post of trackedPosts) {
    if (scheduledIds.has(post.hootsuite_post_id)) {
      logger.info(
        `Post ${post.hootsuite_post_id} is SCHEDULED — Sabeen approved it (topic: "${post.topic_title}")`
      );

      // Mark approved so we stop watching this post in future cycles
      updateTrackerStatus(post.hootsuite_post_id, 'approved');

      if (!approvedTopics.has(post.topic_id)) {
        approvedTopics.set(post.topic_id, {
          title: post.topic_title,
          brand: post.brand,
        });
      }
    }
  }

  // Step 5: for every topic with ≥1 approved post, insert it into published_topics
  // INSERT OR IGNORE in insertPublishedTopic means it's safe to call even if already published
  for (const [topicId, { title, brand }] of approvedTopics) {
    logger.info(`Publishing topic ${topicId}: "${title}" (brand: ${brand ?? 'none'})`);
    insertPublishedTopic(title, brand ?? undefined);
  }

  logger.info(
    `--- Approval detection complete — ${approvedTopics.size} topic(s) moved to published ---`
  );
}
