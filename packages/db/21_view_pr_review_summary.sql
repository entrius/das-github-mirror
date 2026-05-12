-- Aggregates effective review counts per PR by review type.
-- Each reviewer contributes only their latest submitted review state so stale
-- historical reviews do not continue to count after a later state change.
-- Maintainer-only CHANGES_REQUESTED count is the scoring-relevant field.

CREATE OR REPLACE VIEW pr_review_summary AS
WITH latest_reviews AS (
    SELECT DISTINCT ON (repo_full_name, pr_number, reviewer_github_id)
        repo_full_name,
        pr_number,
        reviewer_github_id,
        reviewer_association,
        review_state
    FROM reviews
    ORDER BY repo_full_name, pr_number, reviewer_github_id, submitted_at DESC
)
SELECT
    repo_full_name,
    pr_number,
    COUNT(*) FILTER (WHERE review_state = 'CHANGES_REQUESTED'
                       AND reviewer_association IN ('OWNER', 'MEMBER', 'COLLABORATOR'))
        AS maintainer_changes_requested_count,
    COUNT(*) FILTER (WHERE review_state = 'CHANGES_REQUESTED') AS changes_requested_count,
    COUNT(*) FILTER (WHERE review_state = 'APPROVED') AS approved_count,
    COUNT(*) FILTER (WHERE review_state = 'COMMENTED') AS commented_count
FROM latest_reviews
GROUP BY repo_full_name, pr_number;
