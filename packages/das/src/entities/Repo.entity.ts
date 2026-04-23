import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "repos" })
export class Repo {
  @PrimaryColumn({ name: "repo_full_name" })
  repoFullName: string;

  @Column({ name: "installation_id", type: "bigint", nullable: true })
  installationId: string | null;

  @Column({ name: "webhook_secret", type: "varchar", nullable: true })
  webhookSecret: string | null;

  @Column({ name: "added_at", type: "timestamptz" })
  addedAt: string;

  @Column({ name: "last_event_at", type: "timestamptz", nullable: true })
  lastEventAt: string | null;

  @Column({ name: "default_branch", type: "varchar", nullable: true })
  defaultBranch: string | null;

  @Column({ name: "registered", type: "boolean" })
  registered: boolean;
}
