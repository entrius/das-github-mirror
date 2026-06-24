// Pure change-detection predicates for the nightly incremental backfill. Both
// fail safe: any uncertainty (no stored row, null value) returns true so the
// job runs and we never skip a PR that's missing data.

export interface StoredPrState {
  headSha: string | null;
  baseSha: string | null;
  updatedAt: string | null;
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

// updatedAt bumps on edits, state changes, merges, closes and link changes, so
// skip the PR_METADATA fetch only when it matches the stored value.
export function needsMetadataRefresh(
  stored: StoredPrState | null | undefined,
  updatedAt: string | null,
): boolean {
  return !(
    stored != null &&
    stored.updatedAt != null &&
    updatedAt != null &&
    stored.updatedAt === updatedAt
  );
}
