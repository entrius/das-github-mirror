/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LabelEvent, Issue, PullRequest } from "../../entities";

@Injectable()
export class LabelHandler {
  constructor(
    @InjectRepository(LabelEvent)
    private readonly labelEventRepo: Repository<LabelEvent>,
    @InjectRepository(Issue)
    private readonly issueRepo: Repository<Issue>,
    @InjectRepository(PullRequest)
    private readonly prRepo: Repository<PullRequest>,
  ) {}

  /**
   * Called for issues.labeled/unlabeled and pull_request.labeled/unlabeled events.
   * Logs the event to label_events and updates the labels array on the parent row.
   */
  async handle(
    payload: Record<string, any>,
    source: "issue" | "pr",
  ): Promise<void> {
    const action = payload.action;
    if (action !== "labeled" && action !== "unlabeled") return;

    const repoFullName: string = payload.repository.full_name;
    const label = payload.label;
    const sender = payload.sender;

    const targetNumber: number =
      source === "pr" ? payload.pull_request.number : payload.issue.number;
    const labelEventTimestamp = this.resolveLabelEventTimestamp(payload, source);

    // Append to label_events log. Actor's repo role is resolved at read time
    // via contributor_repo_roles using stored PR/issue, review, and comment
    // association evidence; label actors themselves don't expose it.
    await this.labelEventRepo.save({
      repoFullName,
      targetNumber,
      targetType: source,
      labelName: label.name,
      action,
      actorGithubId: sender ? String(sender.id) : null,
      actorLogin: sender?.login ?? null,
      timestamp: labelEventTimestamp,
    });

    // Rebuild the parent-row labels from the event log instead of trusting
    // the webhook payload snapshot, which may be stale if deliveries arrive
    // late, are retried manually, or are processed out of order.
    const currentLabels = await this.loadCurrentLabels(
      repoFullName,
      targetNumber,
      source,
    );

    if (source === "pr") {
      await this.prRepo.update(
        { repoFullName, prNumber: targetNumber },
        { labels: currentLabels },
      );
    } else {
      await this.issueRepo.update(
        { repoFullName, issueNumber: targetNumber },
        { labels: currentLabels },
      );
    }
  }

  /**
   * Live label webhooks do not include the exact timeline event createdAt used
   * by backfill. Prefer GitHub's resource updated_at as a best-effort proxy so
   * ordering tracks GitHub event time more closely than mirror receipt time.
   */
  private resolveLabelEventTimestamp(
    payload: Record<string, any>,
    source: "issue" | "pr",
  ): string {
    const target = source === "pr" ? payload.pull_request : payload.issue;
    return target?.updated_at ?? new Date().toISOString();
  }

  private async loadCurrentLabels(
    repoFullName: string,
    targetNumber: number,
    targetType: "issue" | "pr",
  ): Promise<string[]> {
    const rows: Array<{ label_name: string }> = await this.labelEventRepo.query(
      `
        WITH latest_events AS (
          SELECT DISTINCT ON (label_name)
            label_name,
            action
          FROM label_events
          WHERE repo_full_name = $1
            AND target_number = $2
            AND target_type = $3
          ORDER BY label_name, timestamp DESC
        )
        SELECT label_name
        FROM latest_events
        WHERE action = 'labeled'
        ORDER BY label_name ASC
      `,
      [repoFullName, targetNumber, targetType],
    );

    return rows.map((row) => row.label_name);
  }
}
