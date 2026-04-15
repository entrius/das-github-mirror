import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "label_events" })
export class LabelEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "repo_full_name" })
  repoFullName: string;

  @Column({ name: "issue_number", nullable: true })
  issueNumber: number;

  @Column({ name: "label_name" })
  labelName: string;

  @Column()
  action: string;

  @Column({ name: "actor_github_id", nullable: true })
  actorGithubId: string;

  @Column({ name: "actor_login", nullable: true })
  actorLogin: string;

  @Column({ name: "actor_association", nullable: true })
  actorAssociation: string;

  @Column()
  timestamp: string;
}
