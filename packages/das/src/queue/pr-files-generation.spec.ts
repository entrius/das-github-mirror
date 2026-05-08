/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import test from "node:test";
import assert from "node:assert/strict";
import { FETCH_JOBS } from "./constants";
import { FetchProcessor } from "./fetch.processor";
import { PullRequestHandler } from "../webhook/handlers/pull-request.handler";
import { GitHubFetcherService } from "../webhook/github-fetcher.service";
import { PrFile, PrFileContent, PullRequest } from "../entities";

type MockRepo<T extends Record<string, any>> = {
  row: T | null;
  deletes: unknown[];
  upserts: unknown[];
  updates: unknown[];
  repo: {
    findOneBy: (criteria: Record<string, unknown>) => Promise<T | null>;
    findOne: (options: {
      where?: Record<string, unknown>;
    }) => Promise<T | null>;
    update: (
      criteria: Record<string, unknown> | string,
      patch: Record<string, unknown>,
    ) => Promise<{ affected: number }>;
    upsert: (
      data: Record<string, unknown>,
      conflictPaths?: string[],
    ) => Promise<void>;
    delete: (criteria: Record<string, unknown>) => Promise<void>;
    manager?: {
      transaction: <R>(work: (manager: any) => Promise<R>) => Promise<R>;
    };
  };
};

function createMockRepo<T extends Record<string, any>>(
  initialRow: T | null = null,
): MockRepo<T> {
  const mock: MockRepo<T> = {
    row: initialRow,
    deletes: [],
    upserts: [],
    updates: [],
    repo: {
      findOneBy: (criteria: Record<string, unknown>): Promise<T | null> =>
        Promise.resolve(matchesCriteria(mock.row, criteria) ? mock.row : null),
      findOne: (options: {
        where?: Record<string, unknown>;
      }): Promise<T | null> =>
        Promise.resolve(
          matchesCriteria(mock.row, options.where ?? {}) ? mock.row : null,
        ),
      update: (
        criteria: Record<string, unknown> | string,
        patch: Record<string, unknown>,
      ): Promise<{ affected: number }> => {
        mock.updates.push({ criteria, patch });
        if (
          mock.row &&
          (typeof criteria === "string" || matchesCriteria(mock.row, criteria))
        ) {
          Object.assign(mock.row, patch);
          return Promise.resolve({ affected: 1 });
        }
        return Promise.resolve({ affected: 0 });
      },
      upsert: (data: Record<string, unknown>): Promise<void> => {
        mock.upserts.push(data);
        mock.row = { ...mock.row, ...data } as T;
        return Promise.resolve();
      },
      delete: (criteria: Record<string, unknown>): Promise<void> => {
        mock.deletes.push(criteria);
        return Promise.resolve();
      },
    },
  };

  return mock;
}

function createTransactionManager(
  repos: Map<unknown, MockRepo<any>>,
  beforeTransaction?: () => void,
): {
  transaction: <R>(work: (manager: any) => Promise<R>) => Promise<R>;
} {
  return {
    transaction: async <R>(work: (manager: any) => Promise<R>): Promise<R> => {
      beforeTransaction?.();
      return work({
        getRepository: (entity: unknown) => {
          const repo = repos.get(entity);
          if (!repo) {
            throw new Error(`No mock repository for ${String(entity)}`);
          }
          return repo.repo;
        },
      });
    },
  };
}

function attachPrFilesTransactionManager(
  prRepo: MockRepo<any>,
  prFileRepo: MockRepo<any>,
  prFileContentRepo: MockRepo<any>,
  beforeTransaction?: () => void,
): void {
  prRepo.repo.manager = createTransactionManager(
    new Map<unknown, MockRepo<any>>([
      [PullRequest, prRepo],
      [PrFile, prFileRepo],
      [PrFileContent, prFileContentRepo],
    ]),
    beforeTransaction,
  );
}

