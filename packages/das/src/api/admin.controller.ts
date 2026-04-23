import {
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
    await this.fetchQueue.add(
      FETCH_JOBS.BACKFILL_REPO,
      { repoFullName: body.repoFullName, days: body.days },
      {
        jobId: `backfill-${body.repoFullName}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );

    return {
      enqueued: true,
      repoFullName: body.repoFullName,
      days: body.days,
    };
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
    const result = await this.repoRepo.update(
      { repoFullName: body.repoFullName },
      { registered: true },
    );

    if (!result.affected) {
      throw new NotFoundException(
        `Repo ${body.repoFullName} not found — install the GitHub App first`,
      );
    }

    await this.fetchQueue.add(
      FETCH_JOBS.BACKFILL_REPO,
      { repoFullName: body.repoFullName },
      {
        jobId: `backfill-${body.repoFullName}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );

    return {
      repoFullName: body.repoFullName,
      registered: true,
      backfillEnqueued: true,
    };
  }
}
