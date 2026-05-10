-- Natural-key UNIQUE constraint for label_events (idempotency for backfill).
--
-- A label timeline event is uniquely identified by:
--   (repo_full_name, target_number, target_type, label_name, action, timestamp)
--
-- GraphQL LabeledEvent.createdAt is the actual event time and is stable
-- across queries, so backfill re-runs collide and INSERT ... ON CONFLICT
-- DO NOTHING (from saveLabelTimelineEvents) becomes a no-op for already-
-- written events.
--
-- NULLS NOT DISTINCT (PG 15+) defends the rare case where target_number
-- ends up NULL — without it, PG default treats NULL as distinct and the
-- constraint would not prevent that duplicate.
--
-- Order: this file must run AFTER 11_label_events_dedup.sql. On a polluted
-- table the index build will fail with a unique-violation error; that is
-- the intended safety check.
--
-- Production operators applying this to a running database should prefer:
--
--     CREATE UNIQUE INDEX CONCURRENTLY uq_label_events_natural_key
--         ON label_events (repo_full_name, target_number, target_type,
--                          label_name, action, timestamp)
--         NULLS NOT DISTINCT;
--
-- CONCURRENTLY is omitted here because it cannot run inside a transaction
-- block, and docker-entrypoint-initdb.d scripts only run on fresh databases
-- where the table is empty and locking is not a concern.

CREATE UNIQUE INDEX IF NOT EXISTS uq_label_events_natural_key
    ON label_events (
        repo_full_name,
        target_number,
        target_type,
        label_name,
        action,
        timestamp
    )
    NULLS NOT DISTINCT;
