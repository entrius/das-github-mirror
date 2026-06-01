import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GitHubFetcherService } from "../src/webhook/github-fetcher.service";

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

function makeService(responses: any[]) {
  const reviewUpserts: any[] = [];
  const requests: any[] = [];
  const reviewRepo = {
    ...makeRepo(),
    upsert: async (data: any, keys: string[]) => {
      reviewUpserts.push({ data, keys });
    },
  };

  const service = new GitHubFetcherService(
    { getOrThrow: () => "app-id" } as any,
    makeRepo() as any,
    makeRepo() as any,
    makeRepo() as any,
    makeRepo() as any,
    reviewRepo as any,
    makeRepo() as any,
    makeRepo() as any,
  ) as any;

  service.githubFetch = async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const response = responses.shift();
    return {
      ok: true,
      status: 200,
      json: async () => response,
      text: async () => "",
    } as Response;
  };

  return { service, requests, reviewUpserts };
}

function reviewsPage(
  nodes: any[],
  hasNextPage: boolean,
  endCursor: string | null,
) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviews: {
            pageInfo: { hasNextPage, endCursor },
            nodes,
          },
        },
      },
    },
  };
}

test("backfill review fetch paginates and stores every submitted review page", async () => {
  const { service, requests, reviewUpserts } = makeService([
    reviewsPage(
      [
        {
          submittedAt: "2026-01-01T00:00:00Z",
          state: "COMMENTED",
          authorAssociation: "CONTRIBUTOR",
          author: { login: "reviewer-1", databaseId: 101 },
        },
      ],
      true,
      "cursor-1",
    ),
    reviewsPage(
      [
        {
          submittedAt: "2026-01-02T00:00:00Z",
          state: "CHANGES_REQUESTED",
          authorAssociation: "MEMBER",
          author: { login: "maintainer", databaseId: 202 },
        },
        {
          submittedAt: "2026-01-03T00:00:00Z",
          state: "APPROVED",
          authorAssociation: "CONTRIBUTOR",
          author: { login: "reviewer-2", databaseId: 303 },
        },
      ],
      false,
      null,
    ),
  ]);

  await service.fetchAndStorePrReviews(
    "Owner/Repo",
    "Owner",
    "Repo",
    42,
    "token",
  );

  assert.equal(requests.length, 2);
  assert.match(requests[0].query, /reviews\(first: 100, after: \$cursor\)/);
  assert.equal(requests[0].variables.cursor, null);
  assert.equal(requests[1].variables.cursor, "cursor-1");

  assert.deepEqual(
    reviewUpserts.map((entry) => entry.data),
    [
      {
        repoFullName: "Owner/Repo",
        prNumber: 42,
        reviewerGithubId: "101",
        reviewerLogin: "reviewer-1",
        reviewerAssociation: "CONTRIBUTOR",
        reviewState: "COMMENTED",
        submittedAt: "2026-01-01T00:00:00Z",
      },
      {
        repoFullName: "Owner/Repo",
        prNumber: 42,
        reviewerGithubId: "202",
        reviewerLogin: "maintainer",
        reviewerAssociation: "MEMBER",
        reviewState: "CHANGES_REQUESTED",
        submittedAt: "2026-01-02T00:00:00Z",
      },
      {
        repoFullName: "Owner/Repo",
        prNumber: 42,
        reviewerGithubId: "303",
        reviewerLogin: "reviewer-2",
        reviewerAssociation: "CONTRIBUTOR",
        reviewState: "APPROVED",
        submittedAt: "2026-01-03T00:00:00Z",
      },
    ],
  );
  assert.deepEqual(reviewUpserts[0].keys, [
    "repoFullName",
    "prNumber",
    "reviewerGithubId",
    "submittedAt",
  ]);
});

test("backfill review fetch fails instead of looping when GitHub omits next cursor", async () => {
  const { service } = makeService([reviewsPage([], true, null)]);

  await assert.rejects(
    service.fetchAndStorePrReviews("Owner/Repo", "Owner", "Repo", 42, "token"),
    /hasNextPage without endCursor/,
  );
});
