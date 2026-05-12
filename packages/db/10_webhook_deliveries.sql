-- Webhook delivery dedup (X-GitHub-Delivery header).
-- received_at is set on first sight; processed_at is set only after the
-- handler succeeds. A retry whose row exists with processed_at IS NULL
-- means the previous attempt crashed mid-handler and must be reprocessed.
-- Pruned daily at 7-day age.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id     VARCHAR(255)    PRIMARY KEY,
    received_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ
);

-- Backfill for existing deployments: any row that predates this column is
-- treated as fully processed so GitHub retries for historic deliveries
-- aren't re-run.
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
UPDATE webhook_deliveries SET processed_at = received_at WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_age ON webhook_deliveries(received_at);
