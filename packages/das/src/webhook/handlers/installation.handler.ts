/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Repo } from "../../entities";

@Injectable()
export class InstallationHandler {
  private readonly logger = new Logger(InstallationHandler.name);

  constructor(
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
  ) {}

  async handle(event: string, payload: Record<string, any>): Promise<void> {
    const installationId = payload.installation?.id;

    if (event === "installation" && payload.action === "deleted") {
      // App uninstalled — mark all repos for this installation inactive
      this.logger.warn(
        `Installation ${installationId} deleted, marking repos inactive`,
      );
      // We don't delete data, just clear the installation_id so we know it's dead
      await this.repoRepo
        .createQueryBuilder()
        .update()
        .set({ installationId: null })
        .where("installationId = :id", { id: String(installationId) })
        .execute();
      return;
    }

    // installation_repositories.added or installation.created
    const repos: any[] =
      payload.repositories ?? payload.repositories_added ?? [];

    for (const repo of repos) {
      await this.repoRepo.upsert(
        {
          repoFullName: repo.full_name,
          installationId: String(installationId),
          addedAt: new Date().toISOString(),
        },
        ["repoFullName"],
      );
      this.logger.log(`Tracking repo: ${repo.full_name}`);
    }

    // installation_repositories.removed
    const removed: any[] = payload.repositories_removed ?? [];
    for (const repo of removed) {
      await this.repoRepo.update(repo.full_name, {
        installationId: undefined as any,
      });
      this.logger.log(`Stopped tracking repo: ${repo.full_name}`);
    }
  }
}
