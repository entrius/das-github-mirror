/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import test from "node:test";
import assert from "node:assert/strict";
import { GitHubFetcherService } from "./github-fetcher.service";

type GraphqlRequest = {
  query: string;
  variables: Record<string, unknown>;
};

type MockRepository = {
  upserts: any[];
  saves: any[];
  updates: any[];
  repo: {
    upsert: (data: any, conflictPaths: string[]) => Promise<void>;
    save: (data: any) => Promise<any>;
    update: (...args: any[]) => Promise<{ affected: number }>;
    findOneBy: () => Promise<null>;
  };
};

function createMockRepository(): MockRepository {
  const mock: MockRepository = {
    upserts: [],
    saves: [],
    updates: [],
    repo: {
      upsert: (data: any, conflictPaths: string[]): Promise<void> => {
        mock.upserts.push({ data, conflictPaths });
        return Promise.resolve();
      },
      save: (data: any): Promise<any> => {
        mock.saves.push(data);
        return Promise.resolve(data);
      },
      update: (...args: any[]): Promise<{ affected: number }> => {
        mock.updates.push(args);
        return Promise.resolve({ affected: 1 });
      },
      findOneBy: (): Promise<null> => Promise.resolve(null),
    },
  };

  return mock;
}

function createService(resolveGraphql: (request: GraphqlRequest) => unknown): {
  service: GitHubFetcherService;
  prRepo: MockRepository;
  issueRepo: MockRepository;
  reviewRepo: MockRepository;
  labelEventRepo: MockRepository;
  graphqlCalls: GraphqlRequest[];
} {
  const prFileRepo = createMockRepository();
  const prFileContentRepo = createMockRepository();
  const prRepo = createMockRepository();
  const issueRepo = createMockRepository();
  const reviewRepo = createMockRepository();
  const labelEventRepo = createMockRepository();
  const repoRepo = createMockRepository();
  const graphqlCalls: GraphqlRequest[] = [];
  const config = {
    getOrThrow: (key: string): string =>
      key === "GITHUB_APP_ID" ? "123" : "/tmp/private-key.pem",
  };

  const service = new GitHubFetcherService(
    config as any,
    prFileRepo.repo as any,
    prFileContentRepo.repo as any,
    prRepo.repo as any,
    issueRepo.repo as any,
    reviewRepo.repo as any,
    labelEventRepo.repo as any,
    repoRepo.repo as any,
  );

  (service as any).getTokenForRepo = (): Promise<string> =>
    Promise.resolve("token");
  (service as any).githubFetch = (
    _url: string,
    init: RequestInit,
  ): Promise<Response> => {
    const request = JSON.parse(String(init.body)) as GraphqlRequest;
    graphqlCalls.push(request);
    return Promise.resolve(
      new Response(JSON.stringify(resolveGraphql(request)), {
        status: 200,
      }),
    );
  };

  return {
    service,
    prRepo,
    issueRepo,
    reviewRepo,
    labelEventRepo,
    graphqlCalls,
  };
}

function reviewNode(index: number, state = "COMMENTED"): any {
  return {
    submittedAt: `2026-05-01T00:${String(index).padStart(2, "0")}:00Z`,
    state,
    authorAssociation: index === 11 ? "MEMBER" : "CONTRIBUTOR",
    author: {
      login: `reviewer-${index}`,
      databaseId: 1000 + index,
    },
  };
}

function labelNode(index: number): any {
  return { name: `label-${index}` };
}

function labelTimelineNode(index: number): any {
  return {
    __typename: index % 2 === 0 ? "UnlabeledEvent" : "LabeledEvent",
    createdAt: `2026-05-01T01:${String(index).padStart(2, "0")}:00Z`,
    label: { name: `timeline-label-${index}` },
    actor: { login: "maintainer", databaseId: 42 },
  };
}

function pullRequestNode(): any {
  return {
    number: 7,
    title: "Backfill pagination",
    bodyText: "Body",
    state: "OPEN",
    createdAt: "2026-05-01T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    lastEditedAt: null,
    merged: false,
    author: { login: "miner", databaseId: 500 },
    authorAssociation: "CONTRIBUTOR",
    mergedBy: null,
    baseRef: { name: "test" },
    headRef: { name: "feature" },
    headRepository: { nameWithOwner: "owner/repo" },
    baseRefOid: "base",
    headRefOid: "head",
    additions: 1,
    deletions: 0,
    commits: { totalCount: 1 },
  };
}

function issueNode(): any {
  return {
    number: 9,
    title: "Issue pagination",
    state: "OPEN",
    stateReason: null,
    createdAt: "2026-05-01T00:00:00Z",
    closedAt: null,
    updatedAt: "2026-05-01T00:00:00Z",
    lastEditedAt: null,
    author: { login: "miner", databaseId: 500 },
    authorAssociation: "CONTRIBUTOR",
  };
}

