import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ApiTags, ApiOperation, ApiSecurity, ApiBody } from "@nestjs/swagger";
import { RequireApiKeyGuard } from "./require-api-key.guard";
import { FETCH_QUEUE, FETCH_JOBS } from "../queue/constants";

interface BackfillBody {
  repoFullName: string;
  days?: number;
}

@ApiTags("Admin")
@ApiSecurity("api-key")
@UseGuards(RequireApiKeyGuard)
@Controller("api/v1/admin")
export class AdminController {
  constructor(
    @InjectQueue(FETCH_QUEUE)
    private readonly fetchQueue: Queue,
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
}
