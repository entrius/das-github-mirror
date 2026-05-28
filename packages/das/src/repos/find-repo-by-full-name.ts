import { Repository } from "typeorm";
import { Repo } from "../entities";

/** GitHub repo identity is case-insensitive; rows use canonical casing from webhooks. */
export async function findRepoByFullNameInsensitive(
  repoRepo: Repository<Repo>,
  repoFullName: string,
): Promise<Repo | null> {
  return repoRepo
    .createQueryBuilder("repo")
    .where("LOWER(repo.repo_full_name) = LOWER(:repoFullName)", { repoFullName })
    .getOne();
}
