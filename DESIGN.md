# GitHub Mirror — Design & Next Steps

## Core Principle: Webhook-First

The mirror is driven by GitHub webhooks. Data arrives in real-time as events happen on tracked repos. The GitHub API is only called when a webhook signals that something needs fetching (diffs, file contents) — **webhooks are the invalidation signal, not a polling schedule.**

```
GitHub event occurs
    → webhook delivers metadata to mirror (free, instant)
    → webhook handler upserts metadata to Postgres, returns 202 immediately
    → if the event implies fetchable content (PR opened/pushed/merged),
      handler enqueues a fetch job to Redis (BullMQ)
    → worker picks up job, calls GitHub API for diffs + file contents
    → store everything
    → validators query the mirror, never GitHub
```

**What webhooks give us for free (no API calls):**
- PR metadata (author, state, timestamps, linked issues, associations)
- Issue metadata (author, state, timestamps, transfers)
- Reviews (reviewer, state, submitted_at)
- Label changes (actor, action, timestamp)

**What requires a GitHub API call (triggered by webhook, not polled):**
- PR file list + patches (`pr_files`) — fetched on `pull_request.opened`, `.synchronize`, `.merged`
- PR file contents for AST scoring (`pr_file_contents`) — fetched alongside file list
- Backfill on first repo install — bulk fetch historical data
- Gap recovery — if `last_event_at` goes stale, light backfill via API

**Rate limit impact:** ~1-3 API calls per PR over its lifetime (open, pushes, merge). At 256 repos, worst case ~500 calls/hour across the network. GitHub App limit is 15,000/hr per installation. We use <5%.

---

## Raw Tables (already defined)

The existing schema in `packages/db/` covers 10 tables. These are the webhook write layer — upserted on every event, append-only where appropriate.

| Table | Purpose |
|---|---|
| `repos` | Tracked repos + App installation metadata |
| `pull_requests` | One row per PR, upserted on state changes |
| `issues` | One row per issue, upserted on state changes |
| `reviews` | One row per review submission, append-only |
| `comments` | Issue + PR thread comments, append-only (upsert on edit) |
| `review_comments` | Inline code review comments on PR diffs, append-only (upsert on edit) |
| `label_events` | Append-only log of every label add/remove |
| `pr_files` | File-level change metadata (filename, status, additions, deletions, changes) |
| `pr_file_contents` | Actual file content (base + head versions) for AST/token scoring |
| `webhook_deliveries` | Dedup table keyed on `X-GitHub-Delivery` header |

### Note on `scoring_data_stored`

The `pull_requests.scoring_data_stored` flag indicates whether `pr_files` and `pr_file_contents` have been fetched for this PR. It is set to `true` after a successful fetch. When a `pull_request.synchronize` event arrives (new push to the PR branch), the flag is reset to `false` and the diff is refetched — **the webhook is the invalidation signal.** Once a PR is merged, the flag becomes permanently `true` because the diff is immutable (fixed SHAs).

### Note on data retention

Raw tables keep data indefinitely. Storage is ~45 MB/month at current scale (256 repos), with conversation threads (issue_comments + review_comments) adding <1 MB/month. The 35-day lookback is a **scoring concern, not a storage concern** — views filter by time window, but historical data is preserved for trend analysis, audits, and dashboard use.

### Storage breakdown estimate (256 repos)

| Table | Monthly growth | Notes |
|---|---|---|
| `pull_requests` | ~2 MB | Metadata only, one row per PR |
| `issues` | ~1 MB | Metadata only, one row per issue |
| `reviews` | ~500 KB | One row per review submission |
| `comments` | ~500 KB | ~500 bytes/comment avg, covers issues + PR threads |
| `review_comments` | ~300 KB | Inline code comments, includes file path + line |
| `label_events` | ~200 KB | Append-only label log |
| `pr_files` | ~3 MB | File-level change metadata per PR |
| `pr_file_contents` | ~38 MB | Actual source code (pruned to 35-day window) |
| `webhook_deliveries` | ~100 KB | Pruned periodically |
| **Total** | **~45.5 MB** | Comments are negligible (<1% of total) |

---

## Computed Views

These are Postgres views (virtual tables) and materialized views that pre-aggregate raw data for the validator API. They provide **facts and counts only — zero scoring logic.** The mirror never computes credibility ratios, multipliers, or eligibility. Validators do all scoring math on their side.

