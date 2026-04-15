import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Job } from "bullmq";
import { Issue, PullRequest } from "../entities";
import { GitHubFetcherService } from "../webhook/github-fetcher.service";
import { FETCH_QUEUE, FETCH_JOBS } from "./constants";

export interface ClosingIssuesJobData {
  repoFullName: string;
  prNumber: number;
}

export interface PrFilesJobData {
  repoFullName: string;
  prNumber: number;
}

@Processor(FETCH_QUEUE, { concurrency: 5 })
export class FetchProcessor extends WorkerHost {
  private readonly logger = new Logger(FetchProcessor.name);

  constructor(
    private readonly fetcher: GitHubFetcherService,
    @InjectRepository(PullRequest)
    private readonly prRepo: Repository<PullRequest>,
    @InjectRepository(Issue)
    private readonly issueRepo: Repository<Issue>,
  ) {
    super();
  }

  async process(
    job: Job<ClosingIssuesJobData | PrFilesJobData>,
  ): Promise<void> {
    const { repoFullName, prNumber } = job.data;

    switch (job.name) {
      case FETCH_JOBS.CLOSING_ISSUES:
        await this.handleClosingIssues(repoFullName, prNumber);
        break;
      case FETCH_JOBS.PR_FILES:
        await this.handlePrFiles(repoFullName, prNumber);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleClosingIssues(
    repoFullName: string,
    prNumber: number,
  ): Promise<void> {
    this.logger.log(
      `Fetching closingIssuesReferences for ${repoFullName}#${prNumber}`,
    );

    const issueNumbers = await this.fetcher.fetchClosingIssueNumbers(
      repoFullName,
      prNumber,
    );

    await this.prRepo.update(
      { repoFullName, prNumber },
      { closingIssueNumbers: issueNumbers },
    );

    // Check if this PR is merged — if so, set solved_by_pr on each linked issue
    const pr = await this.prRepo.findOneBy({ repoFullName, prNumber });
    if (pr?.state === "MERGED" && issueNumbers.length > 0) {
      for (const issueNumber of issueNumbers) {
        await this.issueRepo.update(
          { repoFullName, issueNumber },
          { solvedByPr: prNumber },
        );
      }
    }
  }

  private async handlePrFiles(
    repoFullName: string,
    prNumber: number,
  ): Promise<void> {
    this.logger.log(`Fetching PR files for ${repoFullName}#${prNumber}`);

    await this.fetcher.fetchAndStorePrFiles(repoFullName, prNumber);

    await this.prRepo.update(
      { repoFullName, prNumber },
      { scoringDataStored: true },
    );
  }
}
