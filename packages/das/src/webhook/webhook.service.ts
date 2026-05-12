/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Repo } from "../entities";
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
  private static readonly DELIVERY_CLAIM_STALE_MINUTES = 15;

  constructor(
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
    private readonly dataSource: DataSource,
    private readonly pullRequestHandler: PullRequestHandler,
    private readonly issueHandler: IssueHandler,
    private readonly reviewHandler: ReviewHandler,
    private readonly commentHandler: CommentHandler,
    private readonly reviewCommentHandler: ReviewCommentHandler,
    private readonly labelHandler: LabelHandler,
    private readonly installationHandler: InstallationHandler,
  ) {}

  /**
   * Claim a delivery for processing.
   * Returns true if this caller should process the event, false to skip.
   *
   * Atomic claim behavior:
   * - First sight: insert row and claim immediately.
   * - Duplicate while in-flight: skip (single active claimer).
   * - Duplicate after success: skip (processed_at set).
   * - Stale in-flight claim (likely crash): reclaim after timeout.
   */
  async claimDelivery(deliveryId: string): Promise<boolean> {
    const claimed: unknown[] = await this.dataSource.query(
      `INSERT INTO webhook_deliveries (delivery_id, processing_started_at)
       VALUES ($1, NOW())
       ON CONFLICT (delivery_id) DO UPDATE
       SET processing_started_at = NOW()
       WHERE webhook_deliveries.processed_at IS NULL
         AND (
           webhook_deliveries.processing_started_at IS NULL
           OR webhook_deliveries.processing_started_at <
              NOW() - ($2::text || ' minutes')::interval
         )
       RETURNING delivery_id`,
      [deliveryId, WebhookService.DELIVERY_CLAIM_STALE_MINUTES],
    );

    return claimed.length > 0;
  }

  async markProcessed(deliveryId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE webhook_deliveries
       SET processed_at = NOW(),
           processing_started_at = NULL
       WHERE delivery_id = $1`,
      [deliveryId],
    );
  }

  async handleEvent(
    event: string,
    payload: Record<string, any>,
    deliveryId: string,
  ): Promise<void> {
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
