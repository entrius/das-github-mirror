-- Tracked repositories

CREATE TABLE IF NOT EXISTS repos (
    repo_full_name      VARCHAR(255)    PRIMARY KEY,
    installation_id     BIGINT,
    webhook_secret      VARCHAR(255),
    added_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    last_event_at       TIMESTAMPTZ,
    default_branch      VARCHAR(255),
    -- Gates ingestion: only registered repos are backfilled and have events persisted.
    -- Manually flipped today; a future reconciler will sync from on-chain registration.
    registered          BOOLEAN         NOT NULL DEFAULT FALSE
);
