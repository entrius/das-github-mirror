/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
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
    private readonly dataSource: DataSource,
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

    // Append to label_events log. Actor's repo role is resolved at read time
    // via contributor_repo_roles (see pr_labels_by_actor view) using stored
    // PR/issue, review, and comment association evidence — neither the webhook
    // sender nor GraphQL LabeledEvent.actor expose author_association.
    // orIgnore() makes the insert idempotent under the uq_label_events_natural_key
    // constraint; same-delivery retries are already gated upstream by
    // webhook_deliveries, this is defense-in-depth.
    await this.labelEventRepo
      .createQueryBuilder()
      .insert()
      .values({
        repoFullName,
        targetNumber,
        targetType: source,
        labelName: label.name,
        action,
        actorGithubId: sender ? String(sender.id) : null,
        actorLogin: sender?.login ?? null,
        timestamp: new Date().toISOString(),
      })
      .orIgnore()
      .execute();

    // Update current labels snapshot on the parent row
    const currentLabels: string[] =
      source === "pr"
        ? (payload.pull_request.labels ?? []).map((l: any) => l.name)
        : (payload.issue.labels ?? []).map((l: any) => l.name);

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
   * Called for repository-level label.deleted and label.edited events.
   * GitHub applies these transitions repo-wide, so mirror the current
   * target-level label state with per-target events for the scoring views.
   */
  async handleRepoLabel(payload: Record<string, any>): Promise<void> {
    const action = payload.action;
    if (action !== "deleted" && action !== "edited") return;

    const repoFullName: string | undefined = payload.repository?.full_name;
    const labelName: string | undefined = payload.label?.name;
    if (!repoFullName || !labelName) return;

    const sender = payload.sender;
    const actorGithubId = sender?.id != null ? String(sender.id) : null;
    const actorLogin = sender?.login ?? null;
    const timestamp = new Date().toISOString();

    if (action === "deleted") {
      await this.removeRepoLabel(
        repoFullName,
        labelName,
        actorGithubId,
        actorLogin,
        timestamp,
      );
      return;
    }

    const oldName: string | undefined = payload.changes?.name?.from;
    if (!oldName || oldName === labelName) return;

    await this.renameRepoLabel(
      repoFullName,
      oldName,
      labelName,
      actorGithubId,
      actorLogin,
      timestamp,
    );
  }

  private async removeRepoLabel(
    repoFullName: string,
    labelName: string,
    actorGithubId: string | null,
    actorLogin: string | null,
    timestamp: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
        WITH latest_events AS (
          SELECT DISTINCT ON (
              le.repo_full_name,
              le.target_number,
              le.target_type,
              le.label_name
            )
            le.repo_full_name,
            le.target_number,
            le.target_type,
            le.action
          FROM label_events le
          WHERE le.repo_full_name = $1
            AND le.label_name = $2
            AND le.target_type IN ('pr', 'issue')
          ORDER BY
            le.repo_full_name,
            le.target_number,
            le.target_type,
            le.label_name,
            le.timestamp DESC
        ),
        current_targets AS (
          SELECT repo_full_name, target_number, target_type
          FROM latest_events
          WHERE action = 'labeled'
        )
        INSERT INTO label_events (
          repo_full_name,
          target_number,
          target_type,
          label_name,
          action,
          actor_github_id,
          actor_login,
          timestamp
        )
        SELECT
          repo_full_name,
          target_number,
          target_type,
          $2::varchar,
          'unlabeled',
          $3::varchar,
          $4::varchar,
          $5::timestamptz
        FROM current_targets
        ON CONFLICT DO NOTHING
        `,
        [repoFullName, labelName, actorGithubId, actorLogin, timestamp],
      );

      await manager.query(
        `
        UPDATE pull_requests
        SET labels = array_remove(labels, $2)
        WHERE repo_full_name = $1
          AND $2 = ANY(labels)
        `,
        [repoFullName, labelName],
      );

      await manager.query(
        `
        UPDATE issues
        SET labels = array_remove(labels, $2)
        WHERE repo_full_name = $1
          AND $2 = ANY(labels)
        `,
        [repoFullName, labelName],
      );
    });
  }

  private async renameRepoLabel(
    repoFullName: string,
    oldName: string,
    newName: string,
    actorGithubId: string | null,
    actorLogin: string | null,
    timestamp: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
        WITH latest_events AS (
          SELECT DISTINCT ON (
              le.repo_full_name,
              le.target_number,
              le.target_type,
              le.label_name
            )
            le.repo_full_name,
            le.target_number,
            le.target_type,
            le.action,
            le.actor_github_id,
            le.actor_login
          FROM label_events le
          WHERE le.repo_full_name = $1
            AND le.label_name = $2
            AND le.target_type IN ('pr', 'issue')
          ORDER BY
            le.repo_full_name,
            le.target_number,
            le.target_type,
            le.label_name,
            le.timestamp DESC
        ),
        current_targets AS (
          SELECT
            repo_full_name,
            target_number,
            target_type,
            actor_github_id,
            actor_login
          FROM latest_events
          WHERE action = 'labeled'
        ),
        transition_rows AS (
          SELECT
            repo_full_name,
            target_number,
            target_type,
            $2::varchar AS label_name,
            'unlabeled'::varchar AS action,
            $4::varchar AS actor_github_id,
            $5::varchar AS actor_login,
            $6::timestamptz AS timestamp
          FROM current_targets

          UNION ALL

          SELECT
            repo_full_name,
            target_number,
            target_type,
            $3::varchar AS label_name,
            'labeled'::varchar AS action,
            actor_github_id,
            actor_login,
            $6::timestamptz AS timestamp
          FROM current_targets
        )
        INSERT INTO label_events (
          repo_full_name,
          target_number,
          target_type,
          label_name,
          action,
          actor_github_id,
          actor_login,
          timestamp
        )
        SELECT
          repo_full_name,
          target_number,
          target_type,
          label_name,
          action,
          actor_github_id,
          actor_login,
          timestamp
        FROM transition_rows
        ON CONFLICT DO NOTHING
        `,
        [repoFullName, oldName, newName, actorGithubId, actorLogin, timestamp],
      );

      await manager.query(
        `
        UPDATE pull_requests
        SET labels = CASE
          WHEN $3 = ANY(labels) THEN array_remove(labels, $2)
          ELSE array_replace(labels, $2, $3)
        END
        WHERE repo_full_name = $1
          AND $2 = ANY(labels)
        `,
        [repoFullName, oldName, newName],
      );

      await manager.query(
        `
        UPDATE issues
        SET labels = CASE
          WHEN $3 = ANY(labels) THEN array_remove(labels, $2)
          ELSE array_replace(labels, $2, $3)
        END
        WHERE repo_full_name = $1
          AND $2 = ANY(labels)
        `,
        [repoFullName, oldName, newName],
      );
    });
  }
}
