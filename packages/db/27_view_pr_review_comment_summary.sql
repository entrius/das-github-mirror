-- Aggregates inline diff-review comments per PR. Distinct from
-- pr_discussion_summary (thread-level comments) and pr_review_summary
-- (review-state counts: APPROVED / CHANGES_REQUESTED / COMMENTED). See #97.
-- review_comments has no `reviewer_association` column, so maintainer-only
-- counts are not derivable here without a join to repo roles — kept out of
-- v1 to keep this view self-contained; reuse pr_review_summary's
-- maintainer_changes_requested_count for "did a maintainer engage" signal.

CREATE OR REPLACE VIEW pr_review_comment_summary AS
SELECT
    repo_full_name,
    pr_number,
    COUNT(*)                            AS review_comment_count,
    COUNT(DISTINCT reviewer_github_id)  AS review_comment_unique_authors,
    MAX(created_at)                     AS last_review_comment_at
FROM review_comments
GROUP BY repo_full_name, pr_number;