### View: `contributor_repo_roles`

Latest known association per contributor per repo. Unions PRs and issues, takes the most recently created record.

```sql
CREATE VIEW contributor_repo_roles AS
SELECT DISTINCT ON (repo_full_name, author_github_id)
    repo_full_name,
    author_github_id,
    author_login,
    author_association
FROM (
    SELECT repo_full_name, author_github_id, author_login, author_association, created_at
    FROM pull_requests
    UNION ALL
    SELECT repo_full_name, author_github_id, author_login, author_association, created_at
    FROM issues
) combined
ORDER BY repo_full_name, author_github_id, created_at DESC;
```

**Why:** Validators need to know "is this person a maintainer in this repo?" for the maintainer exclusion rule (maintainers get 0 score for merged PRs in their own repos). Association can change over time (contributor promoted to collaborator) — latest record is most accurate.

**Columns:**
| Column | Why |
|---|---|
| `repo_full_name` | Which repo |
| `author_github_id` | Which contributor (immutable GitHub ID) |
| `author_login` | Display name (for human readability, not used as key) |
| `author_association` | OWNER / MEMBER / COLLABORATOR / CONTRIBUTOR / NONE — validators check the first three to determine maintainer status |

---

### View: `pr_review_summary`

Aggregates review counts per PR by review type.

```sql
CREATE VIEW pr_review_summary AS
SELECT
    repo_full_name,
    pr_number,
    COUNT(*) FILTER (WHERE review_state = 'CHANGES_REQUESTED'
                       AND reviewer_association IN ('OWNER', 'MEMBER', 'COLLABORATOR'))
        AS maintainer_changes_requested_count,
    COUNT(*) FILTER (WHERE review_state = 'CHANGES_REQUESTED') AS changes_requested_count,
    COUNT(*) FILTER (WHERE review_state = 'APPROVED') AS approved_count,
    COUNT(*) FILTER (WHERE review_state = 'COMMENTED') AS commented_count
FROM reviews
GROUP BY repo_full_name, pr_number;
```

**Why:** The raw `reviews` table has one row per review submission. Scoring needs counts per PR — specifically `changes_requested_count`, which feeds the review quality multiplier. This view collapses many rows into one per PR. Cheap aggregation, no reason to materialize.

**Columns:**
| Column | Why |
|---|---|
| `repo_full_name` | Which repo |
| `pr_number` | Which PR |
| `maintainer_changes_requested_count` | Direct input to review quality multiplier — only maintainer (OWNER/MEMBER/COLLABORATOR) reviews apply the penalty (15% per round) |
| `changes_requested_count` | Total changes-requested from all reviewers — contextual, not directly scored |
| `approved_count` | Not currently in scoring formulas, but useful signal for dashboards and future scoring changes |
| `commented_count` | Same — contextual, not scored |

---

### View: `pr_linked_issues`

Joins the `closing_issue_numbers` array on each PR against actual issue records. Provides all the raw fields validators need to make their own validity judgments.

```sql
CREATE VIEW pr_linked_issues AS
SELECT
    p.repo_full_name,
    p.pr_number,
    p.author_github_id     AS pr_author_github_id,
    p.merged_at             AS pr_merged_at,
    p.created_at            AS pr_created_at,
    linked.issue_number,
    i.author_github_id      AS issue_author_github_id,
    i.author_association    AS issue_author_association,
    i.state                 AS issue_state,
    i.created_at            AS issue_created_at,
    i.closed_at             AS issue_closed_at,
    i.updated_at            AS issue_updated_at,
    i.is_transferred
FROM pull_requests p
CROSS JOIN LATERAL unnest(p.closing_issue_numbers) AS linked(issue_number)
JOIN issues i
    ON i.repo_full_name = p.repo_full_name
    AND i.issue_number = linked.issue_number;
```

**Why:** The `closing_issue_numbers` array on `pull_requests` is just a list of integers. To evaluate issue validity, validators need the actual issue data alongside the PR data. This view does the unnest + join so the API can serve it in one call. No validity judgments baked in — just timestamps and fields side by side.

