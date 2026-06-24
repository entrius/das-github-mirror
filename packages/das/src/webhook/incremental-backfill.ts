/**
 * Pure change-detection predicates for the nightly incremental backfill.
 *
 * The backfill is a safety net behind real-time webhook ingestion, so it should
 * re-fetch only PRs whose data actually changed since last stored. These
 * predicates decide, per PR, whether the expensive follow-up jobs need to run.
 * Both fail SAFE — any uncertainty (no stored row, missing value) returns
 * `true` so the job is enqueued and we never skip a PR that's missing data.
 *
 * Kept dependency-free (no Nest/TypeORM imports) so they're trivially unit
 * testable and so the backfill's correctness is pinned independently of the
 * fetch plumbing around it.
 */

/** The subset of a stored PR row the gates compare against. */
export interface StoredPrState {
  headSha: string | null;
  baseSha: string | null;
  updatedAt: string | null;
  scoringDataStored: boolean;
}

/**
 * Whether the `PR_FILES` content fetch (REST file list + merge-base + batched
 * GraphQL content) needs to run. The file diff is fully determined by the
 * head+base SHA, so it can be skipped only when content is already stored AND
 * both SHAs are unchanged.
 */
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

/**
 * Whether the `PR_METADATA` fetch (closing-issue links, body, state,
 * merged/closed timestamps) needs to run. Gated on GitHub's PR `updatedAt`,
 * which bumps on edits, state changes, merges, closes, and link changes. A null
 * on either side (historic row predating the column, or a PR returned without
 * the field) is treated as "unknown" and forces a re-fetch.
 */
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
