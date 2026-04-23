import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "webhook_deliveries" })
export class WebhookDelivery {
  @PrimaryColumn({ name: "delivery_id" })
  deliveryId: string;

  @Column({ name: "received_at", type: "timestamptz" })
  receivedAt: string;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt: string | null;
}
