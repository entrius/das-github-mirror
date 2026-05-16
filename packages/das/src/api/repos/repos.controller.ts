import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { ReposService } from "./repos.service";

@ApiTags("Repos")
@Controller("api/v1/repos")
export class ReposController {
  constructor(private readonly repos: ReposService) {}

  @Get(":owner/:repo/maintainers")
  @ApiOperation({
    summary: "Maintainer-role contributors for a repo",
    description:
      "Returns users whose latest known GitHub association for the repo " +
      "is OWNER, MEMBER, or COLLABORATOR, synthesized from PR/issue/" +
      "review/comment activity (contributor_repo_roles view). An unknown " +
      "repo returns an empty maintainers list, not a 404.",
  })
  @ApiParam({ name: "owner", description: "Repository owner (org or user)" })
  @ApiParam({ name: "repo", description: "Repository name" })
  async getMaintainers(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
  ): Promise<unknown> {
    return this.repos.getMaintainers(owner, repo);
  }
}
