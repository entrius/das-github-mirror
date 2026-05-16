/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class ReposService {
  constructor(private readonly dataSource: DataSource) {}

  async getMaintainers(
    owner: string,
    repo: string,
  ): Promise<{
    repo_full_name: string;
    generated_at: string;
    maintainers: unknown[];
  }> {
    const repoFullName = `${owner}/${repo}`;

    // The association literals must stay in sync with gittensor
    // constants.py MAINTAINER_ASSOCIATIONS.
    const rows = await this.dataSource.query(
      `
      SELECT
        cr.author_github_id   AS github_id,
        cr.author_login       AS login,
        cr.author_association AS association
      FROM contributor_repo_roles cr
      WHERE LOWER(cr.repo_full_name) = LOWER($1)
        AND cr.author_association IN ('OWNER', 'MEMBER', 'COLLABORATOR')
      ORDER BY cr.author_github_id
      `,
      [repoFullName],
    );

    return {
      repo_full_name: repoFullName.toLowerCase(),
      generated_at: new Date().toISOString(),
      maintainers: rows,
    };
  }
}
