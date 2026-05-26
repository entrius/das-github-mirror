import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Issue,
  LabelEvent,
  PrFile,
  PrFileContent,
  PullRequest,
  Repo,
  Review,
} from "../entities";
import { GitHubFetcherService } from "../webhook/github-fetcher.service";
import { FetchProcessor } from "./fetch.processor";
import { RegistryReconcilerService } from "./registry-reconciler.service";
import { FETCH_QUEUE } from "./constants";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow("REDIS_HOST"),
          port: +config.getOrThrow("REDIS_PORT"),
        },
      }),
    }),
    BullModule.registerQueue({ name: FETCH_QUEUE }),
    TypeOrmModule.forFeature([
      Issue,
      LabelEvent,
      PullRequest,
      PrFile,
      PrFileContent,
      Repo,
      Review,
    ]),
  ],
  providers: [FetchProcessor, GitHubFetcherService, RegistryReconcilerService],
  exports: [BullModule],
})
export class QueueModule {}
