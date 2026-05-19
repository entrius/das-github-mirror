import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { NoCache } from "../../cache";
import { CommentsService } from "./comments.service";

const CURSOR_DESCRIPTION =
  "Opaque cursor returned by `next_cursor` on the prior page. Omit on the first call.";
const LIMIT_DESCRIPTION =
  "Maximum rows to return. Defaults to 50, capped at 200.";

@ApiTags("Comments")
@Controller("api/v1")
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get("pulls/:owner/:repo/:number/comments")
  @NoCache()
  @ApiOperation({
    summary: "Conversation-thread comments on a PR",
    description:
      "Rows from the `comments` table where `comment_context = 'pr'`, " +
      "ordered chronologically (`created_at ASC, comment_id ASC`). " +
      "Returns 404 only when the PR is unknown; an empty array is valid.",
  })
  @ApiParam({ name: "owner", description: "Repository owner" })
  @ApiParam({ name: "repo", description: "Repository name" })
  @ApiParam({ name: "number", description: "Pull request number", type: Number })
  @ApiQuery({ name: "cursor", required: false, description: CURSOR_DESCRIPTION })
  @ApiQuery({ name: "limit", required: false, description: LIMIT_DESCRIPTION })
  async getPrComments(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.comments.getPrComments(owner, repo, number, cursor, limit);
  }

  @Get("pulls/:owner/:repo/:number/review-comments")
  @NoCache()
  @ApiOperation({
    summary: "Inline review comments on a PR",
    description:
      "Rows from `review_comments`, ordered chronologically " +
      "(`created_at ASC, comment_id ASC`). Returns 404 only when the PR " +
      "is unknown; an empty array is valid.",
  })
  @ApiParam({ name: "owner", description: "Repository owner" })
  @ApiParam({ name: "repo", description: "Repository name" })
  @ApiParam({ name: "number", description: "Pull request number", type: Number })
  @ApiQuery({ name: "cursor", required: false, description: CURSOR_DESCRIPTION })
  @ApiQuery({ name: "limit", required: false, description: LIMIT_DESCRIPTION })
  async getPrReviewComments(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.comments.getPrReviewComments(
      owner,
      repo,
      number,
      cursor,
      limit,
    );
  }

  @Get("issues/:owner/:repo/:number/comments")
  @NoCache()
  @ApiOperation({
    summary: "Conversation-thread comments on an issue",
    description:
      "Rows from the `comments` table where `comment_context = 'issue'`, " +
      "ordered chronologically. Returns 404 only when the issue is " +
      "unknown; an empty array is valid.",
  })
  @ApiParam({ name: "owner", description: "Repository owner" })
  @ApiParam({ name: "repo", description: "Repository name" })
  @ApiParam({ name: "number", description: "Issue number", type: Number })
  @ApiQuery({ name: "cursor", required: false, description: CURSOR_DESCRIPTION })
  @ApiQuery({ name: "limit", required: false, description: LIMIT_DESCRIPTION })
  async getIssueComments(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.comments.getIssueComments(owner, repo, number, cursor, limit);
  }

  @Get("pulls/:owner/:repo/:number/label-events")
  @NoCache()
  @ApiOperation({
    summary: "Label history for a PR",
    description:
      "Rows from `label_events` where `target_type = 'pr'`, ordered " +
      "chronologically (`timestamp ASC, id ASC`). Returns 404 only when " +
      "the PR is unknown; an empty array is valid.",
  })
  @ApiParam({ name: "owner", description: "Repository owner" })
  @ApiParam({ name: "repo", description: "Repository name" })
  @ApiParam({ name: "number", description: "Pull request number", type: Number })
  @ApiQuery({ name: "cursor", required: false, description: CURSOR_DESCRIPTION })
  @ApiQuery({ name: "limit", required: false, description: LIMIT_DESCRIPTION })
  async getPrLabelEvents(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.comments.getPrLabelEvents(owner, repo, number, cursor, limit);
  }

  @Get("issues/:owner/:repo/:number/label-events")
  @NoCache()
  @ApiOperation({
    summary: "Label history for an issue",
    description:
      "Rows from `label_events` where `target_type = 'issue'`, ordered " +
      "chronologically (`timestamp ASC, id ASC`). Returns 404 only when " +
      "the issue is unknown; an empty array is valid.",
  })
  @ApiParam({ name: "owner", description: "Repository owner" })
  @ApiParam({ name: "repo", description: "Repository name" })
  @ApiParam({ name: "number", description: "Issue number", type: Number })
  @ApiQuery({ name: "cursor", required: false, description: CURSOR_DESCRIPTION })
  @ApiQuery({ name: "limit", required: false, description: LIMIT_DESCRIPTION })
  async getIssueLabelEvents(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.comments.getIssueLabelEvents(
      owner,
      repo,
      number,
      cursor,
      limit,
    );
  }
}