function matchesCriteria<T extends Record<string, any>>(
  row: T | null,
  criteria: Record<string, unknown>,
): boolean {
  if (!row) return false;
  for (const [key, value] of Object.entries(criteria)) {
    if (isNullFindOperator(value)) {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
}

function isNullFindOperator(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "_type" in value &&
    (value as { _type?: unknown })._type === "isNull"
  );
}

function createQueue(): {
  added: Array<{ name: string; data: any; opts: any }>;
  queue: { add: (name: string, data: any, opts: any) => Promise<void> };
} {
  const added: Array<{ name: string; data: any; opts: any }> = [];
  return {
    added,
    queue: {
      add: (name: string, data: any, opts: any): Promise<void> => {
        added.push({ name, data, opts });
        return Promise.resolve();
      },
    },
  };
}

function synchronizePayload(): Record<string, any> {
  return {
    action: "synchronize",
    repository: { full_name: "owner/repo" },
    pull_request: {
      number: 7,
      title: "PR",
      state: "open",
      merged: false,
      created_at: "2026-05-01T00:00:00Z",
      closed_at: null,
      merged_at: null,
      user: { id: 123, login: "miner" },
      author_association: "CONTRIBUTOR",
      merged_by: null,
      base: { ref: "test", sha: "B2" },
      head: {
        ref: "feature",
        sha: "H2",
        repo: { full_name: "owner/repo" },
      },
      additions: 1,
      deletions: 0,
      commits: 1,
      labels: [],
    },
  };
}

function createGitHubFetcher(
  prFileRepo: MockRepo<any>,
  prFileContentRepo: MockRepo<any>,
  prRepo: MockRepo<any>,
): GitHubFetcherService {
  const otherRepo = createMockRepo();
  const config = {
    getOrThrow: (key: string): string =>
      key === "GITHUB_APP_ID" ? "123" : "/tmp/private-key.pem",
  };
  return new GitHubFetcherService(
    config as any,
    prFileRepo.repo as any,
    prFileContentRepo.repo as any,
    prRepo.repo as any,
    otherRepo.repo as any,
    otherRepo.repo as any,
    otherRepo.repo as any,
    otherRepo.repo as any,
  );
}

void test("synchronize enqueues a PR file job for the webhook head/base generation", async () => {
  const prRepo = createMockRepo();
  const repoRepo = createMockRepo({ repoFullName: "owner/repo" });
  const queue = createQueue();
  const handler = new PullRequestHandler(
    prRepo.repo as any,
    repoRepo.repo as any,
    queue.queue as any,
  );

  await handler.handle(synchronizePayload());

  const fileJob = queue.added.find((job) => job.name === FETCH_JOBS.PR_FILES);
  assert.ok(fileJob);
  assert.equal(fileJob.data.repoFullName, "owner/repo");
  assert.equal(fileJob.data.prNumber, 7);
  assert.equal(fileJob.data.expectedHeadSha, "H2");
  assert.equal(fileJob.data.expectedBaseSha, "B2");
  assert.equal(fileJob.opts.jobId, "files-owner/repo-7-H2-B2");
});

void test("stale PR file jobs cannot mark a newer PR generation complete", async () => {
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H1",
    baseSha: "B1",
    scoringDataStored: false,
  });
  const issueRepo = createMockRepo();
  const queue = createQueue();
  const fetcher = {
    fetchAndStorePrFiles: (
      _repoFullName: string,
      _prNumber: number,
      generation: { headSha: string | null; baseSha: string | null },
    ): Promise<{ status: "stored" }> => {
      assert.deepEqual(generation, { headSha: "H1", baseSha: "B1" });
      Object.assign(prRepo.row ?? {}, {
        headSha: "H2",
        baseSha: "B2",
        scoringDataStored: false,
      });
      return Promise.resolve({ status: "stored" });
    },
  };
  const processor = new FetchProcessor(
    fetcher as any,
    prRepo.repo as any,
    issueRepo.repo as any,
    queue.queue as any,
  );

  await processor.process({
    name: FETCH_JOBS.PR_FILES,
    data: {
      repoFullName: "owner/repo",
      prNumber: 7,
      expectedHeadSha: "H1",
      expectedBaseSha: "B1",
    },
  } as any);

  assert.equal(prRepo.row?.headSha, "H2");
  assert.equal(prRepo.row?.baseSha, "B2");
  assert.equal(prRepo.row?.scoringDataStored, false);
  assert.equal(queue.added.length, 1);
  assert.equal(queue.added[0].opts.jobId, "files-owner/repo-7-H2-B2");
  assert.equal(queue.added[0].data.expectedHeadSha, "H2");
  assert.equal(queue.added[0].data.expectedBaseSha, "B2");
});

