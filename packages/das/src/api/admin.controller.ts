import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import { ApiTags, ApiOperation, ApiSecurity, ApiBody } from "@nestjs/swagger";
import { RequireApiKeyGuard } from "./require-api-key.guard";
import { Repo, WebhookDelivery, PullRequest, Issue } from "../entities";
import { FETCH_QUEUE, FETCH_JOBS, prFilesJobId } from "../queue/constants";
import { WebhookService } from "../webhook/webhook.service";

interface BackfillBody {
  repoFullName: string;
  days?: number;
}

interface RegisterBody {
  repoFullName: string;
}

// GitHub owner/repo pattern: alphanum + `.`, `_`, `-`, length reasonable.
const REPO_FULL_NAME_PATTERN = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

function validateRepoFullName(value: unknown): string {
  if (typeof value !== "string" || !REPO_FULL_NAME_PATTERN.test(value)) {
    throw new BadRequestException(
      'repoFullName must match "owner/repo" (alphanumerics, dot, dash, underscore)',
    );
  }
  return value;
}

function validateDays(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestException("days must be a positive number");
  }
  if (value > 365) {
    throw new BadRequestException("days must be <= 365");
  }
  return Math.floor(value);
}

@ApiTags("Admin")
@ApiSecurity("api-key")
@UseGuards(RequireApiKeyGuard)
@Controller("api/v1/admin")
export class AdminController {
  constructor(
    @InjectQueue(FETCH_QUEUE)
    private readonly fetchQueue: Queue,
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(PullRequest)
    private readonly prRepo: Repository<PullRequest>,
    @InjectRepository(Issue)
    private readonly issueRepo: Repository<Issue>,
    private readonly webhookService: WebhookService,
  ) {}

