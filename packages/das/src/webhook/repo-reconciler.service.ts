import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Repo } from "../entities";
import { DEFAULT_MASTER_REPOSITORIES_URL } from "../queue/constants";

@Injectable()
export class RepoReconcilerService {
  private readonly logger = new Logger(RepoReconcilerService.name);
  private readonly masterListUrl: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
  ) {
    const configured = this.config.get<string>("MASTER_REPOSITORIES_URL");
    this.masterListUrl =
      configured && configured.trim()
        ? configured.trim()
        : DEFAULT_MASTER_REPOSITORIES_URL;
  }

  /**
   * Fetch the canonical gittensor repo list and flip registered=false for any
   * locally-registered repo whose key is absent from it.
   *
   * Fail-safe: any fetch/parse error, or an empty/malformed list, aborts
   * without touching the DB — a network hiccup or a bad deploy can never
   * mass-deregister. installation_id is preserved: delisting is not an
   * uninstall, so a re-listed repo can be re-registered via
   * POST /api/v1/admin/repos/register without a GitHub App reinstall.
   */
  async reconcile(): Promise<void> {
    const listed = await this.fetchListedRepos();
    if (!listed) return; // fetch/parse failed or empty — fail-safe, no writes

    const registered = await this.repoRepo.find({
      where: { registered: true },
      select: ["repoFullName"],
    });

    const delisted = registered.filter(
      (r) => !listed.has(r.repoFullName.toLowerCase()),
    );

    if (delisted.length === 0) {
      this.logger.log(
        `Reconcile: ${registered.length} registered repo(s) all present in master list`,
      );
      return;
    }

    const names = delisted.map((r) => r.repoFullName);
    await this.repoRepo.update(
      { repoFullName: In(names) },
      { registered: false },
    );
    this.logger.warn(
      `Reconcile: deregistered ${names.length} delisted repo(s): ${names.join(", ")}`,
    );
  }

  /**
   * Fetch and parse the master list into a lowercased Set of "owner/repo" keys.
   * Returns null on any failure or an empty result so the caller fails safe and
   * leaves registration state untouched.
   */
  private async fetchListedRepos(): Promise<Set<string> | null> {
    let res: Response;
    try {
      res = await fetch(this.masterListUrl);
    } catch (err) {
      this.logger.error(`Reconcile: master list fetch failed: ${String(err)}`);
      return null;
    }

    if (!res.ok) {
      this.logger.error(
        `Reconcile: master list returned ${res.status}; skipping`,
      );
      return null;
    }

    let parsed: unknown;
    try {
      parsed = (await res.json()) as unknown;
    } catch (err) {
      this.logger.error(`Reconcile: master list is not JSON: ${String(err)}`);
      return null;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      this.logger.error(
        "Reconcile: master list is not a JSON object; skipping",
      );
      return null;
    }

    const keys = Object.keys(parsed);
    if (keys.length === 0) {
      // Never mass-deregister on an empty list — treat it as a bad fetch.
      this.logger.error("Reconcile: master list is empty; skipping");
      return null;
    }

    return new Set(keys.map((k) => k.toLowerCase()));
  }
}