void test("stale PR file jobs invalidate and requeue a completed newer generation", async () => {
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H2",
    baseSha: "B2",
    scoringDataStored: true,
  });
  const issueRepo = createMockRepo();
  const queue = createQueue();
  const fetcher = {
    fetchAndStorePrFiles: (): Promise<{ status: "stale" }> =>
      Promise.resolve({ status: "stale" }),
  };
  const processor = new FetchProcessor(
    fetcher as any,
    prRepo.repo as any,
    issueRepo.repo as any,
    queue.queue as any,
  );

  await processor.process({
    name: FETCH_JOBS.PR_FILES,
    data: {
      repoFullName: "owner/repo",
      prNumber: 7,
      expectedHeadSha: "H1",
      expectedBaseSha: "B1",
    },
  } as any);

  assert.equal(prRepo.row?.scoringDataStored, false);
  assert.equal(queue.added.length, 1);
  assert.equal(queue.added[0].opts.jobId, "files-owner/repo-7-H2-B2");
  assert.equal(queue.added[0].data.expectedHeadSha, "H2");
  assert.equal(queue.added[0].data.expectedBaseSha, "B2");
});

void test("current PR file jobs mark the matching generation complete", async () => {
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H2",
    baseSha: "B2",
    scoringDataStored: false,
  });
  const issueRepo = createMockRepo();
  const queue = createQueue();
  const fetcher = {
    fetchAndStorePrFiles: (
      _repoFullName: string,
      _prNumber: number,
      generation: { headSha: string | null; baseSha: string | null },
    ): Promise<{ status: "stored" }> => {
      assert.deepEqual(generation, { headSha: "H2", baseSha: "B2" });
      return Promise.resolve({ status: "stored" });
    },
  };
  const processor = new FetchProcessor(
    fetcher as any,
    prRepo.repo as any,
    issueRepo.repo as any,
    queue.queue as any,
  );

  await processor.process({
    name: FETCH_JOBS.PR_FILES,
    data: {
      repoFullName: "owner/repo",
      prNumber: 7,
      expectedHeadSha: "H2",
      expectedBaseSha: "B2",
    },
  } as any);

  assert.equal(prRepo.row?.scoringDataStored, true);
  assert.equal(queue.added.length, 0);
});

void test("legacy PR file jobs resolve the current generation from the PR row", async () => {
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H2",
    baseSha: "B2",
    scoringDataStored: false,
  });
  const issueRepo = createMockRepo();
  const queue = createQueue();
  const fetcher = {
    fetchAndStorePrFiles: (
      _repoFullName: string,
      _prNumber: number,
      generation: { headSha: string | null; baseSha: string | null },
    ): Promise<{ status: "stored" }> => {
      assert.deepEqual(generation, { headSha: "H2", baseSha: "B2" });
      return Promise.resolve({ status: "stored" });
    },
  };
  const processor = new FetchProcessor(
    fetcher as any,
    prRepo.repo as any,
    issueRepo.repo as any,
    queue.queue as any,
  );

  await processor.process({
    name: FETCH_JOBS.PR_FILES,
    data: {
      repoFullName: "owner/repo",
      prNumber: 7,
    },
  } as any);

  assert.equal(prRepo.row?.scoringDataStored, true);
  assert.equal(queue.added.length, 0);
});

