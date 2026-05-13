-- Tracked repositories

CREATE TABLE IF NOT EXISTS repos (
    repo_full_name      VARCHAR(255)    PRIMARY KEY,
    github_repo_id      BIGINT,
    installation_id     BIGINT,
    webhook_secret      VARCHAR(255),
    added_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    last_event_at       TIMESTAMPTZ,
    default_branch      VARCHAR(255),
    -- Gates ingestion: only registered repos are backfilled and have events persisted.
    -- Manually flipped today; a future reconciler will sync from on-chain registration.
    registered          BOOLEAN         NOT NULL DEFAULT FALSE
);

ALTER TABLE repos ADD COLUMN IF NOT EXISTS github_repo_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_github_repo_id
    ON repos(github_repo_id)
    WHERE github_repo_id IS NOT NULL;
