-- Extend webhook_deliveries to support replay and error tracking.
-- Adds event_type, payload, failed_at, and last_error columns.
-- Payload retention for replay is 30 days (vs. 7 days for rows without payloads).

ALTER TABLE webhook_deliveries 
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Index for querying failed deliveries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_failed 
  ON webhook_deliveries(failed_at) 
  WHERE failed_at IS NOT NULL;

-- Index for payload retention (used by prune service)
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_payload_age 
  ON webhook_deliveries(received_at) 
  WHERE payload IS NOT NULL;