void test("fetcher skips destructive file writes when the job generation is already stale", async () => {
  const prFileRepo = createMockRepo();
  const prFileContentRepo = createMockRepo();
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H2",
    baseSha: "B2",
    mergeBaseSha: null,
  });
  const fetcher = createGitHubFetcher(prFileRepo, prFileContentRepo, prRepo);

  (fetcher as any).getTokenForRepo = (): Promise<string> =>
    Promise.resolve("token");
  (fetcher as any).fetchMergeBaseSha = (): Promise<string> =>
    Promise.resolve("M2");
  (fetcher as any).fetchAllPrFiles = (): Promise<unknown[]> =>
    Promise.resolve([]);

  const result = await fetcher.fetchAndStorePrFiles("owner/repo", 7, {
    headSha: "H1",
    baseSha: "B1",
  });

  assert.deepEqual(result, { status: "stale" });
  assert.equal(prFileRepo.deletes.length, 0);
  assert.equal(prFileContentRepo.deletes.length, 0);
  assert.equal(prFileRepo.upserts.length, 0);
  assert.equal(prFileContentRepo.upserts.length, 0);
});

void test("fetcher replaces PR file rows when the generation is current under the row lock", async () => {
  const prFileRepo = createMockRepo();
  const prFileContentRepo = createMockRepo();
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: null,
    baseSha: null,
    mergeBaseSha: null,
  });
  attachPrFilesTransactionManager(prRepo, prFileRepo, prFileContentRepo);
  const fetcher = createGitHubFetcher(prFileRepo, prFileContentRepo, prRepo);

  (fetcher as any).getTokenForRepo = (): Promise<string> =>
    Promise.resolve("token");
  (fetcher as any).fetchAllPrFiles = (): Promise<unknown[]> =>
    Promise.resolve([
      {
        filename: "src/app.ts",
        previous_filename: undefined,
        status: "modified",
        additions: 3,
        deletions: 1,
        changes: 4,
      },
    ]);

  const result = await fetcher.fetchAndStorePrFiles("owner/repo", 7, {
    headSha: null,
    baseSha: null,
  });

  assert.deepEqual(result, { status: "stored" });
  assert.deepEqual(prFileRepo.deletes, [
    { repoFullName: "owner/repo", prNumber: 7 },
  ]);
  assert.deepEqual(prFileContentRepo.deletes, [
    { repoFullName: "owner/repo", prNumber: 7 },
  ]);
  assert.deepEqual(prFileRepo.upserts, [
    {
      repoFullName: "owner/repo",
      prNumber: 7,
      filename: "src/app.ts",
      previousFilename: null,
      status: "modified",
      additions: 3,
      deletions: 1,
      changes: 4,
    },
  ]);
  assert.equal(prFileContentRepo.upserts.length, 0);
});

