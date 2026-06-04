/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

// Column list (everything between SELECT and FROM) for the reviewer-contribution
// query. Shared by the scalar-`since` GET path and the per-repo `since` POST path
// so the two stay identical — same contract as MinersService's PR/issue columns.
const REVIEW_SELECT_COLUMNS = `
        LOWER(rc.repo_full_name)            AS repo_full_name,
        rc.pr_number,
        rc.reviewer_github_id,
        COALESCE(rc.reviewer_login, '')     AS reviewer_login,
        rc.reviewer_association,
        rc.review_state,
        rc.submitted_at,
        rc.review_count,
        rc.pr_author_github_id,
        COALESCE(rc.pr_author_login, '')    AS pr_author_login,
        rc.pr_state,
        rc.pr_created_at,
        rc.pr_merged_at,
        rc.pr_base_ref,
        r.default_branch,
        COALESCE(rc.pr_additions, 0)        AS pr_additions,
        COALESCE(rc.pr_deletions, 0)        AS pr_deletions,
        -- Anti-gaming flag: the reviewer is the PR author, so this is a
        -- self-review, not a contribution that should be credited.
        (rc.reviewer_github_id = rc.pr_author_github_id) AS is_self_review`;

@Injectable()
export class ReviewsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reviews a contributor has submitted on other contributors' PRs, since a
   * single shared `since` window. One row per (repo, PR) — the reviewer's
   * latest effective review on that PR — with PR context for scoring.
   */
  async getReviews(
    githubId: string,
    since: string,
  ): Promise<{
    github_id: string;
    since: string;
    generated_at: string;
    reviews: unknown[];
  }> {
    const rows = await this.dataSource.query(
      `
      SELECT${REVIEW_SELECT_COLUMNS}
      FROM reviewer_contributions rc
      LEFT JOIN repos r
        ON r.repo_full_name = rc.repo_full_name
      WHERE rc.reviewer_github_id = $1
        AND rc.submitted_at >= $2
      ORDER BY rc.submitted_at DESC
      `,
      [githubId, since],
    );

    return {
      github_id: githubId,
      since,
      generated_at: new Date().toISOString(),
      reviews: rows,
    };
  }

  /**
   * Per-repo variant of getReviews: each repo is windowed by its own `since`.
   * `repoNames` / `sinceValues` are parallel arrays (same length and order);
   * repo names are already lowercased and timestamps already ISO. The INNER
   * JOIN to the unnested windows restricts results to the named repos.
   */
  async getReviewsByRepo(
    githubId: string,
    repoNames: string[],
    sinceValues: string[],
  ): Promise<{
    github_id: string;
    since: null;
    generated_at: string;
    reviews: unknown[];
  }> {
    const rows = await this.dataSource.query(
      `
      WITH windows AS (
        SELECT * FROM unnest($2::text[], $3::timestamptz[]) AS t(repo_full_name, since)
      )
      SELECT${REVIEW_SELECT_COLUMNS}
      FROM reviewer_contributions rc
      JOIN windows w
        ON w.repo_full_name = LOWER(rc.repo_full_name)
      LEFT JOIN repos r
        ON r.repo_full_name = rc.repo_full_name
      WHERE rc.reviewer_github_id = $1
        AND rc.submitted_at >= w.since
      ORDER BY rc.submitted_at DESC
      `,
      [githubId, repoNames, sinceValues],
    );

    return {
      github_id: githubId,
      since: null,
      generated_at: new Date().toISOString(),
      reviews: rows,
    };
  }
}
