export const FETCH_QUEUE = "github-fetch";

export const FETCH_JOBS = {
  CLOSING_ISSUES: "fetch-closing-issues",
  PR_FILES: "fetch-pr-files",
  BACKFILL_REPO: "backfill-repo",
} as const;

export const DEFAULT_BACKFILL_DAYS = 40;
