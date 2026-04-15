import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "repos" })
export class Repo {
  @PrimaryColumn({ name: "repo_full_name" })
  repoFullName: string;

  @Column({ name: "installation_id", type: "bigint", nullable: true })
  installationId: string;

  @Column({ name: "webhook_secret", nullable: true })
  webhookSecret: string;

  @Column({ name: "added_at" })
  addedAt: string;

  @Column({ name: "last_event_at", nullable: true })
  lastEventAt: string;
}
