import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "pr_files" })
export class PrFile {
  @PrimaryColumn({ name: "repo_full_name" })
  repoFullName: string;

  @PrimaryColumn({ name: "pr_number" })
  prNumber: number;

  @PrimaryColumn({ type: "text" })
  filename: string;

  @Column({ name: "previous_filename", type: "text", nullable: true })
  previousFilename: string;

  @Column()
  status: string;

  @Column({ default: 0 })
  additions: number;

  @Column({ default: 0 })
  deletions: number;

  @Column({ default: 0 })
  changes: number;
}