void test("fetcher rechecks generation under the row lock before deleting PR file rows", async () => {
  const prFileRepo = createMockRepo();
  const prFileContentRepo = createMockRepo();
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H1",
    baseSha: "B1",
    mergeBaseSha: null,
    scoringDataStored: false,
  });
  let raced = false;
  const deletePrFiles = prFileRepo.repo.delete;
  prFileRepo.repo.delete = async (
    criteria: Record<string, unknown>,
  ): Promise<void> => {
    if (!raced) {
      Object.assign(prRepo.row ?? {}, {
        headSha: "H2",
        baseSha: "B2",
        scoringDataStored: true,
      });
      raced = true;
    }
    await deletePrFiles(criteria);
  };
  attachPrFilesTransactionManager(prRepo, prFileRepo, prFileContentRepo, () => {
    if (!raced) {
      Object.assign(prRepo.row ?? {}, {
        headSha: "H2",
        baseSha: "B2",
        scoringDataStored: true,
      });
      raced = true;
    }
  });
  const fetcher = createGitHubFetcher(prFileRepo, prFileContentRepo, prRepo);

  (fetcher as any).getTokenForRepo = (): Promise<string> =>
    Promise.resolve("token");
  (fetcher as any).fetchMergeBaseSha = (): Promise<string | null> =>
    Promise.resolve(null);
  (fetcher as any).fetchAllPrFiles = (): Promise<unknown[]> =>
    Promise.resolve([
      {
        filename: "src/app.ts",
        status: "removed",
        additions: 0,
        deletions: 4,
        changes: 4,
      },
    ]);

  const result = await fetcher.fetchAndStorePrFiles("owner/repo", 7, {
    headSha: "H1",
    baseSha: "B1",
  });

  assert.deepEqual(result, { status: "stale" });
  assert.equal(prRepo.row?.headSha, "H2");
  assert.equal(prRepo.row?.baseSha, "B2");
  assert.equal(prRepo.row?.scoringDataStored, true);
  assert.equal(prFileRepo.deletes.length, 0);
  assert.equal(prFileContentRepo.deletes.length, 0);
  assert.equal(prFileRepo.upserts.length, 0);
  assert.equal(prFileContentRepo.upserts.length, 0);
});

void test("fetcher rechecks generation under the row lock before storing PR file contents", async () => {
  const prFileRepo = createMockRepo();
  const prFileContentRepo = createMockRepo();
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H1",
    baseSha: "B1",
    mergeBaseSha: null,
    scoringDataStored: false,
  });
  let transactionCount = 0;
  const upsertContent = prFileContentRepo.repo.upsert;
  prFileContentRepo.repo.upsert = async (
    data: Record<string, unknown>,
    conflictPaths?: string[],
  ): Promise<void> => {
    Object.assign(prRepo.row ?? {}, {
      headSha: "H2",
      baseSha: "B2",
      scoringDataStored: true,
    });
    await upsertContent(data, conflictPaths);
  };
  attachPrFilesTransactionManager(prRepo, prFileRepo, prFileContentRepo, () => {
    transactionCount++;
    if (transactionCount === 2) {
      Object.assign(prRepo.row ?? {}, {
        headSha: "H2",
        baseSha: "B2",
        scoringDataStored: true,
      });
    }
  });
  const fetcher = createGitHubFetcher(prFileRepo, prFileContentRepo, prRepo);

  (fetcher as any).getTokenForRepo = (): Promise<string> =>
    Promise.resolve("token");
  (fetcher as any).fetchMergeBaseSha = (): Promise<string | null> =>
    Promise.resolve(null);
  (fetcher as any).fetchAllPrFiles = (): Promise<unknown[]> =>
    Promise.resolve([
      {
        filename: "src/app.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        changes: 4,
      },
    ]);
  (fetcher as any).githubFetch = (): Promise<{
    ok: true;
    json: () => Promise<Record<string, any>>;
  }> =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            repository: {
              base0: { text: "old", byteSize: 3, isBinary: false },
              head0: { text: "new", byteSize: 3, isBinary: false },
            },
          },
        }),
    });

  const result = await fetcher.fetchAndStorePrFiles("owner/repo", 7, {
    headSha: "H1",
    baseSha: "B1",
  });

  assert.deepEqual(result, { status: "stale" });
  assert.equal(prRepo.row?.headSha, "H2");
  assert.equal(prRepo.row?.baseSha, "B2");
  assert.equal(prRepo.row?.scoringDataStored, true);
  assert.equal(prFileRepo.deletes.length, 1);
  assert.equal(prFileContentRepo.deletes.length, 1);
  assert.equal(prFileRepo.upserts.length, 1);
  assert.equal(prFileContentRepo.upserts.length, 0);
});
