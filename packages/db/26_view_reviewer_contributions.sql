-- One row per (repo, PR, reviewer): the reviewer's latest review on that PR,
-- joined with PR context. Mirrors the miner-authored PR/issue feeds, but for
-- the review side of contribution scoring (a contributor who reviews others'
-- work, not just opens PRs).
--
-- A reviewer can submit many reviews on a single PR (COMMENTED, then later
-- APPROVED, ...). Scoring should count one effective contribution per PR, so we
-- keep only the latest submitted review per (repo, pr, reviewer) via DISTINCT ON
-- — the same "latest effective state" rule pr_review_summary relies on. The
-- window COUNT exposes how many reviews the reviewer submitted on the PR
-- (engagement depth) without inflating the row count. PR facts (author, state,
-- size) are joined so a validator can weight a review by the PR it covered and
-- exclude self-reviews at read time.

CREATE OR REPLACE VIEW reviewer_contributions AS
SELECT DISTINCT ON (rv.repo_full_name, rv.pr_number, rv.reviewer_github_id)
    rv.repo_full_name,
    rv.pr_number,
    rv.reviewer_github_id,
    rv.reviewer_login,
    rv.reviewer_association,
    rv.review_state,
    rv.submitted_at,
    COUNT(*) OVER (
        PARTITION BY rv.repo_full_name, rv.pr_number, rv.reviewer_github_id
    ) AS review_count,
    p.author_github_id  AS pr_author_github_id,
    p.author_login      AS pr_author_login,
    p.state             AS pr_state,
    p.created_at        AS pr_created_at,
    p.merged_at         AS pr_merged_at,
    p.base_ref          AS pr_base_ref,
    p.additions         AS pr_additions,
    p.deletions         AS pr_deletions
FROM reviews rv
JOIN pull_requests p
    ON p.repo_full_name = rv.repo_full_name
   AND p.pr_number      = rv.pr_number
WHERE rv.reviewer_github_id IS NOT NULL
  AND rv.reviewer_github_id <> ''
ORDER BY
    rv.repo_full_name,
    rv.pr_number,
    rv.reviewer_github_id,
    rv.submitted_at DESC;
