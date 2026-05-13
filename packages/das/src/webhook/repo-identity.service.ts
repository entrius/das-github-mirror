import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Repo } from "../entities";

interface GitHubRepositoryPayload {
  id?: number | string | null;
  full_name?: string | null;
}

const REPO_SCOPED_TABLES = [
  "pull_requests",
  "issues",
  "reviews",
  "comments",
  "review_comments",
  "label_events",
  "pr_files",
  "pr_file_contents",
];

@Injectable()
export class RepoIdentityService {
  private readonly logger = new Logger(RepoIdentityService.name);

  constructor(
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
    private readonly dataSource: DataSource,
  ) {}

  async reconcile(repository: GitHubRepositoryPayload): Promise<Repo | null> {
    const repoFullName = repository.full_name ?? null;
    if (!repoFullName) return null;

    const githubRepoId = this.repoId(repository);
    const exact = await this.repoRepo.findOneBy({ repoFullName });
    if (exact) {
      if (githubRepoId && exact.githubRepoId !== githubRepoId) {
        await this.repoRepo.update(repoFullName, { githubRepoId });
        exact.githubRepoId = githubRepoId;
      }
      return exact;
    }

    if (!githubRepoId) return null;

    const renamed = await this.repoRepo.findOneBy({ githubRepoId });
    if (!renamed) return null;

    await this.renameRepoFullName(
      renamed.repoFullName,
      repoFullName,
      githubRepoId,
    );
    this.logger.warn(
      `Reconciled repository rename ${renamed.repoFullName} -> ${repoFullName}`,
    );

    renamed.repoFullName = repoFullName;
    renamed.githubRepoId = githubRepoId;
    return renamed;
  }

  async upsertInstalled(
    repository: GitHubRepositoryPayload,
    installationId: string,
  ): Promise<string | null> {
    const repoFullName = repository.full_name ?? null;
    if (!repoFullName) return null;

    const githubRepoId = this.repoId(repository);
    const existing = await this.reconcile(repository);

    if (existing) {
      await this.repoRepo.update(existing.repoFullName, {
        githubRepoId,
        installationId,
      });
    } else {
      await this.repoRepo.insert({
        repoFullName,
        githubRepoId,
        installationId,
        addedAt: new Date().toISOString(),
      });
    }

    return repoFullName;
  }

  async markRemoved(
    repository: GitHubRepositoryPayload,
  ): Promise<string | null> {
    const repoFullName = repository.full_name ?? null;
    if (!repoFullName) return null;

    const existing = await this.reconcile(repository);
    const resolvedFullName = existing?.repoFullName ?? repoFullName;
    await this.repoRepo.update(resolvedFullName, {
      installationId: null,
      registered: false,
    });

    return resolvedFullName;
  }

  async clearInstallation(installationId: string): Promise<void> {
    await this.repoRepo
      .createQueryBuilder()
      .update()
      .set({ installationId: null, registered: false })
      .where("installationId = :id", { id: installationId })
      .execute();
  }

  private repoId(repository: GitHubRepositoryPayload): string | null {
    return repository.id === undefined || repository.id === null
      ? null
      : String(repository.id);
  }

  private async renameRepoFullName(
    oldFullName: string,
    newFullName: string,
    githubRepoId: string,
  ): Promise<void> {
    if (oldFullName === newFullName) return;

    await this.dataSource.transaction(async (manager) => {
      const target = await manager.getRepository(Repo).findOneBy({
        repoFullName: newFullName,
      });
      if (target) {
        throw new Error(
          `Cannot reconcile repository rename ${oldFullName} -> ${newFullName}: target repo row already exists`,
        );
      }

      for (const table of REPO_SCOPED_TABLES) {
        await manager.query(
          `UPDATE ${table} SET repo_full_name = $1 WHERE repo_full_name = $2`,
          [newFullName, oldFullName],
        );
      }

      await manager.query(
        `UPDATE repos
         SET repo_full_name = $1, github_repo_id = $2
         WHERE repo_full_name = $3`,
        [newFullName, githubRepoId, oldFullName],
      );
    });
  }
}
