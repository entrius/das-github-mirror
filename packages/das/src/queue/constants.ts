export const FETCH_QUEUE = "github-fetch";

export const FETCH_JOBS = {
  PR_METADATA: "fetch-pr-metadata",
  PR_FILES: "fetch-pr-files",
  BACKFILL_REPO: "backfill-repo",
  ISSUE_CLOSURE: "fetch-issue-closure",
  RECONCILE_REGISTRY: "reconcile-registry",
} as const;

export const DEFAULT_BACKFILL_DAYS = 40;

export const REGISTRY_RECONCILE_CRON = "0 */2 * * *";

export const MASTER_REPOSITORIES_URL =
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
