import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { DbModule } from "./config/database.config";
import { QueueModule } from "./queue/queue.module";
import { WebhookModule } from "./webhook/webhook.module";
import { ApiModule } from "./api/api.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    DbModule,
    QueueModule,
    WebhookModule,
    ApiModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
