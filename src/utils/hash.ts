/**
 * hash utility
 * -------------
 * Produces a normalized "dedup key" from a topic title.
 *
 * The problem it solves: n8n might suggest "AI in Healthcare" one week and
 * "ai in healthcare!" another week. Without normalization those look like
 * different topics even though they're the same idea.
 *
 * We lowercase and strip non-alphanumeric characters before storing the result
 * as topic_hash in published_topics. On insert we use INSERT OR IGNORE so
 * duplicate hashes are silently dropped — no error, no duplicate row.
 */

export function normalizeTopicTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeTopicHash(title: string): string {
  return normalizeTopicTitle(title);
}
