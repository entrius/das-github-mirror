/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  CursorPayload,
} from "./cursor";

interface PageResult<T> {
  items: T[];
  next_cursor: string | null;
}

@Injectable()
export class CommentsService {
  constructor(private readonly dataSource: DataSource) {}

  async getPrComments(
    owner: string,
    repo: string,
    prNumber: number,
    cursor: string | undefined,
    limit: string | undefined,
  ): Promise<PageResult<unknown>> {
    const repoFullName = `${owner}/${repo}`;
    const lim = clampLimit(limit);
    const cur = decodeCursor(cursor);

    await this.ensurePrExists(repoFullName, prNumber);

    const rows = await this.dataSource.query(
      `
      SELECT
        c.comment_id,
        c.author_github_id,
        c.author_login,
        c.author_association,
        c.body,
        c.created_at,
        c.updated_at
      FROM comments c
      WHERE LOWER(c.repo_full_name) = LOWER($1)
        AND c.target_number = $2
        AND c.comment_context = 'pr'
        AND ($3::timestamptz IS NULL OR (c.created_at, c.comment_id) > ($3::timestamptz, $4::bigint))
      ORDER BY c.created_at ASC, c.comment_id ASC
      LIMIT $5
      `,
      [
        repoFullName,
        prNumber,
        cur?.t ?? null,
        cur?.i ?? null,
        lim + 1,
      ],
    );

    return this.toPage(rows, lim, "comment_id");
  }

  async getPrReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
    cursor: string | undefined,
    limit: string | undefined,
  ): Promise<PageResult<unknown>> {
    const repoFullName = `${owner}/${repo}`;
    const lim = clampLimit(limit);
    const cur = decodeCursor(cursor);

    await this.ensurePrExists(repoFullName, prNumber);

    const rows = await this.dataSource.query(
      `
      SELECT
        rc.comment_id,
        rc.reviewer_github_id,
        rc.reviewer_login,
        rc.review_id,
        rc.path,
        rc.line,
        rc.side,
        rc.body,
        rc.created_at,
        rc.updated_at
      FROM review_comments rc
      WHERE LOWER(rc.repo_full_name) = LOWER($1)
        AND rc.pr_number = $2
        AND ($3::timestamptz IS NULL OR (rc.created_at, rc.comment_id) > ($3::timestamptz, $4::bigint))
      ORDER BY rc.created_at ASC, rc.comment_id ASC
      LIMIT $5
      `,
      [
        repoFullName,
        prNumber,
        cur?.t ?? null,
        cur?.i ?? null,
        lim + 1,
      ],
    );

    return this.toPage(rows, lim, "comment_id");
  }

  async getIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    cursor: string | undefined,
    limit: string | undefined,
  ): Promise<PageResult<unknown>> {
    const repoFullName = `${owner}/${repo}`;
    const lim = clampLimit(limit);
    const cur = decodeCursor(cursor);

    await this.ensureIssueExists(repoFullName, issueNumber);

    const rows = await this.dataSource.query(
      `
      SELECT
        c.comment_id,
        c.author_github_id,
        c.author_login,
        c.author_association,
        c.body,
        c.created_at,
        c.updated_at
      FROM comments c
      WHERE LOWER(c.repo_full_name) = LOWER($1)
        AND c.target_number = $2
        AND c.comment_context = 'issue'
        AND ($3::timestamptz IS NULL OR (c.created_at, c.comment_id) > ($3::timestamptz, $4::bigint))
      ORDER BY c.created_at ASC, c.comment_id ASC
      LIMIT $5
      `,
      [
        repoFullName,
        issueNumber,
        cur?.t ?? null,
        cur?.i ?? null,
        lim + 1,
      ],
    );

    return this.toPage(rows, lim, "comment_id");
  }

  async getPrLabelEvents(
    owner: string,
    repo: string,
    prNumber: number,
    cursor: string | undefined,
    limit: string | undefined,
  ): Promise<PageResult<unknown>> {
    const repoFullName = `${owner}/${repo}`;
    await this.ensurePrExists(repoFullName, prNumber);
    return this.queryLabelEvents(repoFullName, prNumber, "pr", cursor, limit);
  }

  async getIssueLabelEvents(
    owner: string,
    repo: string,
    issueNumber: number,
    cursor: string | undefined,
    limit: string | undefined,
  ): Promise<PageResult<unknown>> {
    const repoFullName = `${owner}/${repo}`;
    await this.ensureIssueExists(repoFullName, issueNumber);
    return this.queryLabelEvents(
      repoFullName,
      issueNumber,
      "issue",
      cursor,
      limit,
    );
  }

  private async queryLabelEvents(
    repoFullName: string,
    targetNumber: number,
    targetType: "pr" | "issue",
    cursor: string | undefined,
    limit: string | undefined,
  ): Promise<PageResult<unknown>> {
    const lim = clampLimit(limit);
    const cur = decodeCursor(cursor);

    const rows = await this.dataSource.query(
      `
      SELECT
        le.id,
        le.label_name,
        le.action,
        le.actor_github_id,
        le.actor_login,
        le.timestamp
      FROM label_events le
      WHERE LOWER(le.repo_full_name) = LOWER($1)
        AND le.target_number = $2
        AND le.target_type   = $3
        AND ($4::timestamptz IS NULL OR (le.timestamp, le.id) > ($4::timestamptz, $5::int))
      ORDER BY le.timestamp ASC, le.id ASC
      LIMIT $6
      `,
      [
        repoFullName,
        targetNumber,
        targetType,
        cur?.t ?? null,
        cur?.i ?? null,
        lim + 1,
      ],
    );

    return this.toPage(rows, lim, "id", "timestamp");
  }

  private toPage(
    rows: Array<Record<string, unknown>>,
    lim: number,
    idKey: string,
    tsKey = "created_at",
  ): PageResult<unknown> {
    if (rows.length <= lim) {
      return { items: rows, next_cursor: null };
    }
    const page = rows.slice(0, lim);
    const last = page[page.length - 1] as Record<string, unknown>;
    const tsRaw = last[tsKey];
    const idRaw = last[idKey];
    const ts =
      tsRaw instanceof Date ? tsRaw.toISOString() : String(tsRaw ?? "");
    const id =
      typeof idRaw === "number" || typeof idRaw === "string"
        ? idRaw
        : String(idRaw ?? "");
    const payload: CursorPayload = { t: ts, i: id };
    return { items: page, next_cursor: encodeCursor(payload) };
  }

  private async ensurePrExists(
    repoFullName: string,
    prNumber: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `
      SELECT 1
      FROM pull_requests p
      WHERE p.repo_full_name = (
          SELECT repo_full_name FROM repos
          WHERE LOWER(repo_full_name) = LOWER($1)
        )
        AND p.pr_number = $2
      LIMIT 1
      `,
      [repoFullName, prNumber],
    );
    if (rows.length === 0) {
      throw new NotFoundException(
        `PR ${repoFullName}#${prNumber} not found in mirror`,
      );
    }
  }

  private async ensureIssueExists(
    repoFullName: string,
    issueNumber: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `
      SELECT 1
      FROM issues i
      WHERE i.repo_full_name = (
          SELECT repo_full_name FROM repos
          WHERE LOWER(repo_full_name) = LOWER($1)
        )
        AND i.issue_number = $2
      LIMIT 1
      `,
      [repoFullName, issueNumber],
    );
    if (rows.length === 0) {
      throw new NotFoundException(
        `Issue ${repoFullName}#${issueNumber} not found in mirror`,
      );
    }
  }
}
