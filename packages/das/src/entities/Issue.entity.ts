import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "issues" })
export class Issue {
  @PrimaryColumn({ name: "repo_full_name" })
  repoFullName: string;

  @PrimaryColumn({ name: "issue_number" })
  issueNumber: number;

  @Column({ name: "author_github_id", nullable: true })
  authorGithubId: string;

  @Column({ name: "author_login", nullable: true })
  authorLogin: string;

  @Column({ name: "author_association", nullable: true })
  authorAssociation: string;

  @Column({ nullable: true })
  title: string | null;

  @Column()
  state: string;

  @Column({ name: "state_reason", nullable: true })
  stateReason: string | null;

  @Column({ name: "created_at" })
  createdAt: string;

  @Column({ name: "closed_at", nullable: true })
  closedAt: string;

  @Column({ name: "updated_at", nullable: true })
  updatedAt: string;

  @Column({ type: "text", array: true, nullable: true })
  labels: string[] | null;

  @Column({ name: "solved_by_pr", nullable: true })
  solvedByPr: number | null;

  @Column({ name: "is_transferred", default: false })
  isTransferred: boolean;
}
