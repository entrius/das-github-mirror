/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import assert from "node:assert/strict";
import test from "node:test";
import { GitHubFetcherService } from "./github-fetcher.service";

type MockRepo<T extends Record<string, any>> = {
  row: T | null;
  deletes: unknown[];
  upserts: Record<string, unknown>[];
  updates: unknown[];
  repo: {
    findOneBy: (criteria: Record<string, unknown>) => Promise<T | null>;
    update: (
      criteria: Record<string, unknown> | string,
      patch: Record<string, unknown>,
    ) => Promise<{ affected: number }>;
    upsert: (
      data: Record<string, unknown>,
      conflictPaths?: string[],
    ) => Promise<void>;
    delete: (criteria: Record<string, unknown>) => Promise<void>;
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

function matchesCriteria<T extends Record<string, any>>(
  row: T | null,
  criteria: Record<string, unknown>,
): boolean {
  if (!row) return false;
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function createFetcher(
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

void test("fetchAndStorePrFiles stores base content for removed files", async () => {
  const prFileRepo = createMockRepo();
  const prFileContentRepo = createMockRepo();
  const prRepo = createMockRepo({
    repoFullName: "owner/repo",
    prNumber: 7,
    headSha: "H1",
    baseSha: "B1",
    mergeBaseSha: null,
  });
  const fetcher = createFetcher(prFileRepo, prFileContentRepo, prRepo);

  (fetcher as any).getTokenForRepo = (): Promise<string> =>
    Promise.resolve("token");
  (fetcher as any).fetchMergeBaseSha = (): Promise<string> =>
    Promise.resolve("M1");
  (fetcher as any).fetchAllPrFiles = (): Promise<unknown[]> =>
    Promise.resolve([
      {
        filename: "src/old.ts",
        status: "removed",
        additions: 0,
        deletions: 20,
        changes: 20,
      },
    ]);

  let graphQlCalls = 0;
  (fetcher as any).githubFetch = (
    _url: string,
    init: { body?: string },
  ): Promise<unknown> => {
    graphQlCalls++;
    const body = JSON.parse(init.body ?? "{}") as { query?: string };
    assert.match(
      body.query ?? "",
      /base0: object\(expression: "M1:src\/old\.ts"\)/,
    );
    assert.doesNotMatch(body.query ?? "", /head0:/);

    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            repository: {
              base0: {
                text: "const deleted = true;\n",
                byteSize: 22,
                isBinary: false,
              },
            },
          },
        }),
    });
  };

  await fetcher.fetchAndStorePrFiles("owner/repo", 7);

  assert.equal(graphQlCalls, 1);
  assert.deepEqual(prFileRepo.upserts, [
    {
      repoFullName: "owner/repo",
      prNumber: 7,
      filename: "src/old.ts",
      previousFilename: null,
      status: "removed",
      additions: 0,
      deletions: 20,
      changes: 20,
    },
  ]);
  assert.deepEqual(prFileContentRepo.upserts, [
    {
      repoFullName: "owner/repo",
      prNumber: 7,
      filename: "src/old.ts",
      baseContent: "const deleted = true;\n",
      headContent: null,
      isBinary: false,
      byteSize: 22,
    },
  ]);
});