void test("backfillPullRequests paginates nested reviews, current labels, and label timeline events", async () => {
  const initialLabels = Array.from({ length: 10 }, (_, index) =>
    labelNode(index + 1),
  );
  const initialReviews = Array.from({ length: 10 }, (_, index) =>
    reviewNode(index + 1),
  );
  const initialTimeline = Array.from({ length: 30 }, (_, index) =>
    labelTimelineNode(index + 1),
  );

  const { service, prRepo, reviewRepo, labelEventRepo, graphqlCalls } =
    createService((request) => {
      if (request.query.includes("pullRequests(")) {
        return {
          data: {
            repository: {
              defaultBranchRef: { name: "test" },
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    ...pullRequestNode(),
                    labels: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "labels-page-1",
                      },
                      nodes: initialLabels,
                    },
                    reviews: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "reviews-page-1",
                      },
                      nodes: initialReviews,
                    },
                    timelineItems: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "timeline-page-1",
                      },
                      nodes: initialTimeline,
                    },
                  },
                ],
              },
            },
          },
        };
      }

      if (
        request.query.includes("pullRequest(number: $number)") &&
        request.query.includes("labels(first: 100")
      ) {
        assert.equal(request.variables.cursor, "labels-page-1");
        return {
          data: {
            repository: {
              pullRequest: {
                labels: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [labelNode(11)],
                },
              },
            },
          },
        };
      }

      if (
        request.query.includes("pullRequest(number: $number)") &&
        request.query.includes("reviews(first: 100")
      ) {
        assert.equal(request.variables.cursor, "reviews-page-1");
        return {
          data: {
            repository: {
              pullRequest: {
                reviews: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [reviewNode(11, "CHANGES_REQUESTED")],
                },
              },
            },
          },
        };
      }

      if (
        request.query.includes("pullRequest(number: $number)") &&
        request.query.includes("timelineItems(")
      ) {
        assert.equal(request.variables.cursor, "timeline-page-1");
        return {
          data: {
            repository: {
              pullRequest: {
                timelineItems: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [labelTimelineNode(31)],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected GraphQL request: ${request.query}`);
    });

  await service.backfillPullRequests(
    "owner/repo",
    new Date("2026-04-01T00:00:00Z"),
  );

  assert.equal(graphqlCalls.length, 4);
  assert.deepEqual(prRepo.upserts[0].data.labels, [
    ...initialLabels.map((label) => label.name),
    "label-11",
  ]);
  assert.equal(reviewRepo.upserts.length, 11);
  assert.equal(reviewRepo.upserts[10].data.reviewState, "CHANGES_REQUESTED");
  assert.equal(labelEventRepo.saves.length, 31);
  assert.equal(labelEventRepo.saves[30].labelName, "timeline-label-31");
});

void test("backfillIssues paginates nested current labels and label timeline events", async () => {
  const initialLabels = Array.from({ length: 10 }, (_, index) =>
    labelNode(index + 1),
  );
  const initialTimeline = Array.from({ length: 30 }, (_, index) =>
    labelTimelineNode(index + 1),
  );

  const { service, issueRepo, labelEventRepo, graphqlCalls } = createService(
    (request) => {
      if (request.query.includes("issues(")) {
        return {
          data: {
            repository: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    ...issueNode(),
                    labels: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "issue-labels-page-1",
                      },
                      nodes: initialLabels,
                    },
                    timelineItems: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "issue-timeline-page-1",
                      },
                      nodes: initialTimeline,
                    },
                  },
                ],
              },
            },
          },
        };
      }

      if (
        request.query.includes("issue(number: $number)") &&
        request.query.includes("labels(first: 100")
      ) {
        assert.equal(request.variables.cursor, "issue-labels-page-1");
        return {
          data: {
            repository: {
              issue: {
                labels: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [labelNode(11)],
                },
              },
            },
          },
        };
      }

      if (
        request.query.includes("issue(number: $number)") &&
        request.query.includes("timelineItems(")
      ) {
        assert.equal(request.variables.cursor, "issue-timeline-page-1");
        return {
          data: {
            repository: {
              issue: {
                timelineItems: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [labelTimelineNode(31)],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected GraphQL request: ${request.query}`);
    },
  );

  await service.backfillIssues("owner/repo", new Date("2026-04-01T00:00:00Z"));

  assert.equal(graphqlCalls.length, 3);
  assert.deepEqual(issueRepo.upserts[0].data.labels, [
    ...initialLabels.map((label) => label.name),
    "label-11",
  ]);
  assert.equal(labelEventRepo.saves.length, 31);
  assert.equal(labelEventRepo.saves[30].targetType, "issue");
  assert.equal(labelEventRepo.saves[30].labelName, "timeline-label-31");
});

void test("backfillPullRequests preserves single-page nested data when pageInfo is absent", async () => {
  const { service, prRepo, reviewRepo, labelEventRepo, graphqlCalls } =
    createService((request) => {
      assert.ok(request.query.includes("pullRequests("));
      return {
        data: {
          repository: {
            defaultBranchRef: { name: "test" },
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  ...pullRequestNode(),
                  labels: { nodes: [labelNode(1)] },
                  reviews: { nodes: [reviewNode(1, "APPROVED")] },
                  timelineItems: { nodes: [labelTimelineNode(1)] },
                },
              ],
            },
          },
        },
      };
    });

  await service.backfillPullRequests(
    "owner/repo",
    new Date("2026-04-01T00:00:00Z"),
  );

  assert.equal(graphqlCalls.length, 1);
  assert.deepEqual(prRepo.upserts[0].data.labels, ["label-1"]);
  assert.equal(reviewRepo.upserts.length, 1);
  assert.equal(reviewRepo.upserts[0].data.reviewState, "APPROVED");
  assert.equal(labelEventRepo.saves.length, 1);
});
