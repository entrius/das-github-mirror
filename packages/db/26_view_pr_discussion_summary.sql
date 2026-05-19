-- Aggregates conversation-thread comment activity per PR.
-- Pairs with pr_review_comment_summary (inline review comments) to give the
-- miners API a single discussion_summary field per row. See #97.
-- Maintainer counts identify reviewer engagement vs. drive-by noise;
-- author_self_reply_count plus the conversation total lets consumers compute
-- an author-self-reply share without rejoining to pull_requests.

CREATE OR REPLACE VIEW pr_discussion_summary AS
SELECT
    c.repo_full_name,
    c.target_number                                                          AS pr_number,
    COUNT(*)                                                                 AS conversation_comment_count,
    COUNT(DISTINCT c.author_github_id)                                       AS conversation_unique_authors,
    COUNT(*) FILTER (WHERE c.author_association IN ('OWNER','MEMBER','COLLABORATOR'))
                                                                             AS maintainer_conversation_comments,
    COUNT(*) FILTER (WHERE c.author_github_id IS NOT NULL
                       AND c.author_github_id = p.author_github_id)
                                                                             AS author_self_reply_count,
    MAX(c.created_at)                                                        AS last_conversation_comment_at
FROM comments c
LEFT JOIN pull_requests p
       ON p.repo_full_name = c.repo_full_name
      AND p.pr_number      = c.target_number
WHERE c.comment_context = 'pr'
GROUP BY c.repo_full_name, c.target_number, p.author_github_id;
