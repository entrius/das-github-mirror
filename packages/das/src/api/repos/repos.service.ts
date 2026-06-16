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

    // Reads the live maintainers table (direct collaborators + org members),
    // populated by MaintainerPopulateService. Every row is already a maintainer
    // (OWNER/MEMBER/COLLABORATOR), so no association filter is needed.
    const rows = await this.dataSource.query(
      `
      SELECT
        m.github_id   AS github_id,
        m.login       AS login,
        m.association AS association
      FROM maintainers m
      WHERE m.repo_full_name = LOWER($1)
      ORDER BY m.github_id
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
