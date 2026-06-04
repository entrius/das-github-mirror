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
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { MinersController } from "./miners/miners.controller";
import { MinersService } from "./miners/miners.service";
import { ReviewsService } from "./miners/reviews.service";
import { PullsController } from "./pulls/pulls.controller";
import { PullsService } from "./pulls/pulls.service";
import { ReposController } from "./repos/repos.controller";
import { ReposService } from "./repos/repos.service";

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
    DashboardController,
    MinersController,
    PullsController,
    ReposController,
    AdminController,
    HealthController,
  ],
  providers: [
    DashboardService,
    MinersService,
    ReviewsService,
    PullsService,
    ReposService,
    RequireApiKeyGuard,
  ],
})
export class ApiModule {}
