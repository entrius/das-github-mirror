import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { DataSource } from "typeorm";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 7;

@Injectable()
export class WebhookPruneService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookPruneService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    // Run once at startup, then daily.
    void this.prune();
    this.timer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async prune(): Promise<void> {
    try {
      const result: { affectedRows?: number }[] = await this.dataSource.query(
        `DELETE FROM webhook_deliveries
         WHERE received_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`,
      );
      this.logger.log(
        `Pruned webhook_deliveries older than ${RETENTION_DAYS} days (${JSON.stringify(result)})`,
      );
    } catch (err) {
      this.logger.error(`Prune failed: ${String(err)}`);
    }
  }
}
