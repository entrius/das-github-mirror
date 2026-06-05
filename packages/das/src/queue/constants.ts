export const FETCH_QUEUE = "github-fetch";

export const FETCH_JOBS = {
  PR_METADATA: "fetch-pr-metadata",
  PR_FILES: "fetch-pr-files",
  BACKFILL_REPO: "backfill-repo",
  ISSUE_CLOSURE: "fetch-issue-closure",
  RECONCILE_REPOS: "reconcile-repos",
} as const;

export const DEFAULT_BACKFILL_DAYS = 40;

// Reconciler: resync registered repos against the gittensor master list.
// Runs every 2 hours as a BullMQ repeatable job (deduped by repeat key).
export const RECONCILE_CRON = "0 */2 * * *";

// Canonical source of truth for which repos are part of the subnet. Overridable
// via the MASTER_REPOSITORIES_URL env var; this is the default (test branch).
export const DEFAULT_MASTER_REPOSITORIES_URL =
  "https://raw.githubusercontent.com/entrius/gittensor/test/gittensor/validator/weights/master_repositories.json";

export function prFilesJobId(
  repoFullName: string,
  prNumber: number,
  headSha: string | null,
  baseSha: string | null,
): string {
  return `files-${repoFullName}-${prNumber}-${headSha ?? "no-head"}-${
    baseSha ?? "no-base"
  }`;
}
