/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
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
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
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
   * Uses INSERT ... ON CONFLICT DO NOTHING as an atomic claim. If the row
   * already exists with processed_at set, it's a confirmed duplicate and we
   * skip. If it exists with processed_at NULL, the prior attempt crashed
   * mid-handler — we reprocess (all handlers are upserts, so that's safe).
   */
  async claimDelivery(deliveryId: string): Promise<boolean> {
    const inserted: unknown[] = await this.dataSource.query(
      `INSERT INTO webhook_deliveries (delivery_id)
       VALUES ($1)
       ON CONFLICT (delivery_id) DO NOTHING
       RETURNING delivery_id`,
      [deliveryId],
    );
    if (inserted.length > 0) return true;

    const existing: { processed_at: string | null }[] =
      await this.dataSource.query(
        `SELECT processed_at FROM webhook_deliveries WHERE delivery_id = $1`,
        [deliveryId],
      );
    return existing[0]?.processed_at == null;
  }

  async storeDeliveryPayload(
    deliveryId: string,
    eventType: string,
    payload: Record<string, any>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE webhook_deliveries 
       SET event_type = $2, payload = $3 
       WHERE delivery_id = $1`,
      [deliveryId, eventType, JSON.stringify(payload)],
    );
  }

  async markProcessed(deliveryId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE webhook_deliveries SET processed_at = NOW() WHERE delivery_id = $1`,
      [deliveryId],
    );
  }

  async markFailed(deliveryId: string, error: Error): Promise<void> {
    await this.dataSource.query(
      `UPDATE webhook_deliveries 
       SET failed_at = NOW(), last_error = $2 
       WHERE delivery_id = $1`,
      [deliveryId, error.message + (error.stack ? `\n${error.stack}` : "")],
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
