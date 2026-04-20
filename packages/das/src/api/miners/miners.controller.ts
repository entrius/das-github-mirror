import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { MinersService } from "./miners.service";

@ApiTags("Miners")
@Controller("api/v1/miners")
export class MinersController {
  constructor(private readonly miners: MinersService) {}

  @Get(":githubId/pulls")
  @ApiOperation({
    summary: "Pull requests authored by a miner",
    description:
      "Returns every PR the miner has authored since the given date. Each " +
      "row includes full scoring inputs: review summary, current labels " +
      "(with actor attribution), linked issues (with their labels). File " +
      "contents are NOT included — fetch via /pulls/:o/:r/:n/files.",
  })
  @ApiParam({ name: "githubId", description: "GitHub user ID (numeric)" })
  @ApiQuery({
    name: "since",
    required: false,
    description:
      "ISO timestamp. Defaults to 35 days ago (midnight UTC) if omitted.",
  })
  async getPullRequests(
    @Param("githubId") githubId: string,
    @Query("since") since?: string,
  ): Promise<unknown> {
    return this.miners.getPullRequests(
      githubId,
      MinersService.resolveSince(since),
    );
  }

  @Get(":githubId/issues")
  @ApiOperation({
    summary: "Issues authored by a miner",
    description:
      "Returns every issue the miner has authored since the given date, " +
      "including current labels with actor attribution and the PR number " +
      "(if any) that solved the issue.",
  })
  @ApiParam({ name: "githubId", description: "GitHub user ID (numeric)" })
  @ApiQuery({
    name: "since",
    required: false,
    description:
      "ISO timestamp. Defaults to 35 days ago (midnight UTC) if omitted.",
  })
  async getIssues(
    @Param("githubId") githubId: string,
    @Query("since") since?: string,
  ): Promise<unknown> {
    return this.miners.getIssues(githubId, MinersService.resolveSince(since));
  }

  @Get(":githubId/counts")
  @ApiOperation({
    summary: "Aggregated PR and issue counts per repo for a miner",
    description:
      "Credibility and eligibility inputs: merged/closed/open PR counts " +
      "(with earliest merge for pioneer ordering) and closed/open issue " +
      "counts, grouped by repo, over a configurable lookback window.",
  })
  @ApiParam({ name: "githubId", description: "GitHub user ID (numeric)" })
  @ApiQuery({
    name: "days",
    required: false,
    description: "Lookback in days. Defaults to 35.",
  })
  async getCounts(
    @Param("githubId") githubId: string,
    @Query("days") days?: string,
  ): Promise<unknown> {
    return this.miners.getCounts(githubId, Number(days) || 35);
  }
}
