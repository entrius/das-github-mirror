-- Label events (append-only log for anti-gaming timeline replay).
-- Actor's repo role (author_association) is NOT stored here — neither the
-- webhook sender nor GraphQL LabeledEvent.actor expose it. The labels views
-- resolve the role at read time via contributor_repo_roles.
--
-- Event identity is github_node_id: the globally-unique id of the
-- LabeledEvent/UnlabeledEvent GraphQL node. It is the only path-independent
-- identifier — backfill carries it; the live webhook payload does not. So the
-- live path writes a *provisional* row (github_node_id NULL, timestamp = mirror
-- receive time) and backfill writes the *authoritative* row (github_node_id set,
-- timestamp = GitHub createdAt). Backfill then reconciles: it deletes the
-- provisional duplicate once the authoritative row lands. `timestamp` alone can
-- NOT be the dedup key — it is sourced from two clocks (mirror vs GitHub) that
-- never coincide for the same action (see issue #129).

CREATE TABLE IF NOT EXISTS label_events (
    id                  SERIAL          PRIMARY KEY,
    repo_full_name      VARCHAR(255)    NOT NULL,
    target_number       INTEGER,
    target_type         VARCHAR(5)      NOT NULL DEFAULT 'issue',
    label_name          VARCHAR(255)    NOT NULL,
    action              VARCHAR(20)     NOT NULL,
    actor_github_id     VARCHAR(255),
    actor_login         VARCHAR(255),
    timestamp           TIMESTAMPTZ     NOT NULL,
    github_node_id      VARCHAR
);

-- Existing deployments: add the identity column (NULL for every historic row;
-- those rows are reconciled/back-identified on the next backfill).
ALTER TABLE label_events ADD COLUMN IF NOT EXISTS github_node_id VARCHAR;

CREATE INDEX IF NOT EXISTS idx_label_events_target ON label_events(repo_full_name, target_number, timestamp);

-- One-time cross-path dedup of historic rows. Gated on the presence of the
-- pre-#129 uq_label_events_natural_key index, used here purely as a "not yet
-- migrated" sentinel so this runs exactly once and is a no-op on every later
-- (re)deploy. Before github_node_id existed, the live path stored mirror-receive
-- time and backfill stored GitHub createdAt for the SAME action, and the old
-- natural key (which includes timestamp) never collapsed them — so every action
-- seen by both paths produced two rows. Collapse each such cluster to its
-- earliest row (closest to GitHub's event time). Genuine repeat actions
-- (add -> remove -> re-add) are spaced far wider than the webhook delivery
-- window, so they survive. The 120s window MUST match
-- LABEL_EVENT_RECONCILE_WINDOW_SECONDS in github-fetcher.service.ts.
DO $$
BEGIN
    IF to_regclass('public.uq_label_events_natural_key') IS NOT NULL THEN
        DELETE FROM label_events later
        WHERE later.github_node_id IS NULL
          AND EXISTS (
              SELECT 1
              FROM label_events earlier
              WHERE earlier.repo_full_name = later.repo_full_name
                AND earlier.target_number  IS NOT DISTINCT FROM later.target_number
                AND earlier.target_type    = later.target_type
                AND earlier.label_name     = later.label_name
                AND earlier.action         = later.action
                AND earlier.github_node_id IS NULL
                AND earlier.timestamp      < later.timestamp
                AND later.timestamp - earlier.timestamp <= interval '120 seconds'
          );
    END IF;
END $$;

-- Retire the old guard: it includes `timestamp` (so it never collapses
-- cross-path duplicates) and, worse, with NULLS NOT DISTINCT it would collapse
-- two genuinely-distinct events that happen to share a createdAt second — the
-- exact case github_node_id is meant to keep apart.
DROP INDEX IF EXISTS uq_label_events_natural_key;

-- Dedup guard repointed onto the stable GitHub identity. Partial so the many
-- provisional live rows (github_node_id NULL) are never constrained against each
-- other; backfill↔backfill collapses by true identity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_label_events_github_node_id
    ON label_events (github_node_id)
    WHERE github_node_id IS NOT NULL;
