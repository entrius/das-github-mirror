/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from "@nestjs/common";
import { RepoIdentityService } from "../repo-identity.service";

@Injectable()
export class InstallationHandler {
  private readonly logger = new Logger(InstallationHandler.name);

  constructor(private readonly repoIdentity: RepoIdentityService) {}

  async handle(event: string, payload: Record<string, any>): Promise<void> {
    const installationId = payload.installation?.id;

    if (event === "installation" && payload.action === "deleted") {
      // App uninstalled — soft-clear all repos for this installation.
      // Data stays (historical scoring evidence); ingestion stops via registered=false.
      this.logger.warn(
        `Installation ${installationId} deleted, clearing repos`,
      );
      await this.repoIdentity.clearInstallation(String(installationId));
      return;
    }

    // installation_repositories.added or installation.created
    // Row is created with registered=false (DB default). Backfill + ingestion stay
    // off until registered is flipped true — manually today, via on-chain reconciler later.
    const repos: any[] =
      payload.repositories ?? payload.repositories_added ?? [];

    for (const repo of repos) {
      const repoFullName = await this.repoIdentity.upsertInstalled(
        repo,
        String(installationId),
      );
      if (repoFullName) this.logger.log(`Tracking repo: ${repoFullName}`);
    }

    // installation_repositories.removed — soft clear, preserve historical data.
    const removed: any[] = payload.repositories_removed ?? [];
    for (const repo of removed) {
      const repoFullName = await this.repoIdentity.markRemoved(repo);
      if (repoFullName)
        this.logger.log(`Stopped tracking repo: ${repoFullName}`);
    }
  }
}
