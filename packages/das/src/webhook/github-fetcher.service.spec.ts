import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigService } from "@nestjs/config";
import type { Repository } from "typeorm";
import {
  Issue,
  LabelEvent,
  PrFile,
  PrFileContent,
  PullRequest,
  Repo,
  Review,
} from "../entities";
import { GitHubFetcherService } from "./github-fetcher.service";

type PullFile = {
  filename: string;
  previous_filename?: string;
  status: string;
};

type FetcherInternals = {
  fetchAndStoreBatchedContents(
    repoFullName: string,
    prNumber: number,
    files: PullFile[],
    owner: string,
    repo: string,
    token: string,
    headSha: string,
    baseSha: string | null,
  ): Promise<void>;
  githubFetch(url: string, init: RequestInit): Promise<Response>;
};

const emptyRepo = <T extends object>(): Repository<T> => ({}) as Repository<T>;

function createService(
  onContentUpsert: (content: Partial<PrFileContent>) => void,
): FetcherInternals {
  const contentRepo = {
    upsert: (content: Partial<PrFileContent>): Promise<unknown> => {
      onContentUpsert(content);
      return Promise.resolve();
    },
  } as unknown as Repository<PrFileContent>;

  return new GitHubFetcherService(
    { getOrThrow: (): string => "123" } as unknown as ConfigService,
    emptyRepo<PrFile>(),
    contentRepo,
    emptyRepo<PullRequest>(),
    emptyRepo<Issue>(),
    emptyRepo<Review>(),
    emptyRepo<LabelEvent>(),
    emptyRepo<Repo>(),
  ) as unknown as FetcherInternals;
}

function graphqlQueryFrom(init: RequestInit): string {
  const body = init.body;
  assert.equal(typeof body, "string");
  if (typeof body !== "string") {
    throw new Error("Expected GraphQL request body to be a string");
  }

  const parsed: unknown = JSON.parse(body);
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);

  const query = (parsed as { query?: unknown }).query;
  assert.equal(typeof query, "string");
  if (typeof query !== "string") {
    throw new Error("Expected GraphQL request body to include a query");
  }

  return query;
}

void test("fetchAndStoreBatchedContents stores mixed file-status contents", async () => {
  let graphQlCalls = 0;
  const storedContents: Partial<PrFileContent>[] = [];
  const service = createService((content) => {
    storedContents.push(content);
  });

  service.githubFetch = (
    _url: string,
    init: RequestInit,
  ): Promise<Response> => {
    graphQlCalls++;
    const query = graphqlQueryFrom(init);
    assert.match(query, /base0: object\(expression: "BASE:src\/old\.ts"\)/);
    assert.doesNotMatch(query, /base1:/);
    assert.match(query, /head1: object\(expression: "HEAD:src\/new\.ts"\)/);
    assert.match(query, /base2: object\(expression: "BASE:src\/live\.ts"\)/);
    assert.match(query, /head2: object\(expression: "HEAD:src\/live\.ts"\)/);
    assert.doesNotMatch(query, /head0:/);

    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            repository: {
              base0: {
                text: "export const removed = true;\n",
                byteSize: 29,
                isBinary: false,
              },
              head1: {
                text: "export const added = true;\n",
                byteSize: 27,
                isBinary: false,
              },
              base2: {
                text: "export const live = false;\n",
                byteSize: 27,
                isBinary: false,
              },
              head2: {
                text: "export const live = true;\n",
                byteSize: 26,
                isBinary: false,
              },
            },
          },
        }),
    } as Response);
  };

  await service.fetchAndStoreBatchedContents(
    "owner/repo",
    7,
    [
      { filename: "src/old.ts", status: "removed" },
      { filename: "src/new.ts", status: "added" },
      { filename: "src/live.ts", status: "modified" },
    ],
    "owner",
    "repo",
    "token",
    "HEAD",
    "BASE",
  );

  assert.equal(graphQlCalls, 1);
  assert.deepEqual(storedContents, [
    {
      repoFullName: "owner/repo",
      prNumber: 7,
      filename: "src/old.ts",
      baseContent: "export const removed = true;\n",
      headContent: null,
      isBinary: false,
      byteSize: 29,
    },
    {
      repoFullName: "owner/repo",
      prNumber: 7,
      filename: "src/new.ts",
      baseContent: null,
      headContent: "export const added = true;\n",
      isBinary: false,
      byteSize: 27,
    },
    {
      repoFullName: "owner/repo",
      prNumber: 7,
      filename: "src/live.ts",
      baseContent: "export const live = false;\n",
      headContent: "export const live = true;\n",
      isBinary: false,
      byteSize: 26,
    },
  ]);
});

void test("fetchAndStoreBatchedContents skips removed files without a base SHA", async () => {
  let graphQlCalls = 0;
  let storedContent: Partial<PrFileContent> | null = null;
  const service = createService((content) => {
    storedContent = content;
  });

  service.githubFetch = (): Promise<Response> => {
    graphQlCalls++;
    throw new Error("Removed files without a base SHA should not be fetched");
  };

  await service.fetchAndStoreBatchedContents(
    "owner/repo",
    7,
    [{ filename: "src/old.ts", status: "removed" }],
    "owner",
    "repo",
    "token",
    "HEAD",
    null,
  );

  assert.equal(graphQlCalls, 0);
  assert.equal(storedContent, null);
});
