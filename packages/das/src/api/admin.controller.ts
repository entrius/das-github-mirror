import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import { ApiTags, ApiOperation, ApiSecurity, ApiBody } from "@nestjs/swagger";
import { RequireApiKeyGuard } from "./require-api-key.guard";
import { Repo } from "../entities";
import { FETCH_QUEUE, FETCH_JOBS } from "../queue/constants";

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

    const result = await this.repoRepo.update(
      { repoFullName },
      { registered: true },
    );

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
}
