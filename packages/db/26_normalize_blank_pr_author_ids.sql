-- Normalize legacy bad rows where unknown PR author IDs were stored as blanks.
-- Unknown author identity must be NULL so solver-credit filters can exclude it.

UPDATE pull_requests
SET author_github_id = NULL
WHERE author_github_id IS NOT NULL
  AND BTRIM(author_github_id) = '';
