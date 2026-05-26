import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { In, Repository } from "typeorm";
import { Repo } from "../entities";
import {
  FETCH_JOBS,
  FETCH_QUEUE,
  MASTER_REPOSITORIES_URL,
  REGISTRY_RECONCILE_CRON,
} from "./constants";

@Injectable()
export class RegistryReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(RegistryReconcilerService.name);

  constructor(
    @InjectQueue(FETCH_QUEUE) private readonly fetchQueue: Queue,
    @InjectRepository(Repo) private readonly repoRepo: Repository<Repo>,
  ) {}

  async onModuleInit(): Promise<void> {
    // BullMQ deduplicates repeatable jobs by repeat key, so restarts
    // don't accumulate duplicate schedules.
    await this.fetchQueue.add(
      FETCH_JOBS.RECONCILE_REGISTRY,
      {},
      {
        repeat: { pattern: REGISTRY_RECONCILE_CRON },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }

  async reconcile(): Promise<void> {
    const canonical = await this.fetchCanonicalRepos();
    // Fail-safe: a network blip or non-200 must never mass-deregister.
    if (!canonical) return;
    if (canonical.size === 0) {
      this.logger.warn("Canonical repo list is empty — refusing to deregister");
      return;
    }

    const registered = await this.repoRepo.find({
      select: ["repoFullName"],
      where: { registered: true },
    });
    const toDeregister = registered
      .map((r) => r.repoFullName)
      .filter((name) => !canonical.has(name.toLowerCase()));

    // installationId stays — delisting != uninstalling; re-list via admin/repos/register.
    await this.repoRepo.update(
      { repoFullName: In(toDeregister) },
      { registered: false },
    );

    this.logger.log(
      `Registry reconcile: deregistered ${toDeregister.length} repo(s)` +
        (toDeregister.length ? `: ${toDeregister.join(", ")}` : ""),
    );
  }

  private async fetchCanonicalRepos(): Promise<Set<string> | null> {
    try {
      const res = await fetch(MASTER_REPOSITORIES_URL);
      if (!res.ok) {
        this.logger.error(
          `Master repos fetch returned ${res.status} ${res.statusText}`,
        );
        return null;
      }
      const json = (await res.json()) as Record<string, unknown>;
      return new Set(Object.keys(json).map((k) => k.toLowerCase()));
    } catch (err) {
      this.logger.error(`Master repos fetch failed: ${String(err)}`);
      return null;
    }
  }
}
