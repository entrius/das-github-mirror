import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule } from "@nestjs/throttler";
import {
  Repo,
  PullRequest,
  Issue,
  PrFile,
  PrFileContent,
  LabelEvent,
} from "../entities";
import { ApiKeyGuard } from "./api-key.guard";
import { ContributorsController } from "./contributors.controller";
import { ContributorsService } from "./contributors.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Repo,
      PullRequest,
      Issue,
      PrFile,
      PrFileContent,
      LabelEvent,
    ]),
    // Strict per-IP limit for anonymous callers; bypassed by ApiKeyGuard
    // when a valid x-api-key is presented.
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000, // 1 minute
        limit: 30, // 30 requests per IP per minute
      },
    ]),
  ],
  controllers: [ContributorsController],
  providers: [ContributorsService, ApiKeyGuard],
})
export class ApiModule {}
