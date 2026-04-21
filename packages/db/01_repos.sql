-- Tracked repositories

CREATE TABLE IF NOT EXISTS repos (
    repo_full_name      VARCHAR(255)    PRIMARY KEY,
    installation_id     BIGINT,
    webhook_secret      VARCHAR(255),
    added_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    last_event_at       TIMESTAMPTZ
);
