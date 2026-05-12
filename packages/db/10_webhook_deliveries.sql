-- Webhook delivery dedup (X-GitHub-Delivery header).
-- received_at is set on first sight; processing_started_at tracks an in-flight
-- claim; processed_at is set only after the handler succeeds.
-- This prevents concurrent workers from processing the same delivery while
-- still allowing retries when a claim becomes stale.
-- Pruned daily at 7-day age.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id     VARCHAR(255)    PRIMARY KEY,
    received_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ
);

-- Backfill for existing deployments:
-- - Ensure processed_at exists.
-- - Ensure processing_started_at exists.
-- - Any historic unprocessed row is treated as already processed so very old
--   retries are not replayed.
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
UPDATE webhook_deliveries SET processed_at = received_at WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_age ON webhook_deliveries(received_at);
