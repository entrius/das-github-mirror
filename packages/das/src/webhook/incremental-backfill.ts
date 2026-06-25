// Pure change-detection predicates for the nightly incremental backfill. Both
// fail safe: any uncertainty (no stored row, null value) returns true so the
// job runs and we never skip a PR that's missing data.

export interface StoredPrState {
  headSha: string | null;
  baseSha: string | null;
  // Read back from a `timestamptz` column, so at runtime TypeORM hydrates this
  // into a Date even though the entity annotates it as a string; tests pass
  // ISO strings. needsMetadataRefresh normalises both shapes before comparing.
  updatedAt: Date | string | null;
  scoringDataStored: boolean;
}

// Content is determined by head+base SHA, so skip the PR_FILES fetch only when
// it's already stored and both SHAs are unchanged.
export function needsContentRefresh(
  stored: StoredPrState | null | undefined,
  headSha: string | null,
  baseSha: string | null,
): boolean {
  return !(
    stored?.scoringDataStored === true &&
    (stored.headSha ?? null) === headSha &&
    (stored.baseSha ?? null) === baseSha
  );
}

// Normalise either a Date (what TypeORM hydrates a `timestamptz` column into)
// or an ISO string (what the GitHub GraphQL API returns, and what tests pass)
// to an epoch-ms instant. Returns null for null/unparseable input so callers
// fail safe. Comparing raw values directly would never match: a Date is never
// `===` a string, and even the DB's text form (`2026-06-01 00:00:00+00`)
// differs from GitHub's ISO form (`2026-06-01T00:00:00Z`).
function toEpochMs(value: Date | string | null): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// updatedAt bumps on edits, state changes, merges, closes and link changes, so
// skip the PR_METADATA fetch only when it matches the stored value. Compare by
// instant, not raw value: the stored side round-trips through a timestamptz
// column (hydrated as a Date), the incoming side is GitHub's ISO string.
export function needsMetadataRefresh(
  stored: StoredPrState | null | undefined,
  updatedAt: string | null,
): boolean {
  const storedMs = stored ? toEpochMs(stored.updatedAt) : null;
  const incomingMs = toEpochMs(updatedAt);
  return !(storedMs != null && incomingMs != null && storedMs === incomingMs);
}
