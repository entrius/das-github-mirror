import test from "node:test";
import assert from "node:assert/strict";
import { shouldBackfillPullRequestForSince } from "./github-fetcher.service";

const since = new Date("2026-01-10T00:00:00.000Z");

test("includes old-created recently-merged PR", () => {
  const included = shouldBackfillPullRequestForSince(
    {
      state: "MERGED",
      createdAt: "2025-01-01T00:00:00.000Z",
      mergedAt: "2026-01-11T12:00:00.000Z",
    },
    since,
  );

  assert.equal(included, true);
});

test("excludes old-created still-open PR", () => {
  const included = shouldBackfillPullRequestForSince(
    {
      state: "OPEN",
      createdAt: "2025-01-01T00:00:00.000Z",
      mergedAt: null,
    },
    since,
  );

  assert.equal(included, false);
});

test("excludes old-created recently-closed non-merged PR", () => {
  const included = shouldBackfillPullRequestForSince(
    {
      state: "CLOSED",
      createdAt: "2025-01-01T00:00:00.000Z",
      mergedAt: null,
    },
    since,
  );

  assert.equal(included, false);
});
