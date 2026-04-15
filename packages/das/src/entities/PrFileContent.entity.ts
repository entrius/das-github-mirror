import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "pr_file_contents" })
export class PrFileContent {
  @PrimaryColumn({ name: "repo_full_name" })
  repoFullName: string;

  @PrimaryColumn({ name: "pr_number" })
  prNumber: number;

  @PrimaryColumn()
  filename: string;

  @Column({ name: "base_content", nullable: true })
  baseContent: string;

  @Column({ name: "head_content", nullable: true })
  headContent: string;

  @Column({ name: "is_binary", default: false })
  isBinary: boolean;

  @Column({ name: "byte_size", nullable: true })
  byteSize: number;
}