**Columns:**
| Column | Why |
|---|---|
| `repo_full_name` | Which repo |
| `pr_number` | Which PR |
| `pr_author_github_id` | Needed for "issue author ≠ PR author" check (self-created issues don't count) |
| `pr_merged_at` | Needed for close-window check (issue must close within 1 day of merge) and post-merge edit check |
| `pr_created_at` | Needed for "issue predates PR" check |
| `issue_number` | The linked issue |
| `issue_author_github_id` | Who filed the issue — the "discoverer" in discovery scoring |
| `issue_author_association` | Determines issue multiplier value: maintainer-authored (OWNER/MEMBER/COLLABORATOR) → 1.66x, others → 1.33x. Validator decides. |
| `issue_state` | Must be CLOSED for multiplier to apply on merged PRs |
| `issue_created_at` | Must predate PR creation for the linkage to be valid |
| `issue_closed_at` | Must be within 1 day of PR merge |
| `issue_updated_at` | If after PR merge → issue was edited post-merge, validators treat this as suspicious |
| `is_transferred` | Flagged for credibility — transferred issues are a potential gaming vector |

---

### View: `pr_scoring_inputs`

The main "give me everything" view for PR scoring. Joins a PR row with its review summary. Every column is a raw fact or simple count. Zero scoring math. Contributor counts (credibility, eligibility) are served via a separate API endpoint with a validator-supplied lookback window — the mirror doesn't hardcode the scoring time window.

```sql
CREATE VIEW pr_scoring_inputs AS
SELECT
    p.repo_full_name,
    p.pr_number,
    p.title,
    p.author_github_id,
    p.author_login,
    p.author_association,
    p.state,
    p.labels,
    p.created_at,
    p.closed_at,
    p.merged_at,
    p.last_edited_at,
    p.merged_by_login,
    p.base_ref,
    p.head_sha,
    p.base_sha,
    p.merge_base_sha,
    p.additions,
    p.deletions,
    p.commits_count,
    p.closing_issue_numbers,
    p.scoring_data_stored,
    -- Anti-gaming flag: PR body edited after merge (blocks issue bonuses)
    CASE WHEN p.last_edited_at > p.merged_at THEN TRUE ELSE FALSE END AS edited_after_merge,
    -- Time fact (not decay — validator computes that)
    EXTRACT(EPOCH FROM (NOW() - p.merged_at)) / 3600.0 AS hours_since_merge,
    -- Review counts (maintainer-only for scoring penalty)
    COALESCE(r.maintainer_changes_requested_count, 0) AS maintainer_changes_requested_count,
    COALESCE(r.changes_requested_count, 0)  AS changes_requested_count,
    COALESCE(r.approved_count, 0)           AS approved_count,
    COALESCE(r.commented_count, 0)          AS commented_count
FROM pull_requests p
LEFT JOIN pr_review_summary r
    ON r.repo_full_name = p.repo_full_name AND r.pr_number = p.pr_number;
```

**Why this view exists:** This is what powers the main validator API endpoint. One query returns everything a validator needs per PR — all facts, all counts, no opinions. The validator takes this, applies its own repo weights, token scoring, credibility formulas, eligibility gates, and multiplier math.

**Columns:**
| Column | Why |
|---|---|
| `repo_full_name` | Which repo — validator maps to repo weight from their own config |
| `pr_number` | Which PR |
| `title` | PR title — informational, not scored |
| `author_github_id` | Stable identity — validator maps to hotkey via identity service |
| `author_login` | Display name for readability |
| `author_association` | Maintainer check (OWNER/MEMBER/COLLABORATOR = maintainer, gets 0 score in own repo) |
| `state` | OPEN/CLOSED/MERGED — determines which scoring path applies |
| `created_at` | 35-day lookback filter, issue-predates-PR check |
| `closed_at` | When the PR was closed (if applicable) |
| `merged_at` | Time decay input, issue close-window check, pioneer ordering |
| `last_edited_at` | Timestamp of last PR body edit — critical for post-merge edit detection |
| `merged_by_login` | Audit — detects self-merge patterns |
| `base_ref` | Validator checks PR targets an acceptable branch |
| `head_sha` | Identifies the exact diff version stored |
| `base_sha` | Together with head_sha, defines what changed |
| `merge_base_sha` | Common ancestor — validators use this for tree-diff scoring |
| `additions` | Total lines added — input to code density calculation |
| `deletions` | Total lines removed — input to code density; sole score source for removed files |
| `commits_count` | Number of commits in the PR — informational |
| `closing_issue_numbers` | Which issues this PR closes — feeds issue multiplier and discovery scoring |
| `scoring_data_stored` | Whether diff/file contents are available via the diff endpoint |
| `edited_after_merge` | Anti-gaming flag — if `true`, all issue bonuses are blocked for this PR |
| `hours_since_merge` | Raw time fact — validator plugs into its own time decay formula |
| `maintainer_changes_requested_count` | Input to review quality multiplier — only maintainer reviews count (15% penalty per round) |
| `changes_requested_count` | Total changes-requested from all reviewers — contextual |
| `approved_count` | Context signal |
| `commented_count` | Context signal |
---

## Validator API Endpoints

```
GET /api/v1/contributors/{github_id}/scoring-inputs?since={date}
    → Returns pr_scoring_inputs rows for this contributor
    → All facts + counts, no scoring math

GET /api/v1/contributors/{github_id}/counts?days={N}
    → Returns aggregated PR/issue counts per repo for this contributor
    → Lookback window is validator-controlled via `days` parameter

GET /api/v1/pull-requests/{owner}/{repo}/{number}/files
    → Returns pr_files + pr_file_contents for token/AST scoring

GET /api/v1/pull-requests/{owner}/{repo}/{number}/linked-issues
    → Returns pr_linked_issues rows for issue multiplier evaluation

GET /api/v1/repos
    → List all tracked repos

GET /api/v1/repos/{owner}/{repo}/issues?state={state}&since={date}
    → Returns issues for discovery scoring

GET /api/v1/repos/{owner}/{repo}/contributors
    → Returns contributor_repo_roles for this repo

GET /api/v1/repos/{owner}/{repo}/label-events?target={number}&since={date}
    → Returns chronological label events for anti-gaming replay
```

---

---

## Gotchas & Design Decisions

### `closing_issue_numbers` extraction — RESOLVED

The `pull_request` webhook payload does not include parsed issue linkages directly. **Decision: use the GraphQL API `closingIssuesReferences`** (option 3). This is the most accurate source — it returns exactly what GitHub will auto-close on merge, avoiding regex fragility and cross-repo reference edge cases. Called on `pull_request.opened`, `.synchronize`, and `.closed`/`.merged` events. One GraphQL call per PR event — trivial rate limit impact given 15,000/hr per installation.

### Webhook ordering

GitHub does not guarantee delivery order. A `pull_request.closed` can arrive before `pull_request.opened` during retry backlog. All webhook handlers must upsert idempotently — never reject an event because a "prior" event hasn't been seen.

### Author association changes

A contributor can be promoted (CONTRIBUTOR → COLLABORATOR) between PR open and merge. The webhook delivers the association at event time. The `contributor_repo_roles` view handles this by taking the latest record, but individual PR rows may have stale associations from earlier events if not re-upserted on every state change.

### App uninstallation

If a repo owner uninstalls the GitHub App, webhooks stop and API calls fail. The `installation.deleted` webhook fires once — handle it by marking the repo inactive in `repos`. Don't retry API calls against uninstalled repos.

### Post-merge PR edits

Someone edits a PR description after merge to add "closes #456". The `pull_request.edited` webhook fires with new body text. The `last_edited_at` timestamp is stored and compared against `merged_at` — if `last_edited_at > merged_at`, the `edited_after_merge` flag in `pr_scoring_inputs` is set to `true`, which **blocks all issue bonuses** for that PR. The `closing_issue_numbers` array is still updated (for data accuracy), but the flag tells validators not to award bonuses.

---

## Future Considerations

### Discovery scoring improvements (Proposals 1-5)

The mirror schema already supports all proposed discovery scoring changes without modification:
- **Smooth credibility curve (P1):** Validators compute from merged/closed counts already provided
- **Repo-weighted credibility (P2):** Validators apply their own repo weights to counts
- **Volume-aware credibility (P3):** Total attempt counts available from contributor counts
- **Per-type credibility (P4):** `label_events` table already tracks `gt:bug`, `gt:feature`, `gt:refactor` label changes — validators can bucket issues by type from this data
- **Dynamic category weights (P5):** Computed from network-wide success rates — validator-side aggregation

### Live data for gittensor-ui

The same API that serves validators can serve the dashboard. PR merges, issue closes, review submissions — all visible within seconds of the webhook arriving. The `pr_scoring_inputs` view works for both audiences.

### Scoring frequency

With real-time data, validator scoring cycles can run more frequently (every 30 minutes or less) instead of waiting for batch GitHub API fetches. The mirror is always current.

---

## Infrastructure & Deployment

### Multi-server architecture

Two identical, stateless NestJS app servers behind a load balancer, sharing one Postgres and one Redis instance. The redundancy is at the **app layer** — if one server dies, the other handles all traffic. Database and Redis redundancy are handled by managed services (auto-failover).

```
                         ┌──── Server A (NestJS + BullMQ worker) ────┐
GitHub ──→ LB ──→        │  webhook handler → upsert + enqueue       │
                         └───────────────┬───────────────────────────┘
                                         │
                         ┌──── Server B (NestJS + BullMQ worker) ────┐
                         │  webhook handler → upsert + enqueue       │
                         └───────────────┬───────────────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              │                     │
                        Postgres (managed)    Redis (managed)
                        with auto-failover    with auto-failover
```

**Why one database, not two:** Two databases means data sync — replication lag, conflict resolution, split-brain scenarios. None of that is worth the complexity. Both app servers are stateless; all state lives in Postgres + Redis. Managed Postgres (RDS, Supabase, Railway) provides automatic failover with a standby replica — this is a solved problem at the infrastructure layer.

**How webhooks flow:** The load balancer sends each webhook to **one** server (not both). Sending to both would double GitHub API calls and create race conditions. The `webhook_deliveries` dedup table handles the edge case where GitHub retries a webhook and the retry hits the other server.

**How fetch jobs work with two servers:** Both servers run BullMQ workers that compete for jobs from the same Redis queue. Redis guarantees each job is dequeued by exactly one worker. If Server A enqueues a job and then dies, Server B's worker picks it up.

### Job queue (BullMQ + Redis)

Webhook handlers that need GitHub API calls (PR file fetches, GraphQL queries) don't call the API inline. Instead, they enqueue jobs to a Redis-backed BullMQ queue:

- **Concurrency:** Workers process up to 5 jobs concurrently (configurable). Prevents API burst during spikes.
- **Retry:** Failed jobs retry 3 times with exponential backoff (5s, 10s, 20s).
- **Dedup:** Jobs use deterministic IDs (`files-{repo}-{pr}`). If a `synchronize` event arrives while a fetch job for the same PR is still queued, the new job replaces the old one.
- **Resilience:** If the app crashes, pending jobs remain in Redis and are picked up on restart (or by the other server).

Only two job types exist:
1. `fetch-closing-issues` — GraphQL call for `closingIssuesReferences`, updates `closing_issue_numbers` on the PR row.
2. `fetch-pr-files` — REST call for PR file list + contents, writes to `pr_files` + `pr_file_contents`, sets `scoring_data_stored = true`.

All other webhook handlers (issues, reviews, comments, labels, installations) are pure DB upserts with no API calls — they execute inline and return immediately.

---

## Scope Constraints

- **Public repos only.** The mirror does not handle private repos. The GitHub App is only installed on public repositories.
- **No scoring logic.** The mirror serves raw facts and counts. All scoring math (credibility, multipliers, eligibility gates, token scoring) is computed by validators.
- **No precomputed AST/token scores.** The mirror stores raw file contents; validators run tree-sitter locally. Token scoring logic is too dynamic to centralize.

---

## Next Steps

1. ~~**Define TypeORM entities**~~ ✅
2. ~~**Implement webhook receiver**~~ ✅ (signature verify, dedup, upsert handlers for all event types)
3. ~~**Implement GraphQL fetcher + diff fetcher**~~ ✅ (BullMQ queue, called on PR open/sync/merge)
4. ~~**Create SQL views**~~ ✅ (`contributor_repo_roles`, `pr_review_summary`, `pr_linked_issues`, `pr_scoring_inputs`)
5. **Build validator API endpoints** — backed by views + raw tables, with API key auth
6. **Backfill service** — fetch historical data when a repo is first installed
7. **Health monitoring** — alert on stale `last_event_at` per repo
