import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "webhook_deliveries" })
export class WebhookDelivery {
  @PrimaryColumn({ name: "delivery_id" })
  deliveryId: string;

  @Column({ name: "received_at", type: "timestamptz" })
  receivedAt: string;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt: string | null;

  @Column({ name: "event_type", type: "varchar", length: 64, nullable: true })
  eventType: string | null;

  @Column({ name: "payload", type: "jsonb", nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ name: "failed_at", type: "timestamptz", nullable: true })
  failedAt: string | null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;
}
