import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import {
  Repo,
  PullRequest,
  Issue,
  PrFile,
  PrFileContent,
  LabelEvent,
} from "../entities";
import { FETCH_QUEUE } from "../queue/constants";
import { AdminController } from "./admin.controller";
import { RequireApiKeyGuard } from "./require-api-key.guard";
import { HealthController } from "./health.controller";
import { MinersController } from "./miners/miners.controller";
import { MinersService } from "./miners/miners.service";
import { PullsController } from "./pulls/pulls.controller";
import { PullsService } from "./pulls/pulls.service";

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
    BullModule.registerQueue({ name: FETCH_QUEUE }),
  ],
  controllers: [
    MinersController,
    PullsController,
    AdminController,
    HealthController,
  ],
  providers: [MinersService, PullsService, RequireApiKeyGuard],
})
export class ApiModule {}
