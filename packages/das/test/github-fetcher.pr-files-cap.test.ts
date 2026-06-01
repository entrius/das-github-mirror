import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GitHubFetcherService } from "../src/webhook/github-fetcher.service";

interface TestServiceOptions {
  changedFiles: number;
  filePages?: any[][];
  pr?: Record<string, unknown>;
}

function makeRepo() {
  return {
    update: async () => undefined,
    upsert: async () => undefined,
    delete: async () => undefined,
    findOneBy: async () => null,
    createQueryBuilder: () => ({
      where: () => ({
        getOne: async () => null,
      }),
    }),
  };
}

function makeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
    headers: new Headers(),
  } as Response;
}

function makeService(options: TestServiceOptions) {
  const prUpdates: any[] = [];
  const prFileDeletes: any[] = [];
  const prFileContentDeletes: any[] = [];
  const prFileUpserts: any[] = [];
  const requests: string[] = [];
  const filePages = [...(options.filePages ?? [])];

  const prRepo = {
    ...makeRepo(),
    findOneBy: async () => ({
      headSha: "head-sha",
      baseSha: null,
      mergeBaseSha: null,
      ...options.pr,
    }),
    update: async (criteria: any, data: any) => {
      prUpdates.push({ criteria, data });
      return { affected: 1 };
    },
  };

  const prFileRepo = {
    ...makeRepo(),
    delete: async (criteria: any) => {
      prFileDeletes.push(criteria);
    },
    upsert: async (data: any, keys: string[]) => {
      prFileUpserts.push({ data, keys });
    },
  };

  const prFileContentRepo = {
    ...makeRepo(),
    delete: async (criteria: any) => {
      prFileContentDeletes.push(criteria);
    },
  };

  const service = new GitHubFetcherService(
    { getOrThrow: () => "app-id" } as any,
    prFileRepo as any,
    prFileContentRepo as any,
    prRepo as any,
    makeRepo() as any,
    makeRepo() as any,
    makeRepo() as any,
    makeRepo() as any,
  ) as any;

  service.getTokenForRepo = async () => "token";
  service.githubFetch = async (url: string) => {
    requests.push(url);
    if (url.endsWith("/pulls/42")) {
      return makeResponse({ changed_files: options.changedFiles });
    }
    if (url.includes("/pulls/42/files?")) {
      return makeResponse(filePages.shift() ?? []);
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  return {
    service,
    requests,
    prUpdates,
    prFileDeletes,
    prFileContentDeletes,
    prFileUpserts,
  };
}

test("PR file ingestion rejects PRs above GitHub's 3000-file cap before deleting stored rows", async () => {
  const {
    service,
    requests,
    prUpdates,
    prFileDeletes,
    prFileContentDeletes,
    prFileUpserts,
  } = makeService({ changedFiles: 3001 });

  await assert.rejects(
    service.fetchAndStorePrFiles("Owner/Repo", 42),
    /changes 3001 files.*capped at 3000/,
  );

  assert.deepEqual(requests, [
    "https://api.github.com/repos/Owner/Repo/pulls/42",
  ]);
  assert.deepEqual(prUpdates, [
    {
      criteria: { repoFullName: "Owner/Repo", prNumber: 42 },
      data: { scoringDataStored: false },
    },
  ]);
  assert.deepEqual(prFileDeletes, []);
  assert.deepEqual(prFileContentDeletes, []);
  assert.deepEqual(prFileUpserts, []);
});

test("PR file ingestion rejects mismatched file counts before replacing stored rows", async () => {
  const {
    service,
    prUpdates,
    prFileDeletes,
    prFileContentDeletes,
    prFileUpserts,
  } = makeService({
    changedFiles: 2,
    filePages: [
      [
        {
          filename: "one.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
        },
      ],
    ],
  });

  await assert.rejects(
    service.fetchAndStorePrFiles("Owner/Repo", 42),
    /reports 2 changed files but returned 1/,
  );

  assert.deepEqual(prUpdates, [
    {
      criteria: { repoFullName: "Owner/Repo", prNumber: 42 },
      data: { scoringDataStored: false },
    },
  ]);
  assert.deepEqual(prFileDeletes, []);
  assert.deepEqual(prFileContentDeletes, []);
  assert.deepEqual(prFileUpserts, []);
});

test("PR file ingestion keeps the normal complete-file path working", async () => {
  const {
    service,
    requests,
    prUpdates,
    prFileDeletes,
    prFileContentDeletes,
    prFileUpserts,
  } = makeService({ changedFiles: 0, filePages: [[]] });

  await service.fetchAndStorePrFiles("Owner/Repo", 42);

  assert.deepEqual(requests, [
    "https://api.github.com/repos/Owner/Repo/pulls/42",
  ]);
  assert.deepEqual(prUpdates, []);
  assert.deepEqual(prFileDeletes, [
    { repoFullName: "Owner/Repo", prNumber: 42 },
  ]);
  assert.deepEqual(prFileContentDeletes, [
    { repoFullName: "Owner/Repo", prNumber: 42 },
  ]);
  assert.deepEqual(prFileUpserts, []);
});

test("PR file ingestion stops file pagination after the reported changed_files count", async () => {
  const files = Array.from({ length: 100 }, (_, i) => ({
    filename: `removed-${i}.ts`,
    status: "removed",
    additions: 0,
    deletions: 1,
    changes: 1,
  }));
  const { service, requests, prFileUpserts } = makeService({
    changedFiles: 100,
    filePages: [files],
    pr: { baseSha: null },
  });

  await service.fetchAndStorePrFiles("Owner/Repo", 42);

  assert.deepEqual(requests, [
    "https://api.github.com/repos/Owner/Repo/pulls/42",
    "https://api.github.com/repos/Owner/Repo/pulls/42/files?per_page=100&page=1",
  ]);
  assert.equal(prFileUpserts.length, 100);
});
