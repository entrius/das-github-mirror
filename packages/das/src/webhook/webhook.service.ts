/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Repo, WebhookDelivery } from "../entities";
import { PullRequestHandler } from "./handlers/pull-request.handler";
import { IssueHandler } from "./handlers/issue.handler";
import { ReviewHandler } from "./handlers/review.handler";
import { CommentHandler } from "./handlers/comment.handler";
import { ReviewCommentHandler } from "./handlers/review-comment.handler";
import { LabelHandler } from "./handlers/label.handler";
import { InstallationHandler } from "./handlers/installation.handler";

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
    private readonly pullRequestHandler: PullRequestHandler,
    private readonly issueHandler: IssueHandler,
    private readonly reviewHandler: ReviewHandler,
    private readonly commentHandler: CommentHandler,
    private readonly reviewCommentHandler: ReviewCommentHandler,
    private readonly labelHandler: LabelHandler,
    private readonly installationHandler: InstallationHandler,
  ) {}

  async isDuplicate(deliveryId: string): Promise<boolean> {
    const existing = await this.deliveryRepo.findOneBy({ deliveryId });
    return existing !== null;
  }

  async handleEvent(
    event: string,
    payload: Record<string, any>,
    deliveryId: string,
  ): Promise<void> {
    // Record delivery for dedup
    await this.deliveryRepo.save({
      deliveryId,
      receivedAt: new Date().toISOString(),
    });

    const repoFullName: string | undefined = payload.repository?.full_name;

    this.logger.log(
      `${event}.${payload.action ?? "unknown"} → ${repoFullName ?? "no-repo"} [${deliveryId}]`,
    );

    // Installation events always run — they create/update the Repo row itself.
    if (event === "installation" || event === "installation_repositories") {
      await this.installationHandler.handle(event, payload);
      return;
    }

    // All other events carry repo context and only persist data for registered repos.
    if (repoFullName) {
      const repo = await this.repoRepo.findOneBy({ repoFullName });
      if (!repo?.registered) {
        this.logger.log(
          `Skipping ${event}: repo ${repoFullName} not registered`,
        );
        return;
      }
    }

    switch (event) {
      case "pull_request":
        await this.pullRequestHandler.handle(payload);
        if (payload.action === "labeled" || payload.action === "unlabeled") {
          await this.labelHandler.handle(payload, "pr");
        }
        break;
      case "issues":
        await this.issueHandler.handle(payload);
        if (payload.action === "labeled" || payload.action === "unlabeled") {
          await this.labelHandler.handle(payload, "issue");
        }
        break;
      case "pull_request_review":
        await this.reviewHandler.handle(payload);
        break;
      case "issue_comment":
        await this.commentHandler.handle(payload);
        break;
      case "pull_request_review_comment":
        await this.reviewCommentHandler.handle(payload);
        break;
      case "label":
        // Repo-level label CRUD — not used for scoring, skip
        break;
      default:
        this.logger.debug(`Unhandled event type: ${event}`);
    }
  }
}
