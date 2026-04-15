import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "review_comments" })
export class ReviewComment {
  @PrimaryColumn({ name: "repo_full_name" })
  repoFullName: string;

  @PrimaryColumn({ name: "comment_id", type: "bigint" })
  commentId: string;

  @Column({ name: "pr_number" })
  prNumber: number;

  @Column({ name: "reviewer_github_id", nullable: true })
  reviewerGithubId: string;

  @Column({ name: "reviewer_login", nullable: true })
  reviewerLogin: string;

  @Column({ name: "review_id", type: "bigint", nullable: true })
  reviewId: string | null;

  @Column({ nullable: true })
  path: string;

  @Column({ nullable: true })
  line: number;

  @Column({ nullable: true })
  side: string;

  @Column({ nullable: true })
  body: string;

  @Column({ name: "created_at" })
  createdAt: string;

  @Column({ name: "updated_at", nullable: true })
  updatedAt: string;
}
