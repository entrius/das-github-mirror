import { DataSource, Repository } from "typeorm";
import { Repo } from "../entities";
import { PullRequestHandler } from "./handlers/pull-request.handler";
import { IssueHandler } from "./handlers/issue.handler";
import { ReviewHandler } from "./handlers/review.handler";
import { CommentHandler } from "./handlers/comment.handler";
import { ReviewCommentHandler } from "./handlers/review-comment.handler";
import { LabelHandler } from "./handlers/label.handler";
import { InstallationHandler } from "./handlers/installation.handler";
import { WebhookService } from "./webhook.service";

describe("WebhookService registered-repo gate (#140)", () => {
  let repoRepo: jest.Mocked<Pick<Repository<Repo>, "createQueryBuilder">>;
  let queryBuilder: { where: jest.Mock; getOne: jest.Mock };
  let service: WebhookService;
  let pullRequestHandler: { handle: jest.Mock };

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    repoRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    pullRequestHandler = { handle: jest.fn().mockResolvedValue(undefined) };

    service = new WebhookService(
      repoRepo as unknown as Repository<Repo>,
      {} as DataSource,
      pullRequestHandler as unknown as PullRequestHandler,
      {} as IssueHandler,
      {} as ReviewHandler,
      {} as CommentHandler,
      {} as ReviewCommentHandler,
      {} as LabelHandler,
      {} as InstallationHandler,
    );
  });

  it("resolves registered repo with case-insensitive lookup", async () => {
    queryBuilder.getOne.mockResolvedValue({
      repoFullName: "Org/MyRepo",
      registered: true,
    } as Repo);

    await service.handleEvent(
      "pull_request",
      {
        action: "opened",
        repository: { full_name: "org/myrepo" },
        pull_request: { number: 1 },
      },
      "delivery-1",
    );

    expect(repoRepo.createQueryBuilder).toHaveBeenCalledWith("repo");
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "LOWER(repo.repo_full_name) = LOWER(:repoFullName)",
      { repoFullName: "org/myrepo" },
    );
    expect(pullRequestHandler.handle).toHaveBeenCalled();
  });

  it("skips event when case-insensitive lookup finds unregistered repo", async () => {
    queryBuilder.getOne.mockResolvedValue({
      repoFullName: "Org/MyRepo",
      registered: false,
    } as Repo);

    await service.handleEvent(
      "pull_request",
      {
        action: "opened",
        repository: { full_name: "org/myrepo" },
      },
      "delivery-2",
    );

    expect(pullRequestHandler.handle).not.toHaveBeenCalled();
  });

  it("skips event when no repo row matches", async () => {
    queryBuilder.getOne.mockResolvedValue(null);

    await service.handleEvent(
      "pull_request",
      {
        action: "opened",
        repository: { full_name: "org/myrepo" },
      },
      "delivery-3",
    );

    expect(pullRequestHandler.handle).not.toHaveBeenCalled();
  });
});
