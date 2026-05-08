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
  fetchContentBatch(
    repoFullName: string,
    prNumber: number,
    batch: PullFile[],
    owner: string,
    repo: string,
    token: string,
    headSha: string,
    baseSha: string | null,
  ): Promise<void>;
  githubFetch(url: string, init: RequestInit): Promise<Response>;
};

const emptyRepo = <T extends object>(): Repository<T> => ({}) as Repository<T>;

void test("fetchContentBatch stores only base content for removed files", async () => {
  let storedContent: Partial<PrFileContent> | null = null;
  const contentRepo = {
    upsert: (content: Partial<PrFileContent>): Promise<unknown> => {
      storedContent = content;
      return Promise.resolve();
    },
  } as unknown as Repository<PrFileContent>;

  const service = new GitHubFetcherService(
    { getOrThrow: (): string => "123" } as unknown as ConfigService,
    emptyRepo<PrFile>(),
    contentRepo,
    emptyRepo<PullRequest>(),
    emptyRepo<Issue>(),
    emptyRepo<Review>(),
    emptyRepo<LabelEvent>(),
    emptyRepo<Repo>(),
  ) as unknown as FetcherInternals;

  service.githubFetch = (
    _url: string,
    init: RequestInit,
  ): Promise<Response> => {
    const body = init.body;
    assert.equal(typeof body, "string");
    if (typeof body !== "string") {
      throw new Error("Expected GraphQL request body to be a string");
    }
    assert.ok(body.includes('base0: object(expression: \\"BASE:src/old.ts\\"'));
    assert.doesNotMatch(body, /head0:/);

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
            },
          },
        }),
    } as Response);
  };

  await service.fetchContentBatch(
    "owner/repo",
    7,
    [{ filename: "src/old.ts", status: "removed" }],
    "owner",
    "repo",
    "token",
    "HEAD",
    "BASE",
  );

  assert.deepEqual(storedContent, {
    repoFullName: "owner/repo",
    prNumber: 7,
    filename: "src/old.ts",
    baseContent: "export const removed = true;\n",
    headContent: null,
    isBinary: false,
    byteSize: 29,
  });
});