  @Post("backfill")
  @ApiOperation({
    summary: "Manually trigger a repo backfill",
    description:
      "Enqueues a backfill job that pages through PRs and issues " +
      "from the specified number of days. Defaults to 40 days.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["repoFullName"],
      properties: {
        repoFullName: { type: "string", example: "entrius/gittensor-ui" },
        days: { type: "number", example: 40, default: 40 },
      },
    },
  })
  async triggerBackfill(@Body() body: BackfillBody): Promise<{
    enqueued: boolean;
    repoFullName: string;
    days: number | undefined;
  }> {
    const repoFullName = validateRepoFullName(body?.repoFullName);
    const days = validateDays(body?.days);

    await this.fetchQueue.add(
      FETCH_JOBS.BACKFILL_REPO,
      { repoFullName, days },
      {
        jobId: `backfill-${repoFullName}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );

    return { enqueued: true, repoFullName, days };
  }

  @Post("repos/register")
  @ApiOperation({
    summary: "Flip a repo to registered and trigger default backfill",
    description:
      "Sets registered=true on an installed repo and enqueues a backfill " +
      "with the default time window. The repo must already be installed " +
      "(row created by the GitHub App installation webhook).",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["repoFullName"],
      properties: {
        repoFullName: { type: "string", example: "entrius/gittensor-ui" },
      },
    },
  })
  async registerRepo(@Body() body: RegisterBody): Promise<{
    repoFullName: string;
    registered: true;
    backfillEnqueued: boolean;
  }> {
    const repoFullName = validateRepoFullName(body?.repoFullName);

    const result = await this.repoRepo
      .createQueryBuilder()
      .update()
      .set({ registered: true })
      .where("LOWER(repo_full_name) = LOWER(:repoFullName)", { repoFullName })
      .execute();

    if (!result.affected) {
      throw new NotFoundException(
        `Repo ${repoFullName} not found — install the GitHub App first`,
      );
    }

    await this.fetchQueue.add(
      FETCH_JOBS.BACKFILL_REPO,
      { repoFullName },
      {
        jobId: `backfill-${repoFullName}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );

    return { repoFullName, registered: true, backfillEnqueued: true };
  }

  @Post("deliveries/:deliveryId/replay")
  @ApiOperation({
    summary: "Replay a stored webhook delivery",
    description:
      "Re-processes a webhook delivery using its stored payload. " +
      "Returns 409 if already processed unless ?force=true. " +
      "Returns 404 if payload was not stored or delivery does not exist.",
  })
  async replayDelivery(
    @Param("deliveryId") deliveryId: string,
    @Query("force") force?: string,
  ): Promise<{
    replayed: boolean;
    deliveryId: string;
    eventType: string;
  }> {
    const delivery = await this.deliveryRepo.findOne({
      where: { deliveryId },
    });

    if (!delivery) {
      throw new NotFoundException(
        `Delivery ${deliveryId} not found in webhook_deliveries`,
      );
    }

    if (!delivery.payload || !delivery.eventType) {
      throw new NotFoundException(
        `Delivery ${deliveryId} has no stored payload (retention expired or not captured)`,
      );
    }

    const isForced = force === "true" || force === "1";
    if (delivery.processedAt && !isForced) {
      throw new ConflictException(
        `Delivery ${deliveryId} already processed at ${delivery.processedAt}. ` +
          `Use ?force=true to replay anyway.`,
      );
    }

    // Reset delivery state for replay
    await this.deliveryRepo.update(deliveryId, {
      processedAt: null,
      failedAt: null,
      lastError: null,
    });

    // Replay the event through the webhook handler
    await this.webhookService.handleEvent(
      delivery.eventType,
      delivery.payload as Record<string, any>,
      deliveryId,
    );

    // Mark as processed
    await this.webhookService.markProcessed(deliveryId);

    return {
      replayed: true,
      deliveryId,
      eventType: delivery.eventType,
    };
  }

  @Post("repos/:owner/:repo/pulls/:number/refetch")
  @ApiOperation({
    summary: "Manually refetch a specific PR",
    description:
      "Enqueues PR_METADATA and PR_FILES jobs to refresh data for the " +
      "specified pull request. Resets scoring_data_stored to prevent " +
      "stale-generation races.",
  })
  async refetchPullRequest(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number") number: string,
  ): Promise<{
    enqueued: boolean;
    repoFullName: string;
    prNumber: number;
  }> {
    const repoFullName = `${owner}/${repo}`;
    const prNumber = parseInt(number, 10);

    if (isNaN(prNumber) || prNumber <= 0) {
      throw new BadRequestException("PR number must be a positive integer");
    }

    // Verify PR exists
    const pr = await this.prRepo.findOne({
      where: { repoFullName, prNumber },
    });

    if (!pr) {
      throw new NotFoundException(
        `PR ${repoFullName}#${prNumber} not found in database`,
      );
    }

    // Reset scoring flag to prevent stale-generation race
    await this.prRepo.update(
      { repoFullName, prNumber },
      { scoringDataStored: false },
    );

    // Enqueue metadata fetch
    await this.fetchQueue.add(
      FETCH_JOBS.PR_METADATA,
      { repoFullName, prNumber },
      {
        jobId: `meta-${repoFullName}-${prNumber}`,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );

    // Enqueue files fetch
    const jobId = prFilesJobId(
      repoFullName,
      prNumber,
      pr.headSha,
      pr.baseSha,
    );
    await this.fetchQueue.add(
      FETCH_JOBS.PR_FILES,
      {
        repoFullName,
        prNumber,
        expectedHeadSha: pr.headSha,
        expectedBaseSha: pr.baseSha,
      },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );

    return {
      enqueued: true,
      repoFullName,
      prNumber,
    };
  }

  @Post("repos/:owner/:repo/issues/:number/refetch")
  @ApiOperation({
    summary: "Manually refetch a specific issue",
    description:
      "Fetches the latest issue data from GitHub and updates the database. " +
      "Uses the existing GraphQL backfill path scoped to a single issue.",
  })
  async refetchIssue(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number") number: string,
  ): Promise<{
    refetched: boolean;
    repoFullName: string;
    issueNumber: number;
  }> {
    const repoFullName = `${owner}/${repo}`;
    const issueNumber = parseInt(number, 10);

    if (isNaN(issueNumber) || issueNumber <= 0) {
      throw new BadRequestException("Issue number must be a positive integer");
    }

    // Verify issue exists
    const issue = await this.issueRepo.findOne({
      where: { repoFullName, issueNumber },
    });

    if (!issue) {
      throw new NotFoundException(
        `Issue ${repoFullName}#${issueNumber} not found in database`,
      );
    }

    // Note: This is a placeholder. The actual implementation would require
    // extending the GitHub fetcher service with a single-issue fetch method.
    // For now, we throw an error indicating this needs to be implemented.
    throw new BadRequestException(
      "Issue refetch not yet implemented. " +
        "Extend GitHubFetcherService.backfillIssues to support single-issue mode.",
    );
  }
}
