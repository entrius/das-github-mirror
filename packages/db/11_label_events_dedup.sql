-- One-shot dedupe pass for label_events.
--
-- Prior to the issue #25 fix, saveLabelTimelineEvents() and the webhook label
-- handler called labelEventRepo.save() without a natural-key conflict path,
-- so every backfill (and every BullMQ retry of a partial backfill) re-inserted
-- the full label history of every PR and issue. The DISTINCT ON in the
-- pr_labels_by_actor / issue_labels_by_actor views masked the duplication
-- from API consumers, allowing the table to grow unbounded.
--
-- This DELETE collapses exact-duplicate rows to a single survivor (lowest id).
-- It is:
--   * idempotent — on an already-clean table it deletes zero rows
--   * safe on fresh installs — empty table, no-op
--   * order-dependent — must run before 12_label_events_constraints.sql,
--     which adds the UNIQUE constraint that would otherwise fail to build
--
-- For very large production tables, prefer the batched form below over the
-- single DELETE, which holds locks for the duration of the scan:
--
--     DELETE FROM label_events WHERE id IN (
--         SELECT id FROM label_events l
--         WHERE EXISTS (
--             SELECT 1 FROM label_events l2
--             WHERE l2.repo_full_name = l.repo_full_name
--               AND l2.target_number IS NOT DISTINCT FROM l.target_number
--               AND l2.target_type    = l.target_type
--               AND l2.label_name     = l.label_name
--               AND l2.action         = l.action
--               AND l2.timestamp      = l.timestamp
--               AND l2.id             < l.id
--         )
--         LIMIT 10000
--     );  -- repeat until 0 rows affected

DELETE FROM label_events a
USING label_events b
WHERE a.id > b.id
  AND a.repo_full_name = b.repo_full_name
  AND a.target_number IS NOT DISTINCT FROM b.target_number
  AND a.target_type    = b.target_type
  AND a.label_name     = b.label_name
  AND a.action         = b.action
  AND a.timestamp      = b.timestamp;
