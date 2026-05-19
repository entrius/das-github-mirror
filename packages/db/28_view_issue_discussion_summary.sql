-- Aggregates conversation-thread comment activity per issue. Parallel to
-- pr_discussion_summary; issues have no inline review-comment surface so
-- there is no review_comment companion view here. See #97.

CREATE OR REPLACE VIEW issue_discussion_summary AS
SELECT
    c.repo_full_name,
    c.target_number                                                          AS issue_number,
    COUNT(*)                                                                 AS conversation_comment_count,
    COUNT(DISTINCT c.author_github_id)                                       AS conversation_unique_authors,
    COUNT(*) FILTER (WHERE c.author_association IN ('OWNER','MEMBER','COLLABORATOR'))
                                                                             AS maintainer_conversation_comments,
    COUNT(*) FILTER (WHERE c.author_github_id IS NOT NULL
                       AND c.author_github_id = i.author_github_id)
                                                                             AS author_self_reply_count,
    MAX(c.created_at)                                                        AS last_conversation_comment_at
FROM comments c
LEFT JOIN issues i
       ON i.repo_full_name = c.repo_full_name
      AND i.issue_number   = c.target_number
WHERE c.comment_context = 'issue'
GROUP BY c.repo_full_name, c.target_number, i.author_github_id;
