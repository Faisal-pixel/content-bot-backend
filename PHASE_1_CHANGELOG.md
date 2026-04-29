# Phase 1 Changes — Content Bot Backend

This document explains what changed in Phase 1 of the content bot backend. It is written for Sabeen, not engineers. No git history required.

---

## Removed

**Hootsuite integration**
The entire Hootsuite connection has been removed. This includes the code that talked to Hootsuite, the job that checked every 15 minutes for post approvals, and the two database tables that stored Hootsuite-related data (`hootsuite_post_tracker` and `calendar_cache`). None of this is needed going forward.

**The 15-minute background job**
There was a repeating task running in the background that kept asking Hootsuite "have any posts been approved yet?" That job is gone. Approval is now handled directly inside the app — no external polling needed.

**The old drafts endpoint**
There was an endpoint called `/api/drafts-ready` that the frontend used to fetch content. It has been replaced by a cleaner, more capable `/api/drafts` endpoint (described below).

**HTTP Basic Auth**
The old way of proving you were logged in was by sending a username and password with every request (called Basic Auth). This has been replaced with session cookies — the normal way websites handle logins. The reason for the switch is explained in the Decisions section.

---

## Added

**A proper drafts table in the database**
There is now a `drafts` table that stores all the content Claude generates. Each draft has two content fields: `original_content` (what Claude wrote — this never changes, ever) and `current_content` (the working copy that you can edit). This means you can always see what the original looked like, even after editing.

**Draft delivery from n8n**
After Flow 2 finishes generating content, n8n sends all 7 platform drafts to the backend in a single request. The backend stores them, and they immediately appear in the app.

**A full set of draft management endpoints**
The backend now supports everything the drafts page needs:

- Listing all drafts, with optional filters by status or topic. Drafts marked "ready to publish" always appear first.
- Fetching a single draft in full, including the original content.
- Editing the current content of a draft (the original is never touched).
- Marking a draft as ready to publish — this also records the topic in the deduplication list so it won't be suggested again.
- Demoting a draft back to draft status (the topic stays in the deduplication list).
- Deleting a draft permanently.

**Login, logout, and "who am I" endpoints**
There are now proper endpoints for signing in (`POST /api/login`), signing out (`POST /api/logout`), and checking who is currently logged in (`GET /api/me`). These work with cookies.

**Real-time updates via SSE**
There are now two live event streams the frontend can subscribe to:

- One for the topics page — it pushes updates when topics are replaced or a topic's status changes.
- One for the drafts page — it pushes updates when drafts are added, edited, change status, or are deleted.

This means the page updates automatically without needing to refresh.

**Session management**
Two new packages handle keeping you logged in across page loads: `express-session` and `better-sqlite3-session-store`. Sessions are stored in the same SQLite database the rest of the app uses.

**An internal event bus**
A lightweight internal messaging system (`eventBus.ts`) was added. When something changes in the database (a draft is added, a status changes, etc.), the event bus notifies the SSE streams so they can push updates to the browser immediately.

---

## Changed

**How login works**
The auth model switched from HTTP Basic Auth to session cookies. You log in once, the server gives your browser a cookie, and that cookie is sent automatically with every future request. This is the standard way modern web apps work.

**The calendar endpoint is a temporary stub**
`/api/calendar` now returns an empty list with a note explaining that publishing integration is coming. The data model for the calendar was tied to Hootsuite, so it needs to be rebuilt alongside whatever publishing tool comes next.

**How deduplication works**
Previously, a topic was added to the "already published" list when Hootsuite detected an approval. Now it happens when you click "mark ready to publish" inside the app. Same outcome, simpler path.

**CORS settings updated**
The backend's cross-origin rules were updated to allow `PATCH` and `DELETE` requests (needed for draft editing and deletion), and to stop listing `Authorization` as an allowed header (since cookies are used now instead).

---

## Decisions Made During Implementation

1. **calendarTransformService.ts was deleted** even though it was not on the original removal list. It was entirely dependent on the Hootsuite service, so once that was gone, this file had nothing to do. Keeping it would have been misleading.

2. **better-sqlite3-session-store version 0.1.0 was used.** The original plan called for v0.2.1, but that version does not exist — the package has never been published past v0.1.0. The latest available version was used instead.

3. **A TypeScript declaration file was written by hand** for `better-sqlite3-session-store`. The package does not ship its own type definitions, so a small `.d.ts` file was added to tell TypeScript what the package looks like. This is a standard workaround for packages that predate TypeScript support.

4. **Session type augmentation lives in a `.d.ts` file** inside `src/types/`. This tells TypeScript that `req.session.user` is a valid property. It is done this way (as a declaration file rather than a runtime import) to avoid a module-not-found error when the server starts up.

5. **Draft validation happens before any database call.** When n8n sends drafts to the backend, the route handler checks that all the platform names are valid before touching the database. This means a bad payload either succeeds fully or fails cleanly — it can never partially insert data and leave the database in an inconsistent state.
